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
 * Camera Angle: re-shoot the attached photo from a new camera position.
 * `h`/`v` come straight from the orbit widget. The user's only inputs
 * are the image and the two angles — the whole prompt is ours.
 */
export function composeCameraAnglePrompt(h: number, v: number): string {
  const horiz =
    h === 0
      ? 'keep the same horizontal position'
      : `rotate the camera ${Math.abs(Math.round(h))} degrees ${h > 0 ? 'to the right' : 'to the left'} around the subject`;
  const vert =
    v === 0
      ? 'stay at the same height'
      : `move it ${Math.abs(Math.round(v))} degrees ${v > 0 ? 'above' : 'below'} the original eye line`;
  return [
    'You are a professional photographer re-shooting a scene.',
    'Analyze the attached photo in depth — the subject, materials, colors, lighting, environment and composition.',
    `Re-render the exact same scene from a new camera position: ${horiz}, and ${vert}, keeping the lens focused on the same subject at the same distance.`,
    'Preserve everything about the original: the subject’s identity and every detail, the color palette, the lighting mood and the setting.',
    'The result must look like a real photograph taken from the new angle, matching the original’s quality and aspect ratio.',
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
