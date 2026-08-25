/**
 * `project_assets` — one row per generated output filed into a project.
 * Materialized by the jobs-worker at job completion (inside the same
 * race-guarded block that marks the job completed), and by the copy
 * endpoint (copy = new row, move = `project_id` update).
 *
 * FK semantics follow house precedent:
 *   - `projectId` CASCADE — assets are owned by their project (delete
 *     project ⇒ rows go; the R2 objects stay and are swept by the
 *     retention crons, same as everywhere else — nothing deletes R2
 *     synchronously).
 *   - `jobId` SET NULL — the user can delete a job from their history
 *     without their filed asset vanishing (the `credit_ledger.jobId`
 *     "children survive" precedent).
 *
 * `r2Key` is the source of truth; delivery URLs are minted per-request
 * against the live origin (same self-healing pattern as job outputs).
 */

import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { jobs } from './jobs';
import { libraryAssets } from './asset-library';
import { projects } from './projects';
import { users } from './users';

export const projectAssets = pgTable(
  'project_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    /** Position of this output within its job (0-based). */
    outputIndex: integer('output_index').default(0).notNull(),
    // Plain text + TS union (not pgEnum) — matches the CreditBucket
    // judgment call for churn-prone sets.
    kind: text('kind').$type<'image' | 'video'>().notNull(),
    r2Key: text('r2_key').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationSec: real('duration_sec'),
    posterR2Key: text('poster_r2_key'),
    /**
     * Set when this asset was placed from "My Assets" rather than
     * generated (0035). Distinguishes "never had a job" from "the job was
     * deleted" — both leave `jobId` null, but only the latter should read
     * as a lost generation.
     *
     * SET NULL on delete: removing the library file must not remove the
     * copy already placed in a project, which keeps its own `r2Key`.
     */
    libraryAssetId: uuid('library_asset_id').references(() => libraryAssets.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    // Idempotency for the worker's completion insert: a Trigger.dev
    // retry can re-run the finalize block without duplicating rows.
    // Copies get `job_id = NULL`-adjacent semantics via fresh ids —
    // the unique triple only constrains worker-materialized rows.
    uniqueIndex('project_assets_job_output_uq').on(t.projectId, t.jobId, t.outputIndex),
    // Matches the asset-list query: `ORDER BY created_at DESC, id DESC`.
    index('project_assets_project_pagination_idx').on(
      t.projectId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('project_assets_user_idx').on(t.userId),
    index('project_assets_job_idx').on(t.jobId),
  ],
);

export type ProjectAsset = typeof projectAssets.$inferSelect;
export type NewProjectAsset = typeof projectAssets.$inferInsert;
