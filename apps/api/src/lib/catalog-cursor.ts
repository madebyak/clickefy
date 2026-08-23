/**
 * Keyset pagination for the public catalog list.
 *
 * WHY THIS EXISTS
 *
 * The list endpoint had four sort modes, each hand-rolling its own
 * cursor string and its own WHERE predicate next to its own ORDER BY.
 * Three of the four had drifted out of sync with the ordering they were
 * meant to page:
 *
 *   - `default` ordered by `featured DESC, sort_order ASC, id ASC` but
 *     its cursor carried only `(sort_order, id)`. With `featured` in the
 *     ordering and absent from the predicate, paging terminated after
 *     73 of 271 rows in production — 73% of the catalog was unreachable.
 *   - `default` with a search term additionally ordered by a relevance
 *     rank that the cursor knew nothing about.
 *   - `popular` was missing `featured` for the same reason, and compared
 *     `id` in the wrong DIRECTION: its row-value tuple applied `<` to
 *     every member, which is descending, against an `ORDER BY id ASC`.
 *
 * The root cause is structural, not a typo: the ordering and the
 * predicate were two separate pieces of code kept in agreement by hand.
 * So this module makes the sort key ONE declaration and derives the
 * ORDER BY, the WHERE predicate and the cursor payload from it. They
 * can no longer disagree.
 *
 * MIXED DIRECTIONS
 *
 * A row-value comparison — `(a, b) < ($1, $2)` — applies the same
 * operator to every member, so it can only express a sort where every
 * column runs the same way. Our keys mix directions (`featured DESC,
 * sort_order ASC, …`), so we emit the expanded OR/AND form instead:
 *
 *   (a < A) OR (a = A AND b > B) OR (a = A AND b = B AND c < C) …
 *
 * The previous code tried to keep the tuple form by negating the
 * ascending column (`-sort_order`). That works for numbers and is
 * impossible for the uuid tiebreaker, which is exactly where it broke.
 *
 * NULLS
 *
 * Every expression used as a key must be non-null for both `=` and the
 * comparison to behave: a NULL makes the predicate NULL and the row is
 * silently dropped from every subsequent page. All keys we use are
 * either NOT NULL columns or COALESCE-wrapped.
 */

import { asc, desc, sql, type SQL } from 'drizzle-orm';

/** A single value out of a sort key — whatever survives JSON. */
export type CursorValue = string | number | boolean;

export interface SortKey {
  /**
   * The expression, used verbatim in BOTH the ORDER BY and the keyset
   * predicate. Sharing the expression is the point — a predicate built
   * from a different expression than the one being ordered by is the
   * bug this module exists to prevent.
   */
  expr: SQL;
  dir: 'asc' | 'desc';
  /** Alias this key is selected under; also its slot in the cursor. */
  as: string;
  /**
   * How the key's value is SELECTED for the cursor.
   *
   * Deliberately not derived in JS from the returned row. Three ways
   * that goes wrong here, all of them silent:
   *
   *   - Timestamps. Drizzle parses timestamptz into a JS Date, which is
   *     millisecond-precision, while the column holds microseconds.
   *     A Date-built cursor is therefore slightly BEFORE the row it
   *     describes, and on a DESC ordering every row in that sub-
   *     millisecond window is skipped at the page boundary. The rest of
   *     this codebase already casts `::text` for exactly this reason
   *     (see routes/projects.ts).
   *   - The search rank. It is an ORDER BY expression, not a column, so
   *     recomputing it in JS means maintaining a second implementation
   *     of the SQL `CASE` — and `LIKE` treats `%` and `_` in the term as
   *     wildcards where `String.startsWith` does not.
   *   - `runs`. SQL reads it as `(stats->>'runs')::int`; reading
   *     `stats.runs` in JS skips the cast, so a float or numeric string
   *     in that JSON field would disagree.
   *
   * Selecting the value means the cursor carries exactly what the
   * database ordered by. It cannot disagree with itself.
   */
  selectExpr: SQL;
  /** Bind a decoded cursor value as a correctly-typed SQL literal. */
  bind: (value: CursorValue) => SQL;
}

