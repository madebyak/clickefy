/**
 * One-Click AI Ad — the hidden director brief.
 *
 * The user uploads product images, picks Reels or HD, optionally adds a
 * note, and presses one button. Behind it, a vision model reads the
 * images with this brief and answers with a single Seedance 2.5 prompt,
 * which the API submits straight away as an ordinary video job. The user
 * never sees the prompt; they wait for the clip.
 *
 * The brief is the founder's (2026-10-08), adapted in three places: it
 * accepts one or more images of the same product, the timeline is
 * 15 seconds (the length the job is charged for), and the user's note,
 * when present, is appended as an "Important Note".
 */

export const AD_DURATION_SECONDS = 15;
/** Reels is vertical, HD is horizontal. */
export const AD_ORIENTATIONS = ['reels', 'hd'] as const;
export type AdOrientation = (typeof AD_ORIENTATIONS)[number];
export const AD_ASPECT_RATIO: Record<AdOrientation, string> = { reels: '9:16', hd: '16:9' };
export const AD_MAX_IMAGES = 5;
export const AD_MAX_NOTE_CHARS = 1000;
/** Ceiling on the brief plus note, as agreed. */
export const AD_MAX_BRIEF_CHARS = 6000;
/** What the writing step costs the user, on top of the video. */
export const AD_SCRIPT_CREDITS = 1;
/** Our estimated cost of the writing step (Gemini Pro, ~2k in / ~500 out tokens). */
export const AD_SCRIPT_COST_USD = 0.015;

const BRIEF = `ROLE
You are a senior commercial director and Seedance 2.5 prompt engineer. I will give you {IMAGES}. Your only output is a single, production-ready Seedance 2.5 prompt for a {SECONDS}-second cinematic product commercial.

STEP 1 — ANALYZE SILENTLY (never print this)
From the image{S}, determine:
- Product category, what it is, and what it is used for
- Physical facts: shape, materials, finish (matte, gloss, glass, metal), exact colors, cap/lid, label layout, any visible contents or ingredients
- The single strongest benefit or feeling it sells (refreshment, power, luxury, comfort, speed, purity...)
- Target audience and brand tier (mass, premium, luxury)
- The natural world of the product: where and how it is really used
If something is unclear, make the most plausible assumption and continue. Never ask me questions.

STEP 2 — BUILD ONE CONCEPT (never print this)
Choose ONE visual idea that could only belong to this product, built from its own benefit, ingredients, or material. Reject generic ideas (product spinning on a pedestal, random splashes with no meaning). The idea must have an arc:
hook → reveal → payoff → hero end frame.

STEP 3 — WRITE THE SEEDANCE PROMPT in exactly this structure

REFERENCE: State that the attached image{S} {IS_ARE} the product reference and that the product must stay identical in every shot: same shape, proportions, colors, materials, and label layout. Label text and logo must not be redrawn, changed, or invented.

CONCEPT: One sentence describing the idea and mood.

LOOK: Shot on ARRI Alexa 35 with Cooke S7/i full-frame primes. Describe the result, not only the gear: shallow depth of field, smooth focus falloff, gentle highlight roll-off, rich natural color, fine film grain, soft warm contrast. Add one lighting scheme and one color palette, both derived from the product's own colors, and keep them consistent across all shots.

TIMELINE: four shots, hard cuts, each a different shot size AND a different angle.
0-4s  HOOK: an intriguing image that does not fully show the product yet.
4-8s  REVEAL: the product enters or is revealed, clearly readable.
8-12s PAYOFF: the benefit in action (use, pour, texture, ingredient, or human reaction).
12-15s HERO: clean final packshot, product centered and sharp, label facing camera, the motion settles and holds still for the last second.
For each shot write: shot size, camera angle, ONE named camera move (slow push-in, low tracking, orbit, crane up, macro slide, whip pan...), what physically happens, and the light.

SPEED: Place speed ramps precisely. Name the exact shot and moment that drops into slow motion (the peak of an action: impact, splash, pour, lift) and where it snaps back to real time or accelerates into the next cut. Use at most two ramps.

AUDIO: Sound design matched to the action (specific SFX per shot) plus one music direction that builds and resolves on the hero frame. No voiceover, no dialogue.

AVOID: on-screen text, subtitles, watermarks, extra logos, other brands, warped or changed label, extra or duplicated products, distorted hands, flicker, morphing between shots.

RULES
- Write in English, present tense, concrete physical detail. No vague words like "stunning", "amazing", or "cinematic" on their own.
- One camera move per shot. Nothing physically impossible unless the concept needs it.
- People appear only if they serve the concept; if they do, describe them briefly and keep them consistent.
- Do not write aspect ratio, resolution, or duration settings inside the prompt.
- Length: 180 to 280 words.
- Output ONLY the final Seedance prompt in one code block. No analysis, no explanation, no title, no alternatives.`;

/** The brief for a run: how many images, and the user's note if any. */
export function buildAdBrief(input: { imageCount: number; notes?: string | null }): string {
  const n = Math.max(1, input.imageCount);
  const brief = BRIEF
    .replace('{IMAGES}', n === 1 ? 'one product image' : `${n} images of the same product (different angles or details)`)
    .replace('{SECONDS}', String(AD_DURATION_SECONDS))
    .replaceAll('{S}', n === 1 ? '' : 's')
    .replace('{IS_ARE}', n === 1 ? 'is' : 'are');
  const note = (input.notes ?? '').trim().slice(0, AD_MAX_NOTE_CHARS);
  const full = note ? `${brief}\n\nImportant Note: "${note}"` : brief;
  return full.slice(0, AD_MAX_BRIEF_CHARS);
}

/**
 * The prompt out of the model's reply: the first fenced block when there
 * is one, else the whole text. Null when what came back cannot be a
 * Seedance prompt (too short, or missing the structure the brief
 * demands), so the caller can retry once and then fail without charging.
 */
export function extractAdPrompt(reply: string): string | null {
  const fenced = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(reply);
  const text = (fenced ? fenced[1]! : reply).trim();
  if (text.length < 300 || text.length > 4000) return null;
  const words = text.split(/\s+/).length;
  if (words < 120 || words > 420) return null;
  for (const section of ['REFERENCE', 'CONCEPT', 'TIMELINE', 'AUDIO']) {
    if (!text.includes(section)) return null;
  }
  return text;
}
