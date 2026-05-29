/**
 * Helpers for the many-to-many `template_categories` relation.
 *
 * Two responsibilities live here:
 *   1. A reusable SQL fragment (`templateInCategory`) that every
 *      "show me templates in category X" query uses. Centralised so
 *      changes to the membership rules (e.g. soft-delete, scoped
 *      visibility) hit one place.
 *   2. Read + write helpers for the join rows themselves: load the
 *      ordered category list for one template, load the bulk map for
 *      a page of templates, and replace the membership set atomically
 *      for a single template on create / update.
 *
 * Atomicity note:
 *   The `neon-http` driver is stateless, so we don't have interactive
 *   transactions. The write helper uses a single multi-statement CTE
 *   so Postgres treats "delete the old rows + insert the new ones" as
 *   one round-trip — the partial unique index on `(template_id) WHERE
 *   is_primary` then enforces "at most one primary" even under retry.
 */

import type { Db } from '@clickfy/db';
import { templateCategories } from '@clickfy/db';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';

/**
 * SQL fragment: "this template belongs to `categoryId`" (strict).
 *
 * Strict = exact match on the join row. Does NOT aggregate descendants
 * — for that, use `templateInCategoryTree`. Strict is the right call
 * for admin filters where the operator wants the literal category they
 * picked; the public/mobile path uses the tree variant so a root rail
 * naturally includes its children's templates (decision 1 of the
 * sub-categories design doc).
 *
 * Usage:
 *   const whereParts: SQL[] = [eq(templates.status, 'published')];
 *   if (q.categoryId) whereParts.push(templateInCategory(q.categoryId));
 *
 * Implementation note: we deliberately write the `EXISTS (...)` shape
 * by hand instead of using Drizzle's `exists()` helper. The helper
 * emits `exists ${subquery}` *without parentheses*, so wrapping a raw
 * `sql\`SELECT 1 ...\`` fragment produces invalid SQL ("syntax error
 * at or near SELECT") at runtime. Drizzle's helper is designed for the
 * query-builder Subquery type, which adds its own parens — but we
 * don't have a query-builder handle on `templates.id` from inside this
 * helper, so we go straight to raw SQL. The `${categoryId}` binding
 * is still parameterised by Drizzle, so the fragment is injection-safe.
 *
 * The three sibling helpers below (`primaryCategoryMatch`,
 * `templateInCategoryTree`, `primaryCategoryTreeMatch`) follow the same
 * raw-SQL pattern for the same reason.
 */
export function templateInCategory(categoryId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${templateCategories}
    WHERE ${templateCategories.templateId} = templates.id
      AND ${templateCategories.categoryId} = ${categoryId}::uuid
  )`;
}

/**
 * SQL fragment: "this template is primary'd to `categoryId`" (strict).
 *
 * Used by per-category home rails so a multi-category template surfaces
 * in its primary's rail only — extras don't pull it into every rail
 * they belong to. Same shape as `templateInCategory` plus an
 * `is_primary = true` predicate.
 */
export function primaryCategoryMatch(categoryId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${templateCategories}
    WHERE ${templateCategories.templateId} = templates.id
      AND ${templateCategories.isPrimary} = true
      AND ${templateCategories.categoryId} = ${categoryId}::uuid
  )`;
}

/**
 * SQL fragment: "this template belongs to `categoryId` OR any direct
 * child of `categoryId`" (tree-aggregating).
 *
 * Used by the public catalog filter and the scoped-sections branch so
 * tapping a root category on mobile aggregates the templates assigned
 * directly to it AND those assigned to its sub-categories — matching
 * the "parent aggregation" decision from the design discussion.
 *
 * Why a single JOIN works (no recursive CTE):
 * the category hierarchy is capped at two levels (parent → child, no
 * grandchildren — enforced by the server-side guard in
 * `routes/categories.ts`). So `(c.id = $1 OR c.parent_id = $1)` covers
 * every reachable row in O(1) join hops.
 *
 * Cost: one extra index lookup on `categories.parent_id` per matching
 * template row (the table is tiny — dozens of rows — so this is
 * effectively free even when fan-out is large).
 *
 * Note: passing a leaf `categoryId` here is safe. The `c.parent_id =
 * $1` branch matches nothing (a leaf cannot itself be a parent under
 * the 2-level cap), so the behaviour collapses to the strict variant.
 * That property lets callers always reach for the tree variant without
 * a root-vs-leaf dispatch lookup.
 */
