/**
 * Does a prompt ask to EDIT or CONTINUE an attached video?
 *
 * Seedance 2.5 reads the prompt to decide what kind of task it is, even
 * when we declare one. In References mode we declare a new-video task with
 * the user's own ratio and length, so a prompt like "replace the cat in
 * @Video1 with a dog" is classified as an edit and then fails — after the
 * job was queued — because an edit must keep the source clip's shape and
 * length. The composer uses this to suggest the mode that can actually do
 * what the words ask, BEFORE the user spends credits.
 *
 * Deliberately a hint, never a gate: the word lists follow BytePlus's own
 * trigger words (edit / add / remove / modify / replace / change; extend /
 * continue), so a false positive costs one dismissible sentence.
 *
 * English words match whole words. Arabic words match as whole tokens once
 * the conjunction prefix و / ف is stripped, on text folded the way search
 * folds it (أ/إ → ا, diacritics dropped) — so "واستبدل" and "إستبدِل" both
 * count, while an ambiguous word like "غير" ("change" but also "other" /
 * "not") is left out on purpose.
 */

import { normalizeSearchText } from './search-text';

export type VideoTaskIntent = 'edit' | 'extend';

const ENGLISH_EDIT = /\b(replace|remove|delete|erase|swap|edit|modify|change)\b/i;
/** "add" alone is everywhere in ordinary prompts; only "add … to the video" is an edit. */
const ENGLISH_ADD_TO_VIDEO = /\badd\b[^.!?]{0,40}\b(to|into|in)\s+(the|this|my)\s+(video|clip|footage)\b/i;
const ENGLISH_EXTEND = /\b(extend|continue|continuation|keep going|what happens next)\b/i;

/** Folded forms (see normalizeSearchText): استبدل بدل احذف ازل امسح عدل — replace, swap, delete, remove, erase, edit. */
const ARABIC_EDIT = new Set(['استبدل', 'بدل', 'احذف', 'ازل', 'امسح', 'عدل']);
/** مدد اكمل كمل تكمله — extend, continue, continuation. */
const ARABIC_EXTEND = new Set(['مدد', 'اكمل', 'كمل', 'تكمله', 'استكمل']);

function firstIndex(re: RegExp, text: string): number {
  const m = re.exec(text);
  return m ? m.index : -1;
}

/**
 * `'edit'`, `'extend'`, or null. When both kinds of words appear, the one
 * that comes first wins — it is what the sentence leads with.
 */
export function detectVideoTaskIntent(prompt: string): VideoTaskIntent | null {
  if (!prompt.trim()) return null;

  let edit = Math.min(
    ...[firstIndex(ENGLISH_EDIT, prompt), firstIndex(ENGLISH_ADD_TO_VIDEO, prompt)].map((i) =>
      i < 0 ? Infinity : i,
    ),
  );
  let extend = firstIndex(ENGLISH_EXTEND, prompt);
  if (extend < 0) extend = Infinity;

  // Arabic: token by token on folded text. Positions are token ordinals
  // offset past any English match so the two scales never mix badly.
  const tokens = normalizeSearchText(prompt).split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
  tokens.forEach((raw, i) => {
    const word = raw.length > 3 && (raw.startsWith('و') || raw.startsWith('ف')) ? raw.slice(1) : raw;
    const pos = prompt.length + i;
    if (ARABIC_EDIT.has(word) || ARABIC_EDIT.has(raw)) edit = Math.min(edit, pos);
    if (ARABIC_EXTEND.has(word) || ARABIC_EXTEND.has(raw)) extend = Math.min(extend, pos);
  });

  if (edit === Infinity && extend === Infinity) return null;
  return edit <= extend ? 'edit' : 'extend';
}
