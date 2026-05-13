/**
 * /v1/users — current-user endpoints.
 *
 *   GET  /me           — canonical "who am I + plan + preferences"
 *   PATCH /me          — update name / locale / preferences
 *   POST /me/avatar    — upload (or replace) the profile photo
 *
 * Email is intentionally NOT writable here. Email changes must go
 * through Clerk's verified flow; the webhook in `routes/webhooks/clerk.ts`
 * reflects the new value back into Neon.
 *
 * Identity (`name`, `avatarUrl`) is two-sided: Clerk is the source of
 * truth, and we mirror via webhook. PATCH/avatar handlers therefore
 * write to Neon AND push to Clerk so the round-trip is consistent even
 * if the webhook is delayed.
 */

import { createClerkClient } from '@clerk/backend';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  withPreferenceDefaults,
  type MeResponse,
  type UserPreferences,
} from '@clickfy/types';
import { users } from '@clickfy/db';

import type { AppEnv } from '../types';
import { withAuth, withCurrentUser } from '../middleware/with-auth';

export const usersRoute = new Hono<AppEnv>();

// ─── Zod schemas ────────────────────────────────────────────────────

const appearancePatchSchema = z
  .object({
    mode: z.enum(['system', 'light', 'dark']).optional(),
    accent: z.enum(['violet', 'coral', 'citrus', 'ocean']).optional(),
  })
  .strict();

const notificationsPatchSchema = z
  .object({
    jobCompleted: z.boolean().optional(),
    productUpdates: z.boolean().optional(),
    tipsAndTutorials: z.boolean().optional(),
  })
  .strict();

const preferencesPatchSchema = z
  .object({
    appearance: appearancePatchSchema.optional(),
    notifications: notificationsPatchSchema.optional(),
  })
  .strict();

const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    locale: z.enum(['en', 'ar']).optional(),
    preferences: preferencesPatchSchema.optional(),
  })
  .strict();

// ─── Helpers ────────────────────────────────────────────────────────

function toMeResponse(row: typeof users.$inferSelect): MeResponse {
  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    locale: row.locale,
    entitlement: row.entitlement,
    creditsBalance: row.creditsBalance,
    subscriptionRenewsAt: row.subscriptionRenewsAt?.toISOString() ?? null,
    subscriptionExpiresAt: row.subscriptionExpiresAt?.toISOString() ?? null,
    preferences: withPreferenceDefaults(row.preferences),
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/**
 * Splits a free-form display name into Clerk's `firstName` / `lastName`.
 * Single-word names go entirely into `firstName` with `lastName = ''`.
 */
function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  const last = parts.pop()!;
  return { firstName: parts.join(' '), lastName: last };
}

// ─── Routes ─────────────────────────────────────────────────────────

usersRoute.get('/me', withAuth({ required: true }), withCurrentUser(), (c) => {
  return c.json({ data: toMeResponse(c.var.user!) });
});

usersRoute.patch(
  '/me',
  withAuth({ required: true }),
  withCurrentUser(),
  zValidator('json', updateProfileSchema),
  async (c) => {
    const current = c.var.user!;
    const body = c.req.valid('json');

    // Deep-merge the preference patch onto the current row so callers
    // only have to send the fields they're changing. `withPreferenceDefaults`
    // also guards against stale rows that pre-date a key.
    const currentPrefs = withPreferenceDefaults(current.preferences);
    const nextPrefs: UserPreferences = body.preferences
      ? {
          appearance: {
            ...currentPrefs.appearance,
            ...(body.preferences.appearance ?? {}),
          },
          notifications: {
            ...currentPrefs.notifications,
            ...(body.preferences.notifications ?? {}),
          },
        }
      : currentPrefs;

    // Mirror the name update to Clerk so identity stays consistent across
    // surfaces (Clerk-hosted UIs, JWT claims, etc.). We swallow Clerk
    // errors so a flaky Clerk API doesn't block our own DB write —
    // worst case the webhook reconciles us later.
    if (body.name !== undefined && body.name !== current.name) {
      if (c.env.CLERK_SECRET_KEY) {
        try {
          const clerk = createClerkClient({ secretKey: c.env.CLERK_SECRET_KEY });
          const { firstName, lastName } = splitName(body.name);
          await clerk.users.updateUser(current.clerkUserId, { firstName, lastName });
        } catch (err) {
          console.error('[users.patch] Clerk name sync failed (continuing):', err);
        }
      } else {
        console.warn('[users.patch] CLERK_SECRET_KEY missing — skipping Clerk name sync');
      }
    }

    const [updated] = await c.var.db
      .update(users)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.locale !== undefined && { locale: body.locale }),
        ...(body.preferences !== undefined && { preferences: nextPrefs }),
      })
      .where(eq(users.id, current.id))
      .returning();

    if (!updated) {
      return c.json(
        { error: { code: 'update_failed', message: 'User row could not be updated.' } },
        500,
      );
    }

    return c.json({ data: toMeResponse(updated) });
  },
);

