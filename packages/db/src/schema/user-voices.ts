/**
 * `user_voices` — voices a user made (cloned from a recording, or designed
 * from a description) and owns inside Clickefy.
 *
 * Every such voice lives on the client's single ElevenLabs account, which
 * has a fixed number of custom-voice slots (30 on the Creator plan). This
 * table is what makes them private: the voices route shows a user only
 * the rows here that are theirs, and the per-user cap and the account
 * guard are counted from it. Deleting marks the row and removes the voice
 * from ElevenLabs, which frees the slot.
 */

import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export type UserVoiceOrigin = 'cloned' | 'designed';
export type UserVoiceStatus = 'ready' | 'pending_verification' | 'deleted';

export const userVoices = pgTable(
  'user_voices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** The voice on the ElevenLabs account. */
    elevenlabsVoiceId: text('elevenlabs_voice_id').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    origin: text('origin').$type<UserVoiceOrigin>().notNull(),
    status: text('status').$type<UserVoiceStatus>().notNull().default('ready'),
    /** Labels sent to ElevenLabs (language, accent, gender, age) — free text from the user. */
    labels: jsonb('labels').$type<Record<string, string>>(),
    /** Credits charged when it was made; shown in the ledger metadata too. */
    creditsCharged: text('credits_charged'),
    /**
     * When the user confirmed they hold the rights to this voice. The
     * ElevenLabs terms require explicit consent per clone; the timestamp
     * and the text version are the record of it.
     */
    consentAt: timestamp('consent_at', { withTimezone: true }),
    consentVersion: text('consent_version'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => [index('user_voices_user_idx').on(t.userId, t.status, t.createdAt)],
);

export type UserVoice = typeof userVoices.$inferSelect;
export type NewUserVoice = typeof userVoices.$inferInsert;
