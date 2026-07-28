/**
 * `jobs` — one row per user-initiated generation attempt.
 *
 * The lifecycle: `queued` (just created) → `processing` (Trigger.dev
 * picked it up) → `completed` | `failed`. On failure with refundable
 * cause, a compensating `+credits` row is appended to `credit_ledger`.
 *
 * `triggerRunId` correlates this row with the long-running Trigger.dev
 * task that's actually calling Gemini/Kling, so we can resume polling
 * status on app reopens without firing duplicate jobs.
 *
 * `purgeAt` is computed from the user's subscription expiry; the
 * retention cron drops result assets (but not the row) once that
 * timestamp passes.
 */

import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { jobStatusEnum } from './enums';
import type {
  JobError,
  JobInputValue,
  JobProgress,
  JobResult,
} from './json-types';
import { templates } from './templates';
import { templateVersions } from './template-versions';
import { users } from './users';

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    // Nullable since the "create from scratch" flow (source='user') has
    // no template. Template-driven jobs (source='template') always set
    // both. The FKs still restrict deletes so a referenced template can
    // never be hard-deleted out from under a job.
    templateId: uuid('template_id').references(() => templates.id, {
      onDelete: 'restrict',
    }),
    templateVersionId: uuid('template_version_id').references(() => templateVersions.id, {
      onDelete: 'restrict',
    }),

    // Provenance discriminator. 'template' (default) = a normal template
    // generation; 'user' = a prompt-first "create" generation. Drives the
    // worker branch, the Projects "Custom" badge, and catalog filtering.
    source: text('source').$type<'template' | 'user'>().default('template').notNull(),
    // Set only for source='user' jobs: the model the user picked and the
    // flat credit cost debited (create pricing is per-model, not per-template).
    modelKey: text('model_key'),
    costCredits: integer('cost_credits'),

    status: jobStatusEnum('status').default('queued').notNull(),
    progress: jsonb('progress').$type<JobProgress>(),

    inputs: jsonb('inputs').$type<Record<string, JobInputValue>>().notNull(),
    // `duration` (seconds) is only set for source='user' video jobs; it's
    // part of the same jsonb blob so no extra column is needed.
    options: jsonb('options')
      .$type<{ aspectRatio?: string; duration?: number }>()
      .default(sql`'{}'::jsonb`)
      .notNull(),

    result: jsonb('result').$type<JobResult>(),
    error: jsonb('error').$type<JobError>(),

    triggerRunId: text('trigger_run_id'),
    /** For POST idempotency — same key returns the existing job, never a duplicate. */
    idempotencyKey: text('idempotency_key'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    purgeAt: timestamp('purge_at', { withTimezone: true }),
  },
  (t) => [
    index('jobs_user_created_idx').on(t.userId, t.createdAt),
    // Matches the cursor pagination in `GET /v1/jobs`: the ORDER BY
    // is `(createdAt DESC, id DESC)` with the cursor predicate
    // `(createdAt, id) < (cursorTs, cursorId)`. A compound DESC index
    // lets the planner do an index-only seek and avoids the tiebreak
    // sort when two inserts share the same microsecond `now()`.
    // We keep `jobs_user_created_idx` as well so the migration can be
    // applied without dropping a live index under load.
    index('jobs_user_pagination_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    index('jobs_status_created_idx').on(t.status, t.createdAt),
    index('jobs_template_completed_idx').on(t.templateId, t.completedAt),
    index('jobs_purge_idx').on(t.purgeAt),
    index('jobs_idempotency_idx').on(t.userId, t.idempotencyKey),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
