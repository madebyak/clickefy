/**
 * Auth middleware family.
 *
 *   withAuth({ required: false })   → populate clerkUserId if present, else continue
 *   withAuth({ required: true })    → 401 if no/invalid token
 *   withCurrentUser()               → resolve clerk user → Neon `users` row (lazy upsert)
 *   withAdmin()                     → require a staff `admin_role` (legacy
 *                                     `entitlement = 'admin'` honored during
 *                                     the anti-lockout transition window)
 *
 * Why three layers: we want fine-grained guards. Some endpoints are
 * "public-but-better-with-auth" (e.g. `/v1/categories` could show
 * favourited state). Others are strictly authed (`/v1/users/me`).
 * Admin endpoints (`POST /v1/categories`) need the strongest gate.
 *
 * Token format: clients pass `Authorization: Bearer <Clerk session token>`.
 * The token is a JWT signed by Clerk; we verify it offline against the
 * PEM in `CLERK_JWT_KEY`, so no network round-trip per request.
 */

import * as Sentry from '@sentry/cloudflare';
import { createMiddleware } from 'hono/factory';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { eq } from 'drizzle-orm';

import { adminAuditLog, users } from '@clickfy/db';
import {
  computeEffectivePages,
  type AdminPageKey,
  type AdminRole,
} from '@clickfy/types';

import type { AppEnv, Bindings, CurrentUser } from '../types';
import { resolveOrLinkUser } from '../lib/provision-user';

/**
 * Real-identity placeholder prefix. Rows whose email starts with this
 * literal were created by `withCurrentUser`'s stub fallback before the
 * Clerk webhook arrived (or before `CLERK_SECRET_KEY` was configured).
 * The heal step below upgrades them on the user's next authenticated
 * request, so the admin dashboard never has to live with a fake email.
 */
const STUB_EMAIL_PREFIX = 'pending+';

/**
 * How stale `users.last_seen_at` may get before we refresh it.
 *
 * This column feeds "active users" reporting in the admin dashboard —
 * nothing reads it at minute resolution. Writing it on EVERY
 * authenticated request meant a Neon round-trip per request (four on a
 * single web studio load) to move a timestamp by milliseconds. Ten
 * minutes keeps every reporting bucket we actually use (DAU/WAU/MAU,
 * "last seen" in the users table) accurate while removing ~99% of the
 * writes.
 */
const LAST_SEEN_REFRESH_MS = 10 * 60 * 1000;

/**
 * Run a fire-and-forget promise without holding up the response.
 *
 * `c.executionCtx` THROWS (rather than returning undefined) when there is
 * no ExecutionContext — i.e. outside the Workers runtime, such as in
 * tests. Hence the try/catch rather than a truthiness check. On Workers
 * this hands the promise to the runtime so it survives past the response;
 * elsewhere we await it inline so tests stay deterministic.
 */
async function runInBackground(
  c: { executionCtx: ExecutionContext },
  work: Promise<unknown>,
): Promise<void> {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    await work.catch(() => undefined);
  }
}

