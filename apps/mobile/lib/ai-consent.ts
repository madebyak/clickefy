/**
 * AI data-sharing consent (App Store Guideline 5.1.2(i), effective
 * 2025-11-13, and Google Play's AI content policy): we must obtain the
 * user's explicit permission before sending their inputs (photos, videos,
 * prompts) to third-party AI providers.
 *
 * We gate this just-in-time at the first "Generate" tap — the moment the
 * user's content is about to be sent to a provider — rather than as an
 * onboarding wall, so consent is tied directly to the data-sharing action.
 *
 * Consent is recorded per user (keyed by the stable Clerk user id) and
 * versioned: if we materially change providers or what's shared, bump
 * `CONSENT_VERSION` to re-prompt everyone.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Bump when providers / shared data change materially → everyone re-consents. */
export const CONSENT_VERSION = 'v1';

function storageKey(userId: string): string {
  return `clickfy:ai-consent:${CONSENT_VERSION}:${userId}`;
}

/** Whether this user has already accepted the current-version AI disclosure. */
export async function hasAiConsent(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await AsyncStorage.getItem(storageKey(userId))) != null;
  } catch {
    // Storage failure → treat as "not consented" so we ask again rather
    // than silently proceed without permission.
    return false;
  }
}

/** Record the user's acceptance (with a timestamp for a light audit trail). */
export async function setAiConsent(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(storageKey(userId), new Date().toISOString());
  } catch {
    // Best-effort: if the write fails the user simply re-consents next time.
  }
}
