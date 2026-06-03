/**
 * `resolveOrLinkUser` — the single source of truth for turning a Clerk
 * identity into a Neon `users` row.
 *
 * Why this exists: we migrated auth from a *development* Clerk instance to
 * a *production* Clerk instance. Each person now signs in with a brand-new
 * Clerk user id, but their existing `users` row still carries the OLD
 * Clerk id. Looking up by Clerk id alone would treat every returning user
 * as a stranger, create a duplicate, and — because of the partial unique
 * index on `email` — fail with a 500 the moment two live rows share an
 * address.
 *
 * The fix is to fall back to matching on the **verified email**. This is
 * safe because Clerk only issues a session (the token that got us here)
 * AFTER the user has proven they own that email — via the email OTP code
 * or an OAuth provider (Google) that asserts a verified address. So a
 * request reaching this function with `email = X` is cryptographic proof
 * the caller controls `X`, which is exactly the guarantee we need to
 * re-point an existing row at the new identity.
 *
 * Resolution order:
 *   1. Row already linked to this Clerk id → use it (the steady state).
 *   2. No Clerk-id match, but a LIVE row exists with the same email →
 *      RE-LINK: update only that row's `clerk_user_id` (+ refresh name /
 *      avatar) and use it. All generations, credits, ledger history and
 *      admin entitlement are preserved because they reference the row's
 *      immutable internal `id` (UUID), never the Clerk id.
 *   3. Otherwise → genuinely new user → insert a fresh row.
 *
 * Safety properties:
 *   - No deletes, no DDL, no bulk writes. The only mutation is a
 *     single-row UPDATE of `clerk_user_id` on the caller's OWN row.
 *   - Idempotent: re-running resolves to the same row.
 *   - Concurrency-safe: if a racing request/webhook links the same
 *     identity between our lookup and insert, we re-read by Clerk id
 *     instead of surfacing the unique-violation error.
 */

import { and, eq, sql, users, type Db } from '@clickfy/db';

import type { CurrentUser } from '../types';

/**
 * Synthetic email used when we cannot learn the real address (Clerk
 * unreachable / secret unset). Kept in sync with `STUB_EMAIL_PREFIX` in
 * `middleware/with-auth.ts`; the heal step there upgrades these rows on a
 * later authenticated request.
 */
const STUB_EMAIL_PREFIX = 'pending+';

export interface ProvisionInput {
  /** The Clerk user id from the verified session / webhook payload. */
  clerkUserId: string;
  /** Verified primary email, or null if we couldn't resolve one. */
  email: string | null;
  /** Display name, or null to leave untouched on re-link. */
  name: string | null;
  /** Avatar URL, or null to leave untouched on re-link. */
  avatarUrl: string | null;
}

export interface ProvisionResult {
  user: CurrentUser;
  /** True only when a brand-new row was inserted (drives welcome bonus). */
  created: boolean;
  /** True when an existing row was re-pointed at this Clerk id. */
  relinked: boolean;
}

export async function resolveOrLinkUser(
  db: Db,
  input: ProvisionInput,
): Promise<ProvisionResult | null> {
  const { clerkUserId } = input;

  // 1. Steady state: already linked to this Clerk identity.
  const byClerk = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (byClerk) {
    return { user: byClerk, created: false, relinked: false };
  }

  // 2. Returning user from the previous Clerk instance. Match a LIVE row
  //    by verified email (case-insensitive) and re-point its Clerk id.
  const email = input.email?.trim() || null;
  if (email) {
    const byEmail = await db.query.users.findFirst({
      where: and(
        sql`lower(${users.email}) = lower(${email})`,
        eq(users.isDeleted, false),
      ),
    });
    if (byEmail) {
      const [relinked] = await db
        .update(users)
        .set({
          clerkUserId,
          // Only overwrite identity fields when we actually have a value,
          // so a sparse webhook payload never blanks a good name/avatar.
          ...(input.name !== null ? { name: input.name } : {}),
          ...(input.avatarUrl !== null ? { avatarUrl: input.avatarUrl } : {}),
        })
        .where(eq(users.id, byEmail.id))
        .returning();
      if (relinked) {
        return { user: relinked, created: false, relinked: true };
      }
    }
  }

  // 3. Genuinely new user → insert.
  const placeholderEmail = `${STUB_EMAIL_PREFIX}${clerkUserId}@clickefy.local`;
  try {
    const [created] = await db
      .insert(users)
      .values({
        clerkUserId,
        email: email ?? placeholderEmail,
        name: input.name,
        avatarUrl: input.avatarUrl,
        creditsBalance: 0,
      })
      .returning();
    if (!created) return null;
    return { user: created, created: true, relinked: false };
  } catch (err) {
    // A racing request (or the Clerk webhook firing in parallel) may have
    // inserted/linked this same identity between our lookup and insert.
    // Re-read by Clerk id and use that rather than failing the request.
    const raced = await db.query.users.findFirst({
      where: eq(users.clerkUserId, clerkUserId),
    });
    if (raced) {
      return { user: raced, created: false, relinked: false };
    }
    throw err;
  }
}
