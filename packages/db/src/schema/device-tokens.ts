/**
 * Push notification device tokens.
 *
 * We store one row per (user, expoPushToken) pair. Expo tokens look
 * like `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]` and are stable per
 * device + install — uninstalling and reinstalling the app yields a
 * fresh token. The same physical device can also produce a new token
 * over time (Apple rotates APNs tokens, Android rotates FCM tokens),
 * so we de-dupe by token (UNIQUE) and let the registration endpoint
 * upsert.
 *
 * Why UNIQUE on `expoPushToken` and not `(userId, expoPushToken)`:
 * A token is tied to an install, not a user. If user A signs out and
 * user B signs in on the same device, the device's token MUST move
 * to user B — sending a push to user A would land on user B's
 * lockscreen. Upserting by token enforces that handover.
 *
 * Lifecycle:
 *   - Created on first launch after permission grant.
 *   - Updated whenever Expo issues a new token (on every cold start
 *     we call `getExpoPushTokenAsync()` and POST it).
 *   - Marked `isActive=false` when Expo's API responds with
 *     `DeviceNotRegistered` for a send — the receipt poller flips
 *     the flag so we stop spending on dead tokens.
 *   - Deleted on explicit sign-out + on account delete (handled by
 *     ON DELETE CASCADE from the users FK).
 */

import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** ExponentPushToken[...] — issued by Expo. */
    expoPushToken: text('expo_push_token').notNull().unique(),
    /** 'ios' | 'android' | 'unknown' — best-effort from device metadata. */
    platform: text('platform').notNull(),
    /** Marketing app version e.g. "1.0.3". Useful for targeted broadcasts. */
    appVersion: text('app_version'),
    /** Device locale (en, ar-AE, …) — used to localise broadcast copy later. */
    locale: text('locale'),
    /** Flipped to false when Expo reports DeviceNotRegistered. */
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    // Push-to-user fan-out: "give me every active token for user X".
    index('device_tokens_user_active_idx').on(t.userId, t.isActive),
    // Broadcast queries: "every active token", optionally filtered by
    // platform / locale. The trailing isActive lets us cheaply scope.
    index('device_tokens_active_idx').on(t.isActive, t.platform),
  ],
);

export type DeviceToken = typeof deviceTokens.$inferSelect;
export type NewDeviceToken = typeof deviceTokens.$inferInsert;
