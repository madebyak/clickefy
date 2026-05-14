/**
 * `reports` — user-submitted content flags.
 *
 * Required by both App Store guideline 1.2 (UGC apps must offer an
 * in-app reporting mechanism) and the Google Play Restricted Content
 * policy. Beyond compliance, the table is the primary input to our
 * admin moderation queue: every "flag this output" tap from mobile
 * lands here and stays in `open` status until an admin triages it.
 *
 * Schema choices worth calling out:
 *
 *   - `target_type` + `target_id` (text). A single polymorphic FK
 *     would force one column per kind (job_output_id, template_id,
 *     etc.) and a check constraint to enforce exclusivity — verbose
 *     and unfriendly to a generic admin queue. Using a typed enum +
 *     opaque text id keeps the table flat and lets the admin UI
 *     dispatch by `target_type` without joins. The downside (no DB-
 *     enforced referential integrity) is acceptable here because we
 *     never DELETE rows we'd want to FK to — jobs and templates are
 *     soft-deleted in place.
 *
 *   - `reporter_user_id` → `users.id`, `ON DELETE SET NULL`. If a
 *     user deletes their account we keep the report (and its trail
 *     of admin actions in `admin_audit_log`) but anonymise it.
 *
 *   - `reason` enum is finite + escalation-friendly. `csam` is a
 *     dedicated reason because it triggers an immediate-action
 *     workflow that must short-circuit normal triage SLAs.
 *
 *   - `status` lifecycle: open → reviewing → resolved | dismissed.
 *     `reviewing` is a soft claim by an admin so two reviewers
 *     don't process the same report in parallel.
 *
 *   - Index strategy: the moderation queue almost always fetches
 *     "newest open" — so `(status, created_at DESC)` is the workhorse.
 *     A second `(target_type, target_id)` index is for the "any
 *     pending reports on this output?" lookup the result screen
 *     can run before showing the user a "you've already reported
 *     this" pill.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import {
  reportReasonEnum,
  reportStatusEnum,
  reportTargetTypeEnum,
} from './enums';
import { users } from './users';

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterUserId: uuid('reporter_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    targetType: reportTargetTypeEnum('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: reportReasonEnum('reason').notNull(),
    /** Free-form context from the reporter. Optional. */
    notes: text('notes'),
    status: reportStatusEnum('status').default('open').notNull(),
    /** Internal admin write-only field — visible only on the admin
     *  side, never shipped back to the reporter. */
    adminNotes: text('admin_notes'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('reports_status_created_idx').on(t.status, t.createdAt.desc()),
    index('reports_target_idx').on(t.targetType, t.targetId),
    index('reports_reporter_idx').on(t.reporterUserId, t.createdAt.desc()),
  ],
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
