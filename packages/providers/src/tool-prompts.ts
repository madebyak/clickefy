/**
 * Hidden prompts for the studio TOOLS — Camera Angle and Storyboard.
 *
 * A tool is our product feature, not a model feature: the user gives a
 * tiny, structured input (an image + two angles; a script + a style +
 * a grid) and the prompt engineering is entirely ours. The composition
 * lives HERE, in the providers package, because it runs in the WORKER
 * at stage-build time: `jobs.inputs` stores only what the user typed
 * (the script, or nothing) and `jobs.options.tool` stores the
 * structured parameters — so the asset-detail endpoint, Re-use and the
 * job record can never leak the engineered prompt.
 *
 * Both tools currently run on GPT Image 2 at the `high` tier — the
 * strongest model we carry for faithful editing and for laying out a
 * multi-panel sheet. The choice is deliberately invisible to the user
 * (no model picker in the tool modals) so it can be swapped here
 * without any UI change.
 */

/** Structured tool request, persisted verbatim in `jobs.options.tool`. */
export type CreateToolRequest =
  | {
      kind: 'camera_angle';
      /** Horizontal orbit in degrees, -180..180 (0 = original position). */
      h: number;
      /** Vertical orbit in degrees, -80..80 (positive = above eye level). */
      v: number;
    }
  | {
      kind: 'storyboard';
      style: StoryboardStyle;
      /** Panels per row / rows on the sheet (validated 2-4 x 2-3). */
      cols: number;
      rows: number;
    };

export type StoryboardStyle = 'hand_drawn' | 'sketch' | 'realistic' | 'comic' | '3d';

export const STORYBOARD_STYLES: readonly StoryboardStyle[] = [
  'hand_drawn',
  'sketch',
  'realistic',
  'comic',
  '3d',
];

/** The model every tool job runs on, and the billed quality tier. */
export const TOOL_MODEL_KEY = 'gpt-image-2';
export const TOOL_QUALITY = 'high';

const STYLE_DESCRIPTIONS: Record<StoryboardStyle, string> = {
  hand_drawn:
    'traditional hand-drawn storyboard pencil art on warm paper — confident graphite strokes, soft shading',
  sketch: 'loose monochrome line sketch — quick, clean production-sketch linework, white background',
  realistic: 'photorealistic cinematic still — natural light, film-like color grading',
  comic: 'bold comic-book art — flat vivid colors, strong black outlines, dynamic framing',
  '3d': 'polished 3D animated-film look — soft global lighting, appealing stylized characters',
};

/**
 * Translate the orbit widget's raw degrees into the cinematography
 * vocabulary image models are actually trained on. "Rotate the camera
 * 120 degrees" is a weak signal — models follow named shot types
 * ("low angle", "side profile", "bird's-eye view") far more reliably,
 * so the named angle leads and the degrees ride along as precision.
 */
function describeCameraMove(h: number, v: number): string {
  const ah = Math.abs(Math.round(h));
  const av = Math.abs(Math.round(v));
  const side = h > 0 ? 'right' : 'left';

  let horiz: string;
  if (ah <= 10) horiz = 'keeping the original front-facing position';
  else if (ah <= 55)
    horiz = `a three-quarter view, the camera orbited ${ah}° to the ${side} around the subject`;
  else if (ah <= 125)
    horiz = `a side profile view from the ${side}, the camera orbited ${ah}° around the subject`;
  else if (ah <= 170)
    horiz = `a three-quarter back view, the camera orbited ${ah}° to the ${side} around behind the subject`;
  else horiz = 'a view from directly behind the subject, the camera orbited 180° around them';

  let vert: string;
  if (av <= 8) vert = 'at eye level — a neutral, straight-on perspective';
  else if (v > 0) {
    if (av <= 25)
      vert = `at a slight high angle — the camera raised ${av}° above eye level, looking gently down at the subject`;
    else if (av <= 55)
      vert = `at a high angle — the camera well above the subject, ${av}° up, looking down on it`;
    else
      vert = `at a bird's-eye view — the camera nearly overhead, ${av}° up, looking steeply down at the subject`;
  } else {
    if (av <= 25)
      vert = `at a slight low angle — the camera dropped ${av}° below eye level, looking gently up at the subject`;
    else if (av <= 55)
      vert = `at a low angle — the camera well below the subject, ${av}° down, looking up at it (a heroic perspective)`;
    else
      vert = `at a worm's-eye view — the camera near the ground, ${av}° down, looking steeply up at the subject`;
  }
  return `${horiz}, ${vert}`;
}

/**
 * Camera Angle: re-shoot the attached photo from a new camera position.
 * `h`/`v` come straight from the orbit widget. The user's only inputs
 * are the image and the two angles — the whole prompt is ours.
 *
 * The body is the "frozen set" framing: the scene is a physical set
 * frozen in time and ONLY the camera moves. Editing models drift far
 * less with a long explicit do-not-change list than with a positive
 * "preserve everything" instruction.
 */
export function composeCameraAnglePrompt(h: number, v: number): string {
  return [
    `Re-frame this exact image with a new camera position: ${describeCameraMove(h, v)}.`,
    'Imagine the entire scene is frozen in time like a physical set that cannot be altered in any way. The only thing changing is where the camera is placed and the angle from which it observes that frozen scene.',
    "Do not change the subject's position, pose, facial expression, body orientation, clothing, hair, skin tone, or any physical detail.",
    'Do not alter the background, environment, lighting direction, shadow patterns, color grading, depth of field, or overall mood.',
    'Do not reinterpret or reimagine any element of the scene. Treat this purely as a camera move on a static set.',
    "Reconstruct any parts of the scene that fall outside the original frame as needed, staying fully consistent with the existing visual style, and output the result in the original image's aspect ratio.",
  ].join(' ');
}

/**
 * Storyboard: one clean-frames sheet from the user's script. The script
 * is the only user text; everything around it is ours.
 */
export function composeStoryboardPrompt(
  style: StoryboardStyle,
  cols: number,
  rows: number,
  script: string,
): string {
  const shots = cols * rows;
  return [
    'You are an expert film storyboard artist.',
    `Read the script below and break it into exactly ${shots} key shots that tell the story clearly from beginning to end.`,
    `Render ONE storyboard sheet: a ${cols}x${rows} grid of equal rectangular panels (${cols} per row, ${rows} rows), read left to right then top to bottom, with thin even margins between panels on a clean neutral background.`,
    `Draw every panel in a consistent style: ${STYLE_DESCRIPTIONS[style]}.`,
    'Vary the shot types cinematically (establishing, medium, close-up) and keep characters and settings consistent across panels.',
    'No captions, no text, no numbers, no labels anywhere — clean frames only.',
    '',
    'Script:',
    script,
  ].join('\n');
}

/** Compose the final prompt for a tool job from its stored parameters. */
export function composeToolPrompt(tool: CreateToolRequest, userText: string): string {
  if (tool.kind === 'camera_angle') return composeCameraAnglePrompt(tool.h, tool.v);
  return composeStoryboardPrompt(tool.style, tool.cols, tool.rows, userText);
}
