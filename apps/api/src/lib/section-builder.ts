/**
 * Composite home-screen section builder for the mobile catalog.
 *
 * The mobile home renders a stack of horizontal rails ("Trending Now",
 * "New Arrivals", per-category, …). Rather than firing N HTTP requests
 * from the app, the Worker assembles the whole layout in a single
 * response.
 *
 * Why this lives here (not inline in the route file):
 *
 *   - The query fan-out is the most expensive thing the public catalog
 *     does. Keeping it isolated makes the surface easy to reason about
 *     and easy to swap for an admin-curated `home_sections` table later
 *     — the route stays as-is, only this function changes.
 *
 *   - Each section's eligibility rule (e.g. "≥3 templates to show New
 *     Arrivals") is encoded as a single declarative entry, so adding /
 *     reordering rails is a one-line change.
 *
 * Performance posture:
 *
 *   - Every section query is indexed (templates_featured_status_idx,
 *     templates_kind_status_idx, templates_category_status_idx) and
 *     bounded with LIMIT 8.
 *   - All queries run in `Promise.all` — fan-out is parallel, so the
 *     total wall time is ~1 round-trip even with 10 categories.
 *   - The route serves the response with `s-maxage=60`, so Cloudflare's
 *     edge cache absorbs the vast majority of opens; only one request
 *     per region per minute reaches the Worker on a steady-state feed.
 */

import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';

import type { Db } from '@clickfy/db';
import { categories, templates, type Template as DbTemplate } from '@clickfy/db';
import type { MobileTemplate } from '@clickfy/types';

import { templateToMobileDTO } from './template-dto';
import {
  loadTemplateCategoriesMap,
  templateInCategory,
} from './template-categories';

export type HomeSectionLayout = 'bento' | 'carousel';

export interface HomeSection {
  /** Stable key for client-side React `key` and analytics. */
  key: string;
  title: string;
  subtitle: string;
  layout: HomeSectionLayout;
  templates: MobileTemplate[];
}

export interface BuildHomeSectionsOptions {
  publicBaseUrl: string;
  /** Hard cap per rail; bigger doesn't help on a phone. */
  perSectionLimit?: number;
  /**
   * When set, the response is scoped to that single category — useful
   * for the home screen's category chips ("Skincare", "Fashion", …).
   * The Trending / New / Video / Sets rails still appear if there's
   * relevant content within the category; per-category rails do not
   * (we never show every category when the user picked one).
   *
   * `'all'` and the empty string are both treated as "no filter".
   */
  categoryId?: string;
}

// Shared WHERE clause: only published templates ever surface in the
// public catalog. Codified here so a misclicked typo in one of the
// section queries can't accidentally leak drafts.
function publishedAnd(...extra: SQL[]): SQL {
  return and(eq(templates.status, 'published'), ...extra)!;
}

/**
 * Run every section query in parallel and assemble the final layout.
 * Empty rails are filtered out client-invisible — the response only
 * carries sections that actually have something to show.
 */
