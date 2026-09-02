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

/**
 * The model each tool runs on, and the billed quality tier — a product
 * decision per tool, invisible to the user and swappable without any
 * client change (the web modals mirror these for price display only).
 *
 * Camera Angle runs on GPT Image at `high` with the tuned "camera
 * orbit and tilt" prompt below. Storyboard runs on Nano Banana Pro, at 4K: a sheet
 * is only useful if every panel survives being viewed alone, and GPT
 * Image tops out around 1536px (~500px panels on a 3×3). NB Pro's 4K
 * output keeps panels above 1000px on every grid we offer, and its
 * layout control is the best we carry.
 */
export const TOOL_MODELS: Record<
  CreateToolRequest['kind'],
  { modelKey: string; quality: string }
> = {
  camera_angle: { modelKey: 'gpt-image-2', quality: 'high' },
  storyboard: { modelKey: 'gemini-3-pro-image', quality: '4K' },
};

const STYLE_DESCRIPTIONS: Record<StoryboardStyle, string> = {
  hand_drawn:
    'traditional hand-drawn storyboard pencil art on warm paper — confident graphite strokes, soft shading',
  sketch: 'loose monochrome line sketch — quick, clean production-sketch linework, white background',
  realistic: 'photorealistic cinematic still — natural light, film-like color grading',
  comic: 'bold comic-book art — flat vivid colors, strong black outlines, dynamic framing',
  '3d': 'polished 3D animated-film look — soft global lighting, appealing stylized characters',
};

/**
 * The rotation clause for the tuned prompt: "{30} degrees up and {45}
 * degrees right". An axis at 0 is omitted rather than phrased as a
 * 0-degree rotation (the widget requires at least one axis to move).
 */
function describeCameraMove(h: number, v: number): string {
  const ah = Math.abs(Math.round(h));
  const av = Math.abs(Math.round(v));
  const parts: string[] = [];
  if (av !== 0) parts.push(`${av} degrees ${v > 0 ? 'up' : 'down'}`);
  if (ah !== 0) parts.push(`${ah} degrees ${h > 0 ? 'right' : 'left'}`);
  return parts.join(' and ');
}

/**
 * Camera Angle: re-shoot the attached photo from a new camera position.
 * `h`/`v` come straight from the orbit widget. The user's only inputs
 * are the image and the two angles — the whole prompt is ours.
 *
 * Wording tuned by hand against real runs (2026-09-02): the "frozen
 * set" framing with a camera orbit-and-tilt, plain degree values (named
 * shot types overshoot), and an explicit do-not-change list.
 */
export function composeCameraAnglePrompt(h: number, v: number): string {
  return [
    `Re-frame this exact image by rotating the virtual camera ${describeCameraMove(h, v)}, as if the entire scene is frozen in time like a physical set that cannot be altered in any way.`,
    "The only thing changing is the camera's position and orientation around that frozen scene.",
    "Do not change the subject's position, pose, facial expression, body orientation, clothing, hair, skin tone, or any physical detail.",
    'Do not alter the background, environment, lighting direction, shadow patterns, color grading, depth of field, or overall mood.',
    'Do not reinterpret or reimagine any element of the scene. Treat this purely as a camera orbit and tilt on a static set.',
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
