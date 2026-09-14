/**
 * Template search for the public catalog.
 *
 * The old filter was one `ILIKE '%query%'` on the English title, so the
 * search box only worked for an exact run of English title text: "retro
 * set" found nothing next to "Retro Menswear Lounge Set", and every Arabic
 * query found nothing at all because Arabic titles live in `translations`.
 *
 * Now a query is split into words (`searchTokens`, shared with the web) and
 * a template matches when EVERY word appears somewhere in what it can be
 * found by — in either language:
 *
 *   English title · English description · Arabic title · Arabic description
 *   · the names (English + Arabic) of every category it belongs to
 *
 * Both sides are normalised with the same `translate(lower(…))` fold the
 * browser uses, so أ/إ/ا, ة/ه and diacritics don't decide whether a
 * template is found.
 *
 * Read-only SQL, no schema change: the catalog is a few hundred rows, so a
 * per-row scan is sub-millisecond work. If it ever grows to tens of
 * thousands, the upgrade path is a stored normalised column with a
 * `pg_trgm` GIN index — the matching semantics here stay the same.
 */

import { sql, type SQL } from 'drizzle-orm';

import { categories, templateCategories, templates } from '@clickfy/db';
import {
  SEARCH_FOLD_FROM,
  SEARCH_FOLD_TO,
  SEARCH_WORD_BREAKS,
  searchNeedles,
} from '@clickfy/types';

/** SQL twin of `normalizeSearchText` (minus whitespace collapsing, which substring matching doesn't need). */
const fold = (expr: SQL): SQL => sql`translate(lower(${expr}), ${SEARCH_FOLD_FROM}, ${SEARCH_FOLD_TO})`;

/**
 * SQL twin of `searchHaystack`: folded, punctuation turned into spaces,
 * with a leading space so a Latin needle (" retro") can match the first word.
 */
const toHaystack = (expr: SQL): SQL =>
  sql`(' ' || translate(${fold(expr)}, ${SEARCH_WORD_BREAKS}, ${' '.repeat(SEARCH_WORD_BREAKS.length)}))`;

/** Everything a template can be found by, in both languages, normalised. */
const haystack = toHaystack(sql`concat_ws(' ',
  ${templates.title},
  ${templates.description},
  ${templates.translations}->'ar'->>'title',
  ${templates.translations}->'ar'->>'description',
  (SELECT string_agg(concat_ws(' ', c.name, c.translations->'ar'->>'name'), ' ')
     FROM ${templateCategories} tc
     JOIN ${categories} c ON c.id = tc.category_id
    WHERE tc.template_id = ${templates.id})
)`);

const titleEn = fold(sql`${templates.title}`);
const titleAr = fold(sql`coalesce(${templates.translations}->'ar'->>'title', '')`);
const titlesHaystack = toHaystack(
  sql`concat_ws(' ', ${templates.title}, ${templates.translations}->'ar'->>'title')`,
);

/**
 * WHERE fragment: every token is found in the template's haystack — Latin
 * words at a word start, Arabic words anywhere (`searchNeedles`). The
 * haystack is built once per row and tested against all needles via
 * `unnest`, rather than rebuilding it (and its category subquery) per word.
 *
 * `tokens` must be non-empty — callers skip the filter otherwise.
 */
export function catalogSearchFilter(tokens: readonly string[]): SQL {
  const list = sql.join(searchNeedles(tokens).map((n) => sql`${n}`), sql`, `);
  return sql`(SELECT bool_and(strpos(h.text, tok) > 0)
    FROM (SELECT ${haystack} AS text) h,
         unnest(ARRAY[${list}]::text[]) AS tok)`;
}

/**
 * ORDER BY key for the default sort while searching — lower is better:
 *
 *   0  a title (either language) IS the query
 *   1  a title starts with the query
 *   2  every word is in a title
 *   3  matched only through description or category
 *
 * `query` is the tokens joined by single spaces, i.e. the normalised query.
 */
export function catalogSearchRank(query: string, tokens: readonly string[]): SQL<number> {
  const allInTitle = sql.join(
    searchNeedles(tokens).map((n) => sql`strpos(${titlesHaystack}, ${n}) > 0`),
    sql` AND `,
  );
  return sql<number>`CASE
    WHEN ${titleEn} = ${query} OR ${titleAr} = ${query} THEN 0
    WHEN starts_with(${titleEn}, ${query}) OR starts_with(${titleAr}, ${query}) THEN 1
    WHEN ${allInTitle} THEN 2
    ELSE 3
  END`;
}