export async function buildHomeSections(
  db: Db,
  opts: BuildHomeSectionsOptions,
): Promise<HomeSection[]> {
  const limit = opts.perSectionLimit ?? 8;
  const scopeCategoryId =
    opts.categoryId && opts.categoryId !== 'all' && opts.categoryId.length > 0
      ? opts.categoryId
      : undefined;

  // Helper closure: tack on the category-scope WHERE clause when set.
  // Kept inline rather than passed through every call site below.
  // Category membership is now an EXISTS join against
  // `template_categories` (primary OR extra match).
  const scoped = (...extra: SQL[]): SQL =>
    scopeCategoryId
      ? publishedAnd(templateInCategory(scopeCategoryId), ...extra)
      : publishedAnd(...extra);

  // Fan-out: featured, recently-published, kind=video, kind=image_set,
  // plus the ordered category list (we need the IDs *and* names before
  // we can fire per-category queries — but only when no category is
  // scoped; otherwise the per-category rails are skipped).
  const [featuredRows, recentRows, videoRows, setRows, categoryRows] =
    await Promise.all([
      db
        .select()
        .from(templates)
        .where(scoped(eq(templates.featured, true)))
        .orderBy(desc(templates.publishedAt), desc(templates.createdAt))
        .limit(limit),
      db
        .select()
        .from(templates)
        .where(scoped())
        .orderBy(desc(templates.publishedAt), desc(templates.createdAt))
        .limit(limit),
      db
        .select()
        .from(templates)
        .where(scoped(eq(templates.kind, 'video')))
        .orderBy(desc(templates.publishedAt), desc(templates.createdAt))
        .limit(limit),
      db
        .select()
        .from(templates)
        .where(scoped(eq(templates.kind, 'image_set')))
        .orderBy(desc(templates.publishedAt), desc(templates.createdAt))
        .limit(limit),
      scopeCategoryId
        ? Promise.resolve([])
        : db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    ]);

  // Second wave: one query per category, also in parallel. Categories
  // with zero published templates are pruned below.  Skipped entirely
  // in scoped mode (the user already chose a category).
  //
  // For per-category rails we use the primary-only predicate so a
  // multi-category template surfaces only in its primary's rail
  // (Q3 of the design discussion). The "Trending" / "New Arrivals"
  // cross-cutting rails are unaffected and continue to feature it.
  const categoryTemplateRows = scopeCategoryId
    ? []
    : await Promise.all(
        categoryRows.map((cat) =>
          db
            .select()
            .from(templates)
            .where(publishedAnd(primaryCategoryMatch(cat.id)))
            .orderBy(desc(templates.publishedAt), desc(templates.createdAt))
            .limit(limit),
        ),
      );

  // We need each row's categoryIds for the DTO. Collect every
  // template id that lands in any rail and bulk-load.
  const allRows = [
    ...featuredRows,
    ...recentRows,
    ...videoRows,
    ...setRows,
    ...categoryTemplateRows.flat(),
  ];
  const ids = Array.from(new Set(allRows.map((r) => r.id)));
  const catsMap = await loadTemplateCategoriesMap(db, ids);

  const toDto = (row: DbTemplate): MobileTemplate =>
    templateToMobileDTO(row, {
      publicBaseUrl: opts.publicBaseUrl,
      categoryIds: catsMap.get(row.id)?.all ?? [],
    });

  const sections: HomeSection[] = [];

  if (featuredRows.length > 0) {
    sections.push({
      key: 'trending',
      title: 'Trending Now',
      subtitle: 'Hand-picked highlights',
      layout: 'bento',
      templates: featuredRows.map(toDto),
    });
  }

  // "New Arrivals" needs enough cards to actually feel like a rail.
  // A single card is just a teaser and looks broken.
  if (recentRows.length >= 3) {
    sections.push({
      key: 'new-arrivals',
      title: 'New Arrivals',
      subtitle: 'Fresh templates added recently',
      layout: 'carousel',
      templates: recentRows.map(toDto),
    });
  }

  if (videoRows.length > 0) {
    sections.push({
      key: 'video-magic',
      title: 'Video Magic',
      subtitle: 'Bring your shots to life',
      layout: 'carousel',
      templates: videoRows.map(toDto),
    });
  }

  if (setRows.length > 0) {
    sections.push({
      key: 'photo-sets',
      title: 'Photo Sets',
      subtitle: 'Coordinated lookbooks',
      layout: 'carousel',
      templates: setRows.map(toDto),
    });
  }

  // Per-category rails follow the admin's drag-drop order. Any
  // category without published templates is silently dropped.
  //
  // Cross-rail dedup: with multi-category templates a template could
  // theoretically appear in multiple per-category rails. The product
  // rule (confirmed with the user) is "show in primary's rail only" —
  // and because we already query per-category rails with `is_primary
  // = true`, no template can appear in more than one of these rails.
  // The dedup pass below is a belt-and-braces guard: if two rails
  // somehow share a template (e.g. a future change relaxes the
  // primary filter), the first rail wins and later rails skip it.
  const seenInCategoryRails = new Set<string>();
  for (let i = 0; i < categoryRows.length; i++) {
    const cat = categoryRows[i]!;
    const rowsForCat = categoryTemplateRows[i]!;
    const filtered = rowsForCat.filter((r) => {
      if (seenInCategoryRails.has(r.id)) return false;
      seenInCategoryRails.add(r.id);
      return true;
    });
    if (filtered.length === 0) continue;
    sections.push({
      key: `category-${cat.id}`,
      title: cat.name,
      subtitle: `Browse ${cat.name.toLowerCase()}`,
      layout: 'carousel',
      templates: filtered.map(toDto),
    });
  }

  return sections;
}

/**
 * "Primary category of this template equals X" — used by per-category
 * rails so the home feed shows each multi-cat template under its
 * primary's rail only. EXISTS subquery on the join table with
 * `is_primary = true`. The broader "primary OR extras" match is what
 * `templateInCategory` provides for catalog list + scoped sections.
 */
function primaryCategoryMatch(categoryId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM template_categories tc
    WHERE tc.template_id = templates.id
      AND tc.is_primary = true
      AND tc.category_id = ${categoryId}::uuid
  )`;
}