interface ClerkProfile {
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * Fetch a user's profile directly from Clerk. Returns null on any
 * failure (network, missing secret, deleted-on-Clerk, etc.) so the
 * caller can fall back to a placeholder without branching on every
 * possible failure mode.
 *
 * Called from the stub-creation path so a fresh signup gets the real
 * email/name immediately, and from the heal step that upgrades any
 * row still carrying the legacy placeholder email.
 */
async function fetchClerkProfile(
  clerkUserId: string,
  secretKey: Bindings['CLERK_SECRET_KEY'],
): Promise<ClerkProfile | null> {
  if (!secretKey) return null;
  try {
    const clerk = createClerkClient({ secretKey });
    const user = await clerk.users.getUser(clerkUserId);
    const primary =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
      user.emailAddresses[0];
    const composed = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return {
      email: primary?.emailAddress ?? null,
      name: composed || user.username || null,
      avatarUrl: user.imageUrl ?? null,
    };
  } catch (err) {
    console.error('[withCurrentUser] Clerk profile fetch failed:', err);
    return null;
  }
}

interface WithAuthOptions {
  /** When true, reject unauthenticated requests with 401. Defaults to true. */
  required?: boolean;
}

export function withAuth(options: WithAuthOptions = {}) {
  const required = options.required ?? true;

  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header('Authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;

    if (!token) {
      if (required) {
        return c.json(
          { error: { code: 'unauthenticated', message: 'Missing Authorization header.' } },
          401,
        );
      }
      return next();
    }

    if (!c.env.CLERK_JWT_KEY) {
      return c.json(
        {
          error: {
            code: 'auth_unconfigured',
            message: 'CLERK_JWT_KEY is not set on the Worker.',
          },
        },
        500,
      );
    }

    try {
      const payload = await verifyToken(token, {
        jwtKey: c.env.CLERK_JWT_KEY,
        // Permit dev-mode "clock skew" of up to 30s.
        clockSkewInMs: 30_000,
      });
      // Clerk puts the user id in `sub`. (Some templates also expose it in `userId`.)
      const clerkUserId = (payload.sub ?? (payload as { userId?: string }).userId) || null;
      if (!clerkUserId) {
        if (required) {
          return c.json(
            { error: { code: 'unauthenticated', message: 'Token has no subject.' } },
            401,
          );
        }
        return next();
      }
      c.set('clerkUserId', clerkUserId);
      return next();
    } catch (err) {
      if (required) {
        return c.json(
          {
            error: {
              code: 'invalid_token',
              message: err instanceof Error ? err.message : 'Invalid session token.',
            },
          },
          401,
        );
      }
      return next();
    }
  });
}

/**
 * Resolves the Clerk user → Neon `users` row.
 *
 * Lazy upsert: if Clerk has authenticated a user we don't yet have in
 * Neon (e.g. webhook hasn't fired yet, or we're running in a dev env
 * without webhooks configured), we create a stub row on first contact.
 *
 * Requires `withAuth({ required: true })` to have run upstream.
 */
export function withCurrentUser() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const clerkUserId = c.var.clerkUserId;
    if (!clerkUserId) {
      return c.json(
        { error: { code: 'unauthenticated', message: 'Auth middleware did not run.' } },
        401,
      );
    }

    const existing = await c.var.db.query.users.findFirst({
      where: eq(users.clerkUserId, clerkUserId),
    });

    if (existing) {
      // Reject deleted users immediately. A user who deleted their
      // account but still holds a valid Clerk session token (sessions
      // can outlive a delete by up to a minute) must not be able to
      // keep using the app — that would surface as ghost activity in
      // the audit trail and break the user-facing "your data is gone"
      // promise.
      if (existing.isDeleted) {
        return c.json(
          {
            error: {
              code: 'account_deleted',
              message: 'This account has been deleted.',
            },
          },
          401,
        );
      }

      // Bump lastSeenAt opportunistically — but only once the cached
      // value has actually gone stale (see LAST_SEEN_REFRESH_MS). It's a
      // reporting hint, not critical, so it runs in the background and a
      // failure never affects the request.
      const lastSeenAge = Date.now() - existing.lastSeenAt.getTime();
      if (lastSeenAge >= LAST_SEEN_REFRESH_MS) {
        await runInBackground(
          c,
          c.var.db
            .update(users)
            .set({ lastSeenAt: new Date() })
            .where(eq(users.id, existing.id))
            .catch((err: unknown) => console.error('users.lastSeenAt update failed', err)),
        );
      }

      // Heal stub rows opportunistically. If this row was created by
      // an earlier visit before Clerk's webhook fired (or before
      // CLERK_SECRET_KEY was configured), the email is still the
      // synthetic `pending+...@clickefy.local` placeholder. Pull the
      // real profile from Clerk and patch the row in the background
      // so the admin dashboard never has to live with a fake email.
      // Fire-and-forget — never block the user's request on this.
      if (existing.email.startsWith(STUB_EMAIL_PREFIX)) {
        void (async () => {
          const profile = await fetchClerkProfile(clerkUserId, c.env.CLERK_SECRET_KEY);
          if (!profile?.email) return;
          try {
            await c.var.db
              .update(users)
              .set({
                email: profile.email,
                ...(profile.name !== null && { name: profile.name }),
                ...(profile.avatarUrl !== null && { avatarUrl: profile.avatarUrl }),
              })
              .where(eq(users.id, existing.id));
          } catch (err) {
            // Could collide with another live row's email if Clerk's
            // primary changed under us — log and move on. Partial
            // unique index from migration 0016 is what would surface
            // this; the row stays as-is until the next attempt.
            console.error('[withCurrentUser] stub heal failed:', err);
          }
        })();
      }

      c.set('user', existing);
      tagSentryUser(existing.id, clerkUserId);
      return next();
    }

    // No row matches this Clerk id. Pull the real profile from Clerk so
    // we have the verified email + name + avatar before deciding what to
    // do. The email is what lets us recognise a RETURNING user whose row
    // still carries their old (pre-migration) Clerk id — see
    // `resolveOrLinkUser` for why matching on it is safe.
    //
    // If Clerk is unreachable or CLERK_SECRET_KEY isn't configured (dev
    // env), `profile` is null and we fall back to a placeholder row; the
    // heal step above reconciles it on a later request.
    const profile = await fetchClerkProfile(clerkUserId, c.env.CLERK_SECRET_KEY);
    const result = await resolveOrLinkUser(c.var.db, {
      clerkUserId,
      email: profile?.email ?? null,
      name: profile?.name ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
    });

    if (!result) {
      return c.json(
        { error: { code: 'user_upsert_failed', message: 'Could not create user row.' } },
        500,
      );
    }

    c.set('user', result.user);
    tagSentryUser(result.user.id, clerkUserId);
    return next();
  });
}

