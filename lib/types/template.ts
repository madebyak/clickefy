/**
 * Template — the central data model. Admins create templates in this dashboard;
 * mobile users browse published templates and submit generation jobs.
 *
 * @integration MongoDB
 *   - Replace `id` with MongoDB `_id: ObjectId`.
 *   - `categoryId` becomes `ObjectId` ref to the categories collection.
 *   - Store `coverImage` / `previewGallery` as S3/GCS URLs.
 *   - Store `generation.stages[].references[].base64` externally (not in the document).
 *   - Index on `status` + `sortOrder` for the published listing, `slug` (unique).
 *
 * @integration React Native
 *   - GET /api/templates (published only) → populate the mobile browse screen.
 *   - `userInputs` defines the dynamic form the mobile app renders.
 *   - `userCanChooseAspectRatio` toggles an aspect-ratio picker in the mobile UI.
 *   - `generation` config is server-side only — never sent to the mobile client.
 */

export type TemplateType = 'image' | 'video' | 'image-then-video';
export type TemplateStatus = 'draft' | 'published' | 'archived';
export type GenerationMode = 'image' | 'video' | 'image-then-video';
export type ProviderType = 'gemini' | 'kling';
export type ActionType = 'text-to-image' | 'image-to-image' | 'image-to-video';
export type InputFieldType = 'image' | 'video' | 'text';

export interface Template {
  id: string;
  title: string;
  slug: string;
  description: {
    short: string;
    long: string;
  };
  categoryId: string;
  type: TemplateType;
  status: TemplateStatus;
  featured: boolean;

  coverImage: string;
  previewGallery: string[];
  userInputs: TemplateInput[];

  generation: {
    mode: GenerationMode;
    stages: GenerationStage[];
  };

  output: {
    type: 'image' | 'video' | 'both';
    count: number;
    format: string;
    allowRegeneration: boolean;
  };

  userCanChooseAspectRatio: boolean;

  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  lastTested?: Date;
}

export interface TemplateInput {
  id: string;
  fieldKey: string;
  label: string;
  helperText?: string;
  required: boolean;
  type: InputFieldType;

  acceptedFormats?: string[];
  maxSize?: number; // megabytes
  minResolution?: { width: number; height: number };

  placeholder?: string;
  maxLength?: number;

  order: number;
}

export interface GenerationStage {
  id: string;
  order: number;
  provider: ProviderType;
  model: string;
  actionType: ActionType;

  /** Prompt with {{variable}} placeholders — resolved at generation time using `inputMapping` keys. */
  prompt: string;

  /** Maps user-input fieldKeys (or `stage_N_output`) to generation input roles. */
  inputMapping: Record<string, string>;

  references: ReferenceImage[];
  config: ProviderConfig;

  retry: {
    enabled: boolean;
    maxAttempts: number;
    fallbackModel?: string;
  };
}

export type ReferenceImageRole = 'style' | 'composition' | 'lighting' | 'scene' | 'example';

export interface ReferenceImage {
  id: string;
  label: string;
  role: ReferenceImageRole;
  base64: string;
  mimeType: string;
  fileName?: string;
}

export interface ProviderConfig {
  aspectRatio?: string;
  imageSize?: '512' | '1K' | '2K' | '4K';
  numberOfOutputs?: number;
  duration?: number;
  motionPrompt?: string;
  [key: string]: unknown;
}

export interface TemplateFormData {
  title: string;
  description: {
    short: string;
    long: string;
  };
  categoryId: string;
  type: TemplateType;
  featured: boolean;
}