export function templateInCategoryTree(categoryId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${templateCategories} tc
    JOIN categories c ON c.id = tc.category_id
    WHERE tc.template_id = templates.id
      AND (c.id = ${categoryId}::uuid OR c.parent_id = ${categoryId}::uuid)
  )`;
}

/**
 * SQL fragment: "this template is primary'd to `categoryId` OR any
 * direct child of `categoryId`" (tree-aggregating, primary-only).
 *
 * Used by the per-category home rails so a root rail naturally
 * includes templates whose primary is one of its sub-categories.
 * Mirrors `templateInCategoryTree` with an `is_primary = true` filter.
 */
export function primaryCategoryTreeMatch(categoryId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${templateCategories} tc
    JOIN categories c ON c.id = tc.category_id
    WHERE tc.template_id = templates.id
      AND tc.is_primary = true
      AND (c.id = ${categoryId}::uuid OR c.parent_id = ${categoryId}::uuid)
  )`;
}

/**
 * Result of loading a template's category memberships, in the
 * canonical display order: primary first, then extras by `sort_order`.
 */
export interface OrderedCategories {
  /** Primary category id. Always present (every template must have a
   *  primary; the partial unique index makes this a DB-enforced fact
   *  for the at-most-one half, and the write path guarantees the
   *  at-least-one half). */
  primary: string;
  /** Extras in display order (0..2 items). */
  extras: string[];
  /** Concatenated list `[primary, ...extras]` for callers that just
   *  want a flat array. */
  all: string[];
}

/**
 * Load and order the categories for a single template.
 */
export async function loadTemplateCategories(
  db: Db,
  templateId: string,
): Promise<OrderedCategories | null> {
  const rows = await db
    .select({
      categoryId: templateCategories.categoryId,
      isPrimary: templateCategories.isPrimary,
      sortOrder: templateCategories.sortOrder,
    })
    .from(templateCategories)
    .where(eq(templateCategories.templateId, templateId));

  if (rows.length === 0) return null;
  const primary = rows.find((r) => r.isPrimary);
  if (!primary) return null;
  const extras = rows
    .filter((r) => !r.isPrimary)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => r.categoryId);
  return {
    primary: primary.categoryId,
    extras,
    all: [primary.categoryId, ...extras],
  };
}

/**
 * Bulk-load category memberships for a page of templates. Returns a
 * `Map<templateId, OrderedCategories>` so callers can attach the
 * memberships to each row without an N+1.
 */
export async function loadTemplateCategoriesMap(
  db: Db,
  templateIds: string[],
): Promise<Map<string, OrderedCategories>> {
  if (templateIds.length === 0) return new Map();

  const rows = await db
    .select({
      templateId: templateCategories.templateId,
      categoryId: templateCategories.categoryId,
      isPrimary: templateCategories.isPrimary,
      sortOrder: templateCategories.sortOrder,
    })
    .from(templateCategories)
    .where(inArray(templateCategories.templateId, templateIds));

  // Group by templateId then sort each group's secondaries.
  const byTemplate = new Map<
    string,
    { primary: string | null; extras: Array<{ id: string; sort: number }> }
  >();
  for (const r of rows) {
    let entry = byTemplate.get(r.templateId);
    if (!entry) {
      entry = { primary: null, extras: [] };
      byTemplate.set(r.templateId, entry);
    }
    if (r.isPrimary) {
      entry.primary = r.categoryId;
    } else {
      entry.extras.push({ id: r.categoryId, sort: r.sortOrder });
    }
  }

  const out = new Map<string, OrderedCategories>();
  for (const [tid, e] of byTemplate.entries()) {
    if (!e.primary) continue; // skip orphaned rows defensively
    const extras = e.extras.sort((a, b) => a.sort - b.sort).map((x) => x.id);
    out.set(tid, {
      primary: e.primary,
      extras,
      all: [e.primary, ...extras],
    });
  }
  return out;
}

