/**
 * Search text normalisation — one definition for every search box.
 *
 * Lives in `@clickfy/types` for the reason `storage-quota.ts` does: the
 * API matches in SQL and the web matches in the browser, and the two must
 * agree on what "the same text" means. If the catalog folded ة to ه but
 * the library didn't, the same word would find a template and miss a file.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────
 *   1. Lowercase.
 *   2. Fold Arabic spelling variants people type interchangeably:
 *        أ إ آ ٱ → ا     ة → ه     ى → ي     ؤ → و     ئ → ي
 *   3. Drop Arabic diacritics (tashkeel) and the tatweel stretch ـ.
 *
 * The fold is expressed as two strings so SQL can apply it verbatim with
 * `translate(lower(text), SEARCH_FOLD_FROM, SEARCH_FOLD_TO)`: Postgres maps
 * each character of `from` to the one at the same position in `to`, and
 * deletes characters past the end of `to` — which is exactly how the
 * diacritics are removed. Built from code points so no editor or
 * formatter can silently normalise the invisible marks away.
 *
 * Deliberately NOT done: Latin accent stripping (needs Postgres `unaccent`,
 * a schema change) and typo tolerance (needs `pg_trgm`). Both are a later,
 * opt-in step.
 */

const cp = (...codes: number[]) => String.fromCharCode(...codes);

/** أ إ آ ٱ ة ى ؤ ئ — letters folded to one spelling. */
const FOLD_LETTERS_FROM = cp(0x0623, 0x0625, 0x0622, 0x0671, 0x0629, 0x0649, 0x0624, 0x0626);
/** ا ا ا ا ه ي و ي — their folded forms, position for position. */
const FOLD_LETTERS_TO = cp(0x0627, 0x0627, 0x0627, 0x0627, 0x0647, 0x064a, 0x0648, 0x064a);
/** Tanween, harakat, shadda, sukun, superscript alef, tatweel — removed. */
const ARABIC_MARKS = cp(0x064b, 0x064c, 0x064d, 0x064e, 0x064f, 0x0650, 0x0651, 0x0652, 0x0670, 0x0640);

/** `from` argument for SQL `translate()`. Characters past `SEARCH_FOLD_TO`'s length are deleted. */
export const SEARCH_FOLD_FROM = FOLD_LETTERS_FROM + ARABIC_MARKS;
/** `to` argument for SQL `translate()`. */
export const SEARCH_FOLD_TO = FOLD_LETTERS_TO;

/** A query longer than this many words is almost certainly pasted prose, not a search. */
export const MAX_SEARCH_TOKENS = 8;

/**
 * Punctuation treated as a word gap when matching, so "set," or
 * "(retro)" or "لقطة، قريبة" still split into words. SQL applies it with
 * `translate(text, SEARCH_WORD_BREAKS, <same number of spaces>)`.
 */
export const SEARCH_WORD_BREAKS =
  `-_.,;:!?/\\|()[]{}"'` + cp(0x201c, 0x201d, 0x2018, 0x2019, 0x00ab, 0x00bb, 0x060c, 0x061b, 0x061f, 0x2026, 0x2014, 0x2013, 0x00b7) + `&+#*@`;

const ARABIC_LETTER = /[؀-ۿ]/;

const FOLD = new Map<string, string>(
  Array.from(SEARCH_FOLD_FROM, (ch, i) => [ch, SEARCH_FOLD_TO[i] ?? ''] as const),
);

/** Lowercased, Arabic-folded, whitespace-collapsed. Mirrors the SQL `translate(lower(…))`. */
export function normalizeSearchText(input: string): string {
  let out = '';
  for (const ch of input.toLowerCase()) out += FOLD.get(ch) ?? ch;
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * The words of a query, normalised, de-duplicated, with punctuation
 * trimmed from their edges ("set," → "set", «ريترو» → ريترو). Empty when
 * the query holds nothing searchable — callers treat that as "no search".
 */
export function searchTokens(input: string): string[] {
  const words = new Set<string>();
  for (const raw of normalizeSearchText(input).split(' ')) {
    const word = raw.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
    if (word) words.add(word);
  }
  return [...words].slice(0, MAX_SEARCH_TOKENS);
}

/**
 * What to look for, per token, inside a `searchHaystack`.
 *
 * Latin words match at the START of a word — the needle carries a leading
 * space and the haystack starts with one — so "jewel" finds "Jewelry" and
 * "ad" finds "Ad" or "ads", but "ad" no longer finds "made" or "shadow".
 *
 * Arabic words match ANYWHERE, because Arabic glues prefixes onto the
 * word: "مجوهرات" has to find "للمجوهرات" (لل + مجوهرات) and "بطابع" still
 * contains "طابع". A word-start rule would miss exactly those.
 */
export function searchNeedles(tokens: readonly string[]): string[] {
  return tokens.map((token) => (ARABIC_LETTER.test(token) ? token : ` ${token}`));
}

const BREAKS = new Set(SEARCH_WORD_BREAKS);

/** Normalised text with punctuation turned into spaces and a leading space — the side needles are found in. */
export function searchHaystack(text: string): string {
  let out = ' ';
  for (const ch of normalizeSearchText(text)) out += BREAKS.has(ch) ? ' ' : ch;
  return out;
}

/**
 * True when EVERY token is found in `haystack`, in any order (see
 * `searchNeedles` for what "found" means). "retro set" matches "Retro
 * Menswear Lounge Set". No tokens matches everything.
 */
export function matchesSearch(haystack: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const text = searchHaystack(haystack);
  return searchNeedles(tokens).every((needle) => text.includes(needle));
}
