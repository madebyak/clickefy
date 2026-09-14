/**
 * Reference tokens — how a prompt points at its attachments.
 *
 * The composer writes `@Image1`, `@Video2`, `@Audio1`: the attachment's
 * kind plus its 1-based position AMONG ATTACHMENTS OF THAT KIND, in the
 * order the tray shows them (which is the order they are sent in). That
 * per-kind numbering is exactly how Seedance numbers its content array,
 * and for every image-only model it is simply the image's position.
 *
 * The tokens are plain text on purpose — they survive copy/paste, IME and
 * right-to-left editing without a custom editor — and they are
 * provider-neutral: the worker translates them into each model's own
 * addressing when it builds the stage (`translateReferenceTokens`).
 *
 * Shared by the web composer (insert, highlight, renumber, validate), the
 * API (reject a prompt naming an attachment that isn't there) and the
 * providers package (translate).
 */

export type ReferenceKind = 'image' | 'video' | 'audio';

const KIND_NAME: Record<ReferenceKind, string> = { image: 'Image', video: 'Video', audio: 'Audio' };

/**
 * `@Image1`, case-insensitive, also `@image_1` (the Kling spelling our
 * blog taught). Not followed by another letter or digit, so `@image1x`
 * and email-like text are not tokens.
 */
const TOKEN_RE = /@(image|video|audio)_?(\d{1,2})(?![\p{L}\p{N}_])/giu;

export interface ReferenceTokenMatch {
  kind: ReferenceKind;
  /** 1-based, per kind. */
  n: number;
  start: number;
  end: number;
  /** As typed. */
  text: string;
}

/** The canonical token the composer inserts. */
export function referenceToken(kind: ReferenceKind, n: number): string {
  return `@${KIND_NAME[kind]}${n}`;
}

export function findReferenceTokens(text: string): ReferenceTokenMatch[] {
  const out: ReferenceTokenMatch[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const n = Number(m[2]);
    if (!Number.isInteger(n) || n < 1) continue;
    const start = m.index ?? 0;
    out.push({
      kind: m[1]!.toLowerCase() as ReferenceKind,
      n,
      start,
      end: start + m[0].length,
      text: m[0],
    });
  }
  return out;
}

/** Per-kind 1-based number of each attachment, in the given order. */
export function referenceNumbers(kinds: readonly ReferenceKind[]): number[] {
  const seen: Record<ReferenceKind, number> = { image: 0, video: 0, audio: 0 };
  return kinds.map((k) => (seen[k] += 1));
}

export function referenceCounts(kinds: readonly ReferenceKind[]): Record<ReferenceKind, number> {
  const counts: Record<ReferenceKind, number> = { image: 0, video: 0, audio: 0 };
  for (const k of kinds) counts[k] += 1;
  return counts;
}

/**
 * Rewrite every token through `fn`: a string replaces it, `null` deletes
 * it (together with one adjoining space, so no double space is left), and
 * `undefined` leaves it exactly as typed.
 */
export function mapReferenceTokens(
  text: string,
  fn: (token: ReferenceTokenMatch) => string | null | undefined,
): string {
  let out = '';
  let last = 0;
  for (const t of findReferenceTokens(text)) {
    const next = fn(t);
    if (next === undefined) continue;
    if (next !== null) {
      out += text.slice(last, t.start) + next;
      last = t.end;
      continue;
    }
    let start = t.start;
    let end = t.end;
    if (text[end] === ' ') end += 1;
    else if (start > last && text[start - 1] === ' ') start -= 1;
    out += text.slice(last, start);
    last = end;
  }
  return out + text.slice(last);
}

/** Tokens naming an attachment that isn't there (e.g. `@Image3` with two images). */
export function danglingReferenceTokens(
  text: string,
  counts: Record<ReferenceKind, number>,
): ReferenceTokenMatch[] {
  return findReferenceTokens(text).filter((t) => t.n > counts[t.kind]);
}

/**
 * How a model wants its references named in the prompt:
 *
 *   - `seedance` — `@Image1` / `@Video1` / `@Audio1`, per-kind (BytePlus).
 *   - `kling`    — `@image_1`, matching the `id` each reference part is
 *                  sent with (Kling API 2.0 Omni / O1).
 *   - `prose`    — "image 1": Gemini, GPT Image and Seedream address
 *                  inputs by position in plain language.
 */
export type ReferenceSyntax = 'seedance' | 'kling' | 'prose';

/**
 * Translate canonical tokens for one model. Tokens beyond `counts` are
 * left as typed — the API refuses such prompts before they get here.
 */
export function translateReferenceTokens(
  text: string,
  syntax: ReferenceSyntax,
  counts: Record<ReferenceKind, number>,
): string {
  return mapReferenceTokens(text, (t) => {
    if (t.n > counts[t.kind]) return undefined;
    if (syntax === 'seedance') return referenceToken(t.kind, t.n);
    if (syntax === 'kling') return `@${t.kind}_${t.n}`;
    return `${t.kind} ${t.n}`;
  });
}
