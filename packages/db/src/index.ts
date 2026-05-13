/**
 * @clickfy/db — Drizzle schema + client factory for Clickefy.
 *
 * Importing this barrel gives you everything most consumers need:
 *
 *   import { createDb, schema, users, jobs, type Db } from '@clickfy/db';
 *
 * Migrations + drizzle-kit commands live alongside this package; see
 * the package.json scripts for the usual `db:generate` / `db:push`
 * / `db:studio` workflow.
 */

export * from './schema';
export { createDb, type CreateDbOptions, type Db } from './client';
export { sql, eq, ne, and, or, not, isNull, isNotNull, gt, gte, lt, lte, like, ilike, inArray, notInArray, desc, asc, count, sum, avg } from 'drizzle-orm';
