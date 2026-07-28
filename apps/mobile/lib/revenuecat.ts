/**
 * RevenueCat wrapper — configure, identity, and purchase helpers.
 *
 * Division of responsibility:
 *   - Apple / Google process the actual payment and pay out to our bank.
 *   - RevenueCat validates the receipt and posts our backend a webhook
 *     (`apps/api/src/routes/webhooks/revenuecat.ts`) that grants credits /
 *     sets entitlement. The DB (`/v1/users/me`) stays the source of truth.
 *   - This module only: configures the SDK once, ties RevenueCat's
 *     `appUserID` to our DB `users.id`, exposes thin purchase helpers, and
 *     lets callers react to entitlement changes so the `/me` cache refreshes.
 *
 * ⚠️ The RevenueCat `appUserID` MUST be our own `users.id` (a DB UUID),
 * NOT the Clerk id — the webhook matches `event.app_user_id` → `users.id`
 * when granting. See `identifyRevenueCat`.
 *
 * Graceful degradation: until the public SDK keys are provided via EAS env
 * (`EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY`), `configureRevenueCat`
 * no-ops and `isRevenueCatReady()` returns false. Every helper below is a
 * safe no-op in that state, so the app builds and runs before the store is
 * live and the paywall can render an "unavailable" message instead of
 * crashing. RevenueCat's own Preview API Mode also keeps it from throwing
 * in Expo Go; real purchases require a dev/production build.
 */

import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesOfferings,
  type PurchasesPackage,
} from 'react-native-purchases';

import { config } from './config';

let configured = false;

/**
 * The DB `users.id` currently logged into the SDK, or null while the
 * SDK is anonymous. Purchases are BLOCKED while anonymous — a purchase
 * made on an `$RCAnonymousID` reaches the webhook with an id that can
 * never match a user, and a credit-pack bought that way is lost.
 */
let identifiedUserId: string | null = null;

/** True once `identifyRevenueCat` has successfully tied the SDK to a user. */
export function isRevenueCatIdentified(): boolean {
  return identifiedUserId !== null;
}

function platformKey(): string | null {
  return Platform.OS === 'ios' ? config.revenueCat.iosKey : config.revenueCat.androidKey;
}

/** True once a public SDK key was present and `configure()` has run. */
export function isRevenueCatReady(): boolean {
  return configured;
}

/**
 * Configure the SDK once at app boot. Idempotent — only the first call
 * with a valid platform key configures. Returns false (and no-ops) when
 * the key isn't set yet, so callers can branch the UI on availability.
 */
export function configureRevenueCat(): boolean {
  if (configured) return true;
  const apiKey = platformKey();
  if (!apiKey) {
    if (__DEV__) {
      console.warn('[revenuecat] no public SDK key set — in-app purchases disabled.');
    }
    return false;
  }
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  // `appUserID` omitted → RevenueCat assigns an anonymous id until
  // `identifyRevenueCat` runs after the user authenticates.
  Purchases.configure({ apiKey });
  configured = true;
  return true;
}

/**
 * Tie RevenueCat's App User ID to our DB `users.id`. Idempotent — calling
 * again with the same id is a no-op inside the SDK. Pass the DB uuid
 * (`meResponse.id`), never the Clerk user id.
 */
export async function identifyRevenueCat(userId: string): Promise<void> {
  if (!configured || !userId) return;
  try {
    await Purchases.logIn(userId);
    identifiedUserId = userId;
  } catch (err) {
    if (__DEV__) console.warn('[revenuecat] logIn failed', err);
  }
}

/** Reset to a fresh anonymous id on sign-out so the next user starts clean. */
export async function resetRevenueCat(): Promise<void> {
  if (!configured) return;
  identifiedUserId = null;
  try {
    await Purchases.logOut();
  } catch (err) {
    // logOut throws if the current id is already anonymous — harmless.
    if (__DEV__) console.warn('[revenuecat] logOut noop/failed', err);
  }
}

/**
 * Subscribe to entitlement/customer changes (fires after purchases,
 * restores, renewals). Returns an unsubscribe function. No-op when the
 * SDK isn't configured.
 */
export function onCustomerInfoChange(cb: (info: CustomerInfo) => void): () => void {
  if (!configured) return () => {};
  Purchases.addCustomerInfoUpdateListener(cb);
  return () => Purchases.removeCustomerInfoUpdateListener(cb);
}

/** The default offering (whatever you set as current in RevenueCat), or null. */
export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  const offerings: PurchasesOfferings = await Purchases.getOfferings();
  return offerings.current ?? null;
}

/** Packages of the current offering (empty when none configured). */
export async function getCurrentOfferingPackages(): Promise<PurchasesPackage[]> {
  const offering = await getCurrentOffering();
  return offering?.availablePackages ?? [];
}

export interface PurchaseResult {
  status: 'purchased' | 'cancelled' | 'error';
  customerInfo?: CustomerInfo;
  error?: unknown;
}

/**
 * Purchase a package. Normalises the user-cancel path to a `'cancelled'`
 * status so callers don't surface it as an error (App Store reviewers
 * flag apps that show an error toast on cancel).
 *
 * Identity gate: a purchase NEVER proceeds while the SDK is anonymous.
 * Callers pass the DB `users.id` (`dbUserId`) so a not-yet-identified
 * session self-heals by logging in first; if identity still can't be
 * established (e.g. `/me` hasn't resolved on a slow network) we refuse
 * — the retry a second later succeeds. Without this, a fast purchase
 * after sign-in could land on `$RCAnonymousID` and be lost server-side.
 */
export async function purchasePackage(
  pkg: PurchasesPackage,
  opts?: { dbUserId?: string },
): Promise<PurchaseResult> {
  if (!configured) {
    return { status: 'error', error: new Error('RevenueCat not configured') };
  }
  if (!identifiedUserId && opts?.dbUserId) {
    await identifyRevenueCat(opts.dbUserId);
  }
  if (!identifiedUserId) {
    return { status: 'error', error: new Error('identity_not_ready') };
  }
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { status: 'purchased', customerInfo };
  } catch (err) {
    if ((err as { userCancelled?: boolean }).userCancelled) {
      return { status: 'cancelled' };
    }
    return { status: 'error', error: err };
  }
}

/**
 * Restore prior purchases. Required by App Store guideline 3.1.1 — the
 * paywall must offer a Restore action for non-consumable / subscription
 * entitlements.
 */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!configured) {
    return { status: 'error', error: new Error('RevenueCat not configured') };
  }
  try {
    const customerInfo = await Purchases.restorePurchases();
    return { status: 'purchased', customerInfo };
  } catch (err) {
    return { status: 'error', error: err };
  }
}

/** Whether any entitlement is currently active on this customer. */
export function hasActiveEntitlement(info: CustomerInfo | undefined): boolean {
  if (!info) return false;
  return Object.keys(info.entitlements.active).length > 0;
}

export type { CustomerInfo, PurchasesOffering, PurchasesPackage };
