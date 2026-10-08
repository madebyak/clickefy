/**
 * One-Click AI Ad — the hidden director brief.
 *
 * The user uploads product images, picks Reels or HD, optionally adds a
 * note, and presses one button. Behind it, a vision model reads the
 * images with this brief and answers with a single Seedance 2.5 prompt,
 * which the API submits straight away as an ordinary video job. The user
 * never sees the prompt; they wait for the clip.
 *
 * The brief is the founder's (2026-10-08, from his Arabic original): one
 * or more images of the same product, five three-second shots over the
 * 15 seconds the job is charged for, Alexa 35 + Cooke S7/i, dynamic
 * speed ramps, one prompt back and nothing else. The user's note, when
 * present, is appended as an "Important Note". The placeholders below
 * are optional: an admin's text may use them, the default does not.
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

/** The placeholders the brief may use; the admin editor documents them. */
export const AD_BRIEF_PLACEHOLDERS = [
  { token: '{IMAGES}', meaning: '"one product image" or "N images of the same product (different angles or details)"' },
  { token: '{SECONDS}', meaning: 'the ad length in seconds (15)' },
  { token: '{S}', meaning: '"s" when there are several images, else nothing ("image{S}" → "images")' },
  { token: '{IS_ARE}', meaning: '"is" for one image, "are" for several' },
] as const;

/** The code default; the admin may override it in `prompt_templates` (key `ad_brief`). */
export const AD_BRIEF_DEFAULT = `ROLE
You are a senior commercial director and a Seedance 2.5 prompt engineer. I will give you one or more images of the same product. Your only output is one production-ready Seedance 2.5 prompt for a 15-second cinematic product commercial.

STEP 1 — LOOK AT THE PRODUCT (never print this)
Study the image(s) and work out: what the product is, what it is made of and what it contains, its exact shape, colors, finish, label and packaging, who it is for, and the single strongest benefit or feeling it sells. If something is unclear, make the most plausible assumption and continue. Never ask questions.

STEP 2 — FIND THE BEST IDEA (never print this)
Create one creative advertising idea that fits this product better than any other: built on its benefit, its ingredients or its material. Reject generic ideas (a product spinning on a pedestal, random splashes with no meaning). The idea must have a clear beginning, a build-up and an ending.

STEP 3 — WRITE THE SEEDANCE PROMPT, in this structure

REFERENCE: Say that the attached image(s) show the product and that it must stay identical in every shot: same shape, proportions, colors, materials and label. Label text and logo must never be redrawn, changed or invented.

CONCEPT: One sentence with the idea and the mood.

LOOK: Shot on ARRI Alexa 35 with Cooke S7/i full-frame primes. Describe the result: shallow depth of field, smooth focus falloff, gentle highlight roll-off, rich natural color, fine film grain. One lighting scheme and one color palette, both taken from the product's own colors, kept consistent across all shots.

TIMELINE: five shots of three seconds each (0-3, 3-6, 6-9, 9-12, 12-15), hard cuts, every shot a different shot size and a different camera angle. The first shot is an opening that intrigues without fully showing the product; the last shot is a clean hero packshot, product centered and sharp, label facing camera, holding still for the final second. For each shot write: shot size, camera angle, one named camera move, what physically happens, and the light.

SPEED: Dynamic speed ramps. Name the exact shot and moment that drops into slow motion (the peak of an action: impact, splash, pour, lift) and where it snaps back to real time or accelerates into the next cut. Use at most two ramps.

AUDIO: Sound design matched to each shot, plus one music direction that builds and resolves on the hero frame. No voiceover, no dialogue.

AVOID: on-screen text, subtitles, captions, watermarks, extra logos, other brands, a warped or changed label, extra or duplicated products, distorted hands, flicker, morphing between shots.

RULES
- Write in English, present tense, concrete physical detail. No vague words such as "stunning", "amazing" or "cinematic" on their own.
- One camera move per shot. Nothing physically impossible unless the idea needs it.
- People appear only if the idea needs them; if they do, describe them briefly and keep them consistent.
- Do not write aspect ratio, resolution or duration settings inside the prompt.
- Length: 180 to 280 words.
- Output ONLY the final Seedance prompt, in one code block. No analysis, no explanation, no title, no alternatives.`;

/** The brief for a run: how many images, the user's note if any, and the admin's text when one is saved. */
export function buildAdBrief(input: { imageCount: number; notes?: string | null; template?: string | null }): string {
  const n = Math.max(1, input.imageCount);
  const source = input.template && input.template.trim().length > 0 ? input.template : AD_BRIEF_DEFAULT;
  const brief = source
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
