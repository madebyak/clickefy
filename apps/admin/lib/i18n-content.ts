/**
 * Helpers for editing the per-row `translations` JSONB on templates,
 * categories, and home banners from the admin forms.
 *
 * Two rules live here so every form obeys them identically:
 *
 *   1. STRIP EMPTY — a blank/whitespace Arabic value is removed (not
 *      stored as `""`). The API read-side falls back to the English
 *      column only when the override is ABSENT; a stored empty string
 *      would otherwise override English with blank. So "cleared" ===
 *      "fall back to English".
 *
 *   2. PRUNE ORPHANS — template input translations are keyed by
 *      `fieldKey`. When an input is renamed or removed, its stale Arabic
 *      entry is dropped so it can never resurface on a different field.
 *
 * All functions are PURE — they return a new object (or `null` when the
 * result is empty) and never mutate their input. `null` is the canonical
 * "no translations" value the DB column stores.
 */

import type {
  CategoryTranslations,
  HomeBannerLocaleContent,
  HomeBannerTranslations,
  TemplateInputTranslation,
  TemplateLocaleContent,
  TemplateTranslations,
  UserLocale,
} from '@clickfy/types';

/** Trim; return `undefined` for empty so the field falls back to English. */
function clean(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ─── Templates ──────────────────────────────────────────────────────

/** Drop empty members from one input's translation; `undefined` if blank. */
function cleanInputTranslation(
  patch: TemplateInputTranslation,
): TemplateInputTranslation | undefined {
  const out: TemplateInputTranslation = {};
  const label = clean(patch.label);
  if (label) out.label = label;
  const helperText = clean(patch.helperText);
  if (helperText) out.helperText = helperText;
  const placeholder = clean(patch.placeholder);
  if (placeholder) out.placeholder = placeholder;
  if (patch.options) {
    const options: Record<string, string> = {};
    for (const [value, label] of Object.entries(patch.options)) {
      const cleaned = clean(label);
      if (cleaned) options[value] = cleaned;
    }
    if (Object.keys(options).length > 0) out.options = options;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Drop empty members of one locale's content; `undefined` if all blank. */
function cleanLocaleContent(
  content: TemplateLocaleContent,
): TemplateLocaleContent | undefined {
  const out: TemplateLocaleContent = {};
  const title = clean(content.title);
  if (title) out.title = title;
  const description = clean(content.description);
  if (description) out.description = description;
  if (content.userInputs && Object.keys(content.userInputs).length > 0) {
    out.userInputs = content.userInputs;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Re-clean every locale and collapse to `null` when nothing remains. */
function finalizeTemplateTranslations(
  draft: TemplateTranslations,
): TemplateTranslations | null {
  const out: TemplateTranslations = {};
  for (const locale of Object.keys(draft) as UserLocale[]) {
    const content = draft[locale];
    const cleaned = content ? cleanLocaleContent(content) : undefined;
    if (cleaned) out[locale] = cleaned;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Set a top-level localized template field (`title` / `description`). */
export function setTemplateField(
  translations: TemplateTranslations | null | undefined,
  locale: UserLocale,
  field: 'title' | 'description',
  value: string,
): TemplateTranslations | null {
  const draft: TemplateTranslations = { ...(translations ?? {}) };
  const content: TemplateLocaleContent = { ...(draft[locale] ?? {}) };
  const cleaned = clean(value);
  if (cleaned) content[field] = cleaned;
  else delete content[field];
  draft[locale] = content;
  return finalizeTemplateTranslations(draft);
}

/** Replace one input field's translation (keyed by `fieldKey`). */
export function setTemplateInputTranslation(
  translations: TemplateTranslations | null | undefined,
  locale: UserLocale,
  fieldKey: string,
  patch: TemplateInputTranslation,
): TemplateTranslations | null {
  const draft: TemplateTranslations = { ...(translations ?? {}) };
  const content: TemplateLocaleContent = { ...(draft[locale] ?? {}) };
  const inputs: Record<string, TemplateInputTranslation> = {
    ...(content.userInputs ?? {}),
  };
  const cleaned = cleanInputTranslation(patch);
  if (cleaned) inputs[fieldKey] = cleaned;
  else delete inputs[fieldKey];
  content.userInputs = inputs;
  draft[locale] = content;
  return finalizeTemplateTranslations(draft);
}

/**
 * Drop any input-translation whose `fieldKey` no longer exists on the
 * template — call after deleting/renaming an input so stale Arabic never
 * lingers (or attaches to a reused key).
 */
export function pruneTemplateInputTranslations(
  translations: TemplateTranslations | null | undefined,
  validFieldKeys: string[],
): TemplateTranslations | null {
  if (!translations) return null;
  const valid = new Set(validFieldKeys);
  const draft: TemplateTranslations = {};
  for (const locale of Object.keys(translations) as UserLocale[]) {
    const content = translations[locale];
    if (!content) continue;
    if (content.userInputs) {
      const kept: Record<string, TemplateInputTranslation> = {};
      for (const [key, value] of Object.entries(content.userInputs)) {
        if (valid.has(key)) kept[key] = value;
      }
      draft[locale] = { ...content, userInputs: kept };
    } else {
      draft[locale] = content;
    }
  }
  return finalizeTemplateTranslations(draft);
}

/** Read one input field's translation for a locale (for seeding the form). */
export function getTemplateInputTranslation(
  translations: TemplateTranslations | null | undefined,
  locale: UserLocale,
  fieldKey: string,
): TemplateInputTranslation {
  return translations?.[locale]?.userInputs?.[fieldKey] ?? {};
}

// ─── Categories ─────────────────────────────────────────────────────

/** Set the localized category `name`; clears the locale when blank. */
export function setCategoryName(
  translations: CategoryTranslations | null | undefined,
  locale: UserLocale,
  value: string,
): CategoryTranslations | null {
  const draft: CategoryTranslations = { ...(translations ?? {}) };
  const cleaned = clean(value);
  if (cleaned) draft[locale] = { name: cleaned };
  else delete draft[locale];
  return Object.keys(draft).length > 0 ? draft : null;
}

// ─── Home banners ───────────────────────────────────────────────────

/** Build a banner's translations from the Arabic overlay fields. */
export function buildBannerTranslations(
  locale: UserLocale,
  fields: { title?: string; subtitle?: string; ctaLabel?: string },
): HomeBannerTranslations | null {
  const content: HomeBannerLocaleContent = {};
  const title = clean(fields.title);
  if (title) content.title = title;
  const subtitle = clean(fields.subtitle);
  if (subtitle) content.subtitle = subtitle;
  const ctaLabel = clean(fields.ctaLabel);
  if (ctaLabel) content.ctaLabel = ctaLabel;
  return Object.keys(content).length > 0 ? { [locale]: content } : null;
}
