/**
 * Auth middleware family.
 *
 *   withAuth({ required: false })   → populate clerkUserId if present, else continue
 *   withAuth({ required: true })    → 401 if no/invalid token
 *   withCurrentUser()               → resolve clerk user → Neon `users` row (lazy upsert)
 *   withAdmin()                     → require `entitlement === 'admin'`
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
import { verifyToken } from '@clerk/backend';
import { eq } from 'drizzle-orm';

import { adminAuditLog, users } from '@clickfy/db';

import type { AppEnv } from '../types';

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

      // Bump lastSeenAt opportunistically. Don't await — it's a hint, not critical.
      void c.var.db
        .update(users)
        .set({ lastSeenAt: new Date() })
        .where(eq(users.id, existing.id))
        .catch((err) => console.error('users.lastSeenAt update failed', err));

      c.set('user', existing);
      tagSentryUser(existing.id, clerkUserId);
      return next();
    }

    // Stub row — the Clerk webhook (or a follow-up sync) will fill in
    // email, name, avatar. We only need a foreign-key target right now.
    const placeholderEmail = `pending+${clerkUserId}@clickefy.local`;
    const [created] = await c.var.db
      .insert(users)
      .values({
        clerkUserId,
        email: placeholderEmail,
        name: null,
        creditsBalance: 0,
      })
      .returning();

    if (!created) {
      return c.json(
        { error: { code: 'user_upsert_failed', message: 'Could not create user row.' } },
        500,
      );
    }

    c.set('user', created);
    tagSentryUser(created.id, clerkUserId);
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
 * Requires the current user to be an admin.
 *
 * Strictness layers (top → bottom: order matters):
 *   1. `user` populated by `withCurrentUser()` upstream — guarantees a
 *      DB row exists, not just a Clerk token.
 *   2. `is_deleted = false` — a soft-deleted admin must not regain
 *      access if their row is still around for retention.
 *   3. `entitlement === 'admin'` — strict equality on the enum (not a
 *      truthy check that could be tripped by an unknown value).
 *
 * Audit side-effect: on success, after the handler completes, an
 * `admin_audit_log` row is recorded for any successful POST/PATCH/
 * PUT/DELETE. The insert runs in `c.executionCtx.waitUntil()` so it
 * never adds latency to the response, never fails the request if the
 * insert itself errors, and never holds open the Worker beyond what
 * Cloudflare's runtime allows.
 */
export function withAdmin() {
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
    if (user.entitlement !== 'admin') {
      return c.json(
        { error: { code: 'forbidden', message: 'Admin entitlement required.' } },
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
      const resourceId = c.req.param('id') ?? null;
      const auditWrite = c.var.db
        .insert(adminAuditLog)
        .values({
          adminUserId: user.id,
          method,
          path: url.pathname,
          resourceId,
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