/**
 * Validate that the requested membership set is internally consistent.
 * Cheap; throws on bad input before we touch the DB.
 */
export function validateCategorySet(input: {
  primaryCategoryId: string;
  extraCategoryIds: string[];
}): { ok: true } | { ok: false; reason: string } {
  if (input.extraCategoryIds.length > 2) {
    return { ok: false, reason: 'A template can belong to at most 3 categories (1 primary + 2 extras).' };
  }
  if (input.extraCategoryIds.includes(input.primaryCategoryId)) {
    return { ok: false, reason: 'The primary category cannot also be listed as an extra.' };
  }
  const seen = new Set<string>();
  for (const id of input.extraCategoryIds) {
    if (seen.has(id)) return { ok: false, reason: 'Duplicate extra category id.' };
    seen.add(id);
  }
  return { ok: true };
}

/**
 * Replace the membership set for `templateId`.
 *
 * Implementation note (read before "optimising" this):
 *
 *   We do DELETE and INSERT as two separate statements rather than
 *   a single CTE. A CTE looks tempting (`WITH deleted AS (DELETE …)
 *   INSERT …`) but Postgres runs every leg of a single statement
 *   against the *same snapshot*: the INSERT's uniqueness check on
 *   `(template_id, category_id)` never sees the DELETE's effects,
 *   so any pair that existed before AND appears in the new set
 *   trips the PK and we get a 500. The classic shape is "admin
 *   changes the primary but keeps category X as an extra".
 *
 *   Two separate calls cost one extra HTTP round-trip on neon-http
 *   and dodge the snapshot trap entirely. The brief window between
 *   delete and insert where the template has zero memberships is
 *   acceptable: reads in that window simply see an empty list, and
 *   the partial unique index on `(template_id) WHERE is_primary`
 *   still rejects any "two primaries" pathology if anything were
 *   to race us.
 *
 *   neon-http is stateless so we can't wrap these in a real Postgres
 *   transaction — accepted trade-off for the gain in simplicity.
 */
export async function replaceTemplateCategories(
  db: Db,
  templateId: string,
  primary: string,
  extras: ReadonlyArray<string>,
): Promise<void> {
  const v = validateCategorySet({
    primaryCategoryId: primary,
    extraCategoryIds: [...extras],
  });
  if (!v.ok) throw new Error(v.reason);

  // Build the rows: primary first (sortOrder 0; sortOrder is unused
  // for the primary in the UI but we keep it tidy), then extras with
  // ascending sort_order matching the array index.
  const rows = [
    { templateId, categoryId: primary, isPrimary: true, sortOrder: 0 },
    ...extras.map((id, idx) => ({
      templateId,
      categoryId: id,
      isPrimary: false,
      sortOrder: idx,
    })),
  ];

  await db
    .delete(templateCategories)
    .where(eq(templateCategories.templateId, templateId));
  await db.insert(templateCategories).values(rows);
}

/**
 * Insert the initial membership set for a freshly-created template.
 * Same atomicity story as `replaceTemplateCategories` minus the
 * delete branch — there are no rows to clean up.
 */
export async function insertTemplateCategories(
  db: Db,
  templateId: string,
  primary: string,
  extras: ReadonlyArray<string>,
): Promise<void> {
  const v = validateCategorySet({
    primaryCategoryId: primary,
    extraCategoryIds: [...extras],
  });
  if (!v.ok) throw new Error(v.reason);

  const rows: Array<{ categoryId: string; isPrimary: boolean; sortOrder: number }> = [
    { categoryId: primary, isPrimary: true, sortOrder: 0 },
    ...extras.map((id, idx) => ({ categoryId: id, isPrimary: false, sortOrder: idx })),
  ];

  await db.insert(templateCategories).values(
    rows.map((r) => ({
      templateId,
      categoryId: r.categoryId,
      isPrimary: r.isPrimary,
      sortOrder: r.sortOrder,
    })),
  );
}

/**
 * Suppress unused-import warning for the symbols re-exported here so
 * downstream files can import them from this module if they prefer.
 */
export { templateCategories, and };
