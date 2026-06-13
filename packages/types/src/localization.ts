/**
 * Localization shapes for user-facing content tables.
 *
 * Design (see migration `0018_localization_translations.sql`):
 *   - English stays canonical in the existing columns (`title`,
 *     `description`, `name`, `subtitle`, `ctaLabel`, …) and is the
 *     guaranteed fallback.
 *   - The `translations` JSONB column holds ONLY non-English overrides,
 *     keyed by locale. Anything absent falls back to the English column
 *     at the API layer.
 *
 * Locale-keyed (not a fixed `ar` field) so adding a future language is a
 * data change, not a schema/type change.
 */

import type { UserLocale } from './user';

// ─── Templates ──────────────────────────────────────────────────────

/** Per-field overrides for a single `TemplateInputField`, keyed by fieldKey. */
export interface TemplateInputTranslation {
  label?: string;
  helperText?: string;
  placeholder?: string;
  /** Translated `select` option labels, keyed by the option `value`. */
  options?: Record<string, string>;
}

/** All translatable, user-facing template content for one locale. */
export interface TemplateLocaleContent {
  title?: string;
  description?: string;
  /** Keyed by `TemplateInputField.fieldKey` (stable across reorders). */
  userInputs?: Record<string, TemplateInputTranslation>;
}

/**
 * `templates.translations` column shape. Only non-English locales are
 * expected to appear; an `en` entry, if present, is ignored in favour of
 * the canonical English columns.
 */
export type TemplateTranslations = Partial<Record<UserLocale, TemplateLocaleContent>>;

// ─── Categories ─────────────────────────────────────────────────────

export interface CategoryLocaleContent {
  name?: string;
}

/** `categories.translations` column shape. */
export type CategoryTranslations = Partial<Record<UserLocale, CategoryLocaleContent>>;

// ─── Home banners ───────────────────────────────────────────────────

export interface HomeBannerLocaleContent {
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
}

/** `home_banners.translations` column shape. */
export type HomeBannerTranslations = Partial<Record<UserLocale, HomeBannerLocaleContent>>;