/** The `select()` fragment that materialises every key's cursor value. */
export function selectionFor(keys: SortKey[]): Record<string, SQL> {
  return Object.fromEntries(keys.map((k) => [k.as, k.selectExpr]));
}

/** ORDER BY terms for a sort key list. */
export function orderByFor(keys: SortKey[]): SQL[] {
  return keys.map((k) => (k.dir === 'asc' ? asc(k.expr) : desc(k.expr)));
}

/**
 * "Strictly after the cursor row, in this ordering."
 *
 * Expanded lexicographic comparison: for each key i, all keys before it
 * are equal and key i is strictly past the cursor in its own direction.
 * O(n²/2) comparisons with n ≤ 5, and the only form that survives mixed
 * directions.
 */
export function keysetAfter(keys: SortKey[], values: CursorValue[]): SQL | null {
  if (keys.length === 0 || keys.length !== values.length) return null;

  const clauses: SQL[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const conj: SQL[] = [];
    for (let j = 0; j < i; j += 1) {
      conj.push(sql`${keys[j]!.expr} = ${keys[j]!.bind(values[j]!)}`);
    }
    const k = keys[i]!;
    const bound = k.bind(values[i]!);
    conj.push(k.dir === 'asc' ? sql`${k.expr} > ${bound}` : sql`${k.expr} < ${bound}`);
    clauses.push(sql`(${sql.join(conj, sql` AND `)})`);
  }
  return sql`(${sql.join(clauses, sql` OR `)})`;
}

/**
 * Mint the cursor for the last row of a page, reading each key's value
 * from the alias it was selected under.
 */
export function cursorForRow(
  mode: string,
  keys: SortKey[],
  row: Record<string, unknown>,
): string {
  return encodeCursor(
    mode,
    keys.map((k) => {
      const v = row[k.as];
      // Booleans arrive as booleans, ints as numbers, `::text` casts as
      // strings. Anything else means the select and the key drifted.
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
      throw new Error(`cursor key "${k.as}" was ${typeof v}, expected a primitive`);
    }),
  );
}

/* ------------------------------------------------------------ codec */

/**
 * Cursors are opaque base64url JSON rather than a `:`-joined string.
 *
 * The old formats joined values with `:` or `::`, which only worked
 * because no value happened to contain the separator — an ISO timestamp
 * is full of colons, which is precisely why `recent` had to invent a
 * second separator. An opaque token removes that class of problem,
 * carries its own version and sort mode, and lets a cursor minted under
 * one ordering be rejected outright rather than silently paging through
 * a different one.
 */
interface CursorPayload {
  /** Bumped when the encoding changes; older tokens are then rejected. */
  v: 1;
  /** Sort mode + key shape. A mismatch rejects the cursor. */
  m: string;
  /** Sort key values, in key order. */
  k: CursorValue[];
}

const CURSOR_VERSION = 1;

function toBase64Url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  // Some runtimes require the padding atob() strips from our output.
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export function encodeCursor(mode: string, values: CursorValue[]): string {
  const payload: CursorPayload = { v: CURSOR_VERSION, m: mode, k: values };
  return toBase64Url(JSON.stringify(payload));
}

/**
 * Decode a cursor for `mode`, expecting `arity` key values.
 *
 * Returns null for ANY problem — malformed base64, bad JSON, wrong
 * version, wrong mode, wrong arity, non-primitive members. Callers
 * treat null as "no cursor" and serve the first page. That is the right
 * failure mode for a client holding a token minted before a deploy: it
 * sees the top of the list again rather than an error, and a cursor
 * from a different sort can never leak into this one's predicate.
 */
export function decodeCursor(
  raw: string | undefined,
  mode: string,
  arity: number,
): CursorValue[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as Partial<CursorPayload>;
  if (p.v !== CURSOR_VERSION || p.m !== mode) return null;
  if (!Array.isArray(p.k) || p.k.length !== arity) return null;
  for (const v of p.k) {
    const t = typeof v;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') return null;
    if (t === 'number' && !Number.isFinite(v)) return null;
  }
  return p.k as CursorValue[];
}