/**
 * Attach the resolved user id to the current Sentry scope so any
 * exception captured downstream is tagged with them. We pass the
 * internal `users.id` UUID (not the Clerk id) because that's the
 * stable identifier across services. Wrapped in a try/catch so a
 * Sentry-side failure can never break an authenticated request.
 */
function tagSentryUser(userId: string, clerkUserId: string) {
  try {
    Sentry.setUser({ id: userId, username: clerkUserId });
  } catch {
    // no-op: Sentry not initialised (local dev w/o DSN).
  }
}

/**
 * Resolve a user's staff role.
 *
 * Anti-lockout dual-check (transition window): a user is treated as
 * staff if EITHER `admin_role` is set (the new model) OR the legacy
 * `entitlement === 'admin'` holds. The legacy clause guarantees that
 * even an admin row that the 0019 backfill somehow missed cannot be
 * locked out the instant the gate flips to roles. When a row has the
 * legacy entitlement but no role yet, we treat them as `superadmin`
 * (matching the backfill intent — preserve today's all-powerful
 * behavior) and flag `legacyAdmin` so we can later verify everyone has
 * a real role before removing the clause.
 */
function resolveStaffRole(
  user: CurrentUser,
): { role: AdminRole; legacyAdmin: boolean } | null {
  if (user.adminRole) return { role: user.adminRole, legacyAdmin: false };
  // LEGACY anti-lockout clause — remove only after verifying every
  // `entitlement = 'admin'` user has a non-null `admin_role`.
  if (user.entitlement === 'admin') return { role: 'superadmin', legacyAdmin: true };
  return null;
}

/**
 * Requires the current user to be staff (any admin role).
 *
 * Strictness layers (top → bottom: order matters):
 *   1. `user` populated by `withCurrentUser()` upstream — guarantees a
 *      DB row exists, not just a Clerk token.
 *   2. `is_deleted = false` — a soft-deleted admin must not regain
 *      access if their row is still around for retention.
 *   3. A resolvable staff role (`admin_role IS NOT NULL`, or the legacy
 *      `entitlement = 'admin'` anti-lockout fallback).
 *
 * On success it builds the per-request permission context
 * (`c.var.adminContext` = role + effective pages) so `requirePage` /
 * `requireRole` and `GET /v1/admin/me` can read it. Optional `page` /
 * `role` constraints can be enforced inline so a route declares its
 * required capability at its own mount point.
 *
 * Audit side-effect: on success, after the handler completes, an
 * `admin_audit_log` row is recorded for any successful POST/PATCH/
 * PUT/DELETE. A handler may enrich it via `c.set('audit', { ... })`.
 * The insert runs in `c.executionCtx.waitUntil()` so it never adds
 * latency to the response, never fails the request if the insert itself
 * errors, and never holds open the Worker beyond what Cloudflare allows.
 */
