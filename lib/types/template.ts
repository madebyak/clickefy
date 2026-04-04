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

  // Whether the mobile user can pick aspect ratio
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

  // Media-specific (image/video only)
  acceptedFormats?: string[];
  maxSize?: number; // MB
  minResolution?: { width: number; height: number };

  // Text-specific
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

  // Prompt with {{variable}} placeholders linked to user inputs
  prompt: string;

  // Maps user input field keys to generation input roles
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
