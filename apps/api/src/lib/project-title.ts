/**
 * Derive a project title from the prompt that created its first asset.
 *
 * A studio full of "Untitled project" is unusable, and the prompt is the
 * only thing we know about the user's intent at that moment. This is a
 * deliberately dumb, deterministic transform rather than a model call:
 * it runs inside the job-create request, so it has to be instant, free
 * and incapable of failing.
 */

/** Server-side default assigned in `POST /v1/projects`. */
export const DEFAULT_PROJECT_NAME = 'Untitled project';

const MAX_LEN = 48;

/**
 * Prompts are usually one long comma-joined description
 * ("skincare high end luxury colors, photoshoot in jungle, ray lights").
 * The first clause is nearly always the subject, so cut there and fall
 * back to a word-boundary trim when the first clause is itself long.
 */
export function titleFromPrompt(prompt: string): string | null {
  // Strip our own template tokens so a title never reads "{{input:x}}".
  const cleaned = prompt
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return null;

  // First sentence/clause boundary.
  const firstClause = cleaned.split(/[,.;\n—]/)[0]!.trim();
  let title = firstClause.length >= 3 ? firstClause : cleaned;

  if (title.length > MAX_LEN) {
    const cut = title.slice(0, MAX_LEN);
    const lastSpace = cut.lastIndexOf(' ');
    // Only break on a word boundary if it leaves something substantial;
    // a single very long word would otherwise collapse to nothing.
    title = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
  }

  // Sentence case, but only when the first word is entirely lowercase.
  // Capitalising unconditionally turns "iPhone" into "IPhone" — a word
  // that already carries capitals was spelt that way on purpose.
  const firstWord = title.split(' ')[0]!;
  if (!/[A-Z]/.test(firstWord)) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  return title.length > 0 ? title : null;
}