export function withAdmin(options: { page?: AdminPageKey; role?: AdminRole } = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user;
    if (!user) {
      return c.json(
        { error: { code: 'unauthenticated', message: 'Sign-in required.' } },
        401,
      );
    }
    if (user.isDeleted) {
      return c.json(
        { error: { code: 'forbidden', message: 'Account has been deleted.' } },
        403,
      );
    }

    const staff = resolveStaffRole(user);
    if (!staff) {
      return c.json(
        { error: { code: 'forbidden', message: 'Admin access required.' } },
        403,
      );
    }

    const effectivePages = computeEffectivePages(staff.role, user.adminPageOverrides);
    c.set('adminContext', {
      role: staff.role,
      effectivePages,
      legacyAdmin: staff.legacyAdmin,
    });

    // Inline capability constraints declared at the route's mount point.
    if (options.role && staff.role !== options.role) {
      return c.json(
        {
          error: {
            code: 'forbidden',
            message: `This action requires the ${options.role} role.`,
          },
        },
        403,
      );
    }
    if (options.page && !effectivePages.includes(options.page)) {
      return c.json(
        {
          error: {
            code: 'forbidden',
            message: 'You do not have access to this section.',
          },
        },
        403,
      );
    }

    await next();

    // Only audit successful state-changing requests. GETs are skipped
    // intentionally — they're already covered by the rate-limit logs
    // and would otherwise drown the audit table at multiple writes/s.
    const method = c.req.method;
    const status = c.res.status;
    if (
      (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') &&
      status >= 200 &&
      status < 300
    ) {
      const url = new URL(c.req.url);
      // Prefer a handler-supplied resourceId (e.g. the id of a row it
      // just created, which isn't in the URL) over the route `:id` param.
      const enrichment = c.var.audit;
      const resourceId = enrichment?.resourceId ?? c.req.param('id') ?? null;
      const auditWrite = c.var.db
        .insert(adminAuditLog)
        .values({
          adminUserId: user.id,
          method,
          path: url.pathname,
          resourceId,
          metadata: enrichment?.metadata ?? null,
          ip: c.req.header('cf-connecting-ip') ?? null,
          userAgent: c.req.header('user-agent') ?? null,
        })
        .catch((err: unknown) => {
          console.error('[withAdmin] admin_audit_log insert failed:', err);
        });

      // executionCtx is only defined under the Workers runtime. In tests
      // / Node-mode it's undefined; we just await the promise inline so
      // the test sees a deterministic write.
      const ctx = c.executionCtx as ExecutionContext | undefined;
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(auditWrite);
      } else {
        await auditWrite;
      }
    }
  });
}

/**
 * Require a specific page capability. Must run AFTER `withAdmin()` (which
 * builds `c.var.adminContext`). Prefer the inline `withAdmin({ page })`
 * form for route groups; this standalone helper exists for routes that
 * compose guards explicitly (Team / Monitoring).
 */
export function requirePage(page: AdminPageKey) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ctx = c.var.adminContext;
    if (!ctx) {
      return c.json(
        { error: { code: 'forbidden', message: 'Admin context missing.' } },
        403,
      );
    }
    if (!ctx.effectivePages.includes(page)) {
      return c.json(
        { error: { code: 'forbidden', message: 'You do not have access to this section.' } },
        403,
      );
    }
    return next();
  });
}

/**
 * Require an exact role (e.g. `superadmin` for Team / Monitoring). Must
 * run AFTER `withAdmin()`.
 */
export function requireRole(role: AdminRole) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ctx = c.var.adminContext;
    if (!ctx) {
      return c.json(
        { error: { code: 'forbidden', message: 'Admin context missing.' } },
        403,
      );
    }
    if (ctx.role !== role) {
      return c.json(
        { error: { code: 'forbidden', message: `This action requires the ${role} role.` } },
        403,
      );
    }
    return next();
  });
}
