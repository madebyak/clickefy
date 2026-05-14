/**
 * `admin_audit_log` — one row per successful admin-side mutation.
 *
 * Written transparently by `withAdmin()` middleware after the handler
 * returns a 2xx, using `c.executionCtx.waitUntil()` so the write never
 * adds latency to the response and never causes a 5xx if the insert
 * itself fails.
 *
 * What we capture (and why):
 *   - `adminUserId`  — who. `ON DELETE SET NULL` so removing the admin
 *     row later doesn't destroy the audit trail.
 *   - `method`/`path`— what (and on what kind of resource). Stored as
 *     the raw HTTP tuple — we deliberately do not try to enumerate an
 *     `action` enum because the route surface evolves faster than any
 *     enum could keep up.
 *   - `resourceId`   — convenient extracted `:id` param, when present.
 *     Stored as text (not uuid) because some routes use non-uuid params
 *     (slug-based admin tooling, etc.).
 *   - `metadata`     — handler-supplied extras (e.g. publish notes,
 *     credit-grant amounts). Optional; null by default.
 *   - `ip`/`userAgent` — provenance signals for incident response.
 *
 * What we deliberately do NOT capture:
 *   - Request body verbatim. It often contains template prompts (proprietary)
 *     or credit adjustments (sensitive). If a specific route wants to
 *     record those it can pass them through `metadata`.
 *   - Response body. Similar reasoning; logs would balloon for list
 *     endpoints.
 */

import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id').references(() => users.id, { onDelete: 'set null' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('admin_audit_log_admin_idx').on(t.adminUserId, t.createdAt.desc()),
    index('admin_audit_log_path_idx').on(t.path, t.createdAt.desc()),
  ],
);

export type AdminAuditLogEntry = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLogEntry = typeof adminAuditLog.$inferInsert;