// ─── Avatar upload ──────────────────────────────────────────────────

const AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_MAX_BYTES = 4 * 1024 * 1024; // 4MB
const AVATAR_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

usersRoute.post(
  '/me/avatar',
  withAuth({ required: true }),
  withCurrentUser(),
  async (c) => {
    const bucket = c.env.UPLOADS;
    if (!bucket) {
      return c.json(
        { error: { code: 'r2_not_configured', message: 'Uploads bucket binding missing.' } },
        503,
      );
    }

    const form = await c.req.formData();
    const entry = form.get('file');

    interface UploadedFile {
      name: string;
      type: string;
      size: number;
      stream(): ReadableStream<Uint8Array>;
    }
    const isUploadedFile = (v: unknown): v is UploadedFile =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as { stream?: unknown }).stream === 'function' &&
      typeof (v as { size?: unknown }).size === 'number';

    if (!isUploadedFile(entry)) {
      return c.json(
        { error: { code: 'invalid_file', message: 'Missing `file` field.' } },
        400,
      );
    }
    if (!AVATAR_MIME.has(entry.type)) {
      return c.json(
        {
          error: {
            code: 'invalid_mime',
            message: `Allowed types: ${[...AVATAR_MIME].join(', ')}.`,
          },
        },
        400,
      );
    }
    if (entry.size > AVATAR_MAX_BYTES) {
      return c.json(
        {
          error: {
            code: 'file_too_large',
            message: `Max avatar size is ${AVATAR_MAX_BYTES / 1024 / 1024}MB.`,
          },
        },
        413,
      );
    }

    const current = c.var.user!;
    const ext = AVATAR_EXT[entry.type] ?? 'bin';
    // One stable folder per user so future cleanup (delete-account) is
    // a single `bucket.list({ prefix: 'avatars/<id>/' })`. We still use
    // a fresh uuid for the file name so old cached URLs invalidate.
    const key = `avatars/${current.id}/${crypto.randomUUID()}.${ext}`;

    await bucket.put(key, entry.stream(), {
      httpMetadata: {
        contentType: entry.type,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        uploadedBy: current.id,
        originalName: entry.name,
      },
    });

    const origin = new URL(c.req.url).origin;
    const url = `${origin}/v1/uploads/${key}`;

    // Note: we deliberately don't push the avatar back to Clerk. The
    // mobile + admin apps read avatars exclusively from `users.avatar_url`
    // (this DB row), so the R2 URL is the user-facing truth. Clerk's
    // own `image_url` will only update when the user changes it via
    // Clerk's hosted UI, in which case our webhook reconciles us.

    const [updated] = await c.var.db
      .update(users)
      .set({ avatarUrl: url })
      .where(eq(users.id, current.id))
      .returning();

    if (!updated) {
      return c.json(
        { error: { code: 'update_failed', message: 'Could not persist avatar.' } },
        500,
      );
    }

    return c.json({ data: toMeResponse(updated) });
  },
);
