/**
 * Category — organizes templates in the mobile app's browse screen.
 *
 * Source of truth: `packages/db/src/schema/categories.ts` (Postgres).
 * Mirrored here so the admin dashboard can typecheck without depending
 * on Drizzle directly.
 *
 * Dates arrive as ISO strings over the wire and are kept as strings
 * here — the admin layer parses them with `new Date(...)` only when
 * formatting for display.
 */
import type { CategoryTranslations } from './localization';

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  iconUrl: string | null;
  sortOrder: number;
  /**
   * Non-English `name` overrides keyed by locale; English `name` above is
   * the fallback. Optional/`null` when no translations exist.
   */
  translations?: CategoryTranslations | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Direct sub-categories of this row, attached server-side by
   * `GET /v1/categories`. Always present on roots (possibly empty);
   * always `[]` on child rows (the hierarchy is capped at two levels).
   * Optional so older consumers compiled before this field landed
   * still typecheck.
   */
  children?: Category[];
}

/**
 * Shape submitted by the admin's category form. Slug is optional —
 * if omitted, the server (or the form) derives it from `name`.
 */
export interface CategoryFormData {
  name: string;
  slug?: string;
  parentId: string | null;
  iconUrl: string | null;
  sortOrder?: number;
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
  level: number;
}
