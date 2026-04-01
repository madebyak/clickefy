/**
 * Template data models
 * Core structure for AI generation templates
 * 
 * TODO: [Database Integration] Add MongoDB _id field when connecting to database
 * TODO: [Versioning] Add version tracking fields for template history
 */

export type TemplateType = 'image' | 'video' | 'image-then-video';
export type TemplateStatus = 'draft' | 'published' | 'archived';
export type GenerationMode = 'image' | 'video' | 'image-then-video';
export type ProviderType = 'gemini' | 'kling';
export type ActionType = 'text-to-image' | 'image-to-image' | 'image-to-video';

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

  // Visual content for mobile app
  coverImage: string;
  previewGallery: string[];

  // User input configuration
  userInputs: TemplateInput[];

  // Generation configuration
  generation: {
    mode: GenerationMode;
    stages: GenerationStage[];
  };

  // Output settings
  output: {
    type: 'image' | 'video' | 'both';
    count: number;
    format: string;
    allowRegeneration: boolean;
  };

  // Metadata
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
  type: 'image' | 'video';
  acceptedFormats: string[];
  maxSize: number; // in MB
  minResolution?: { width: number; height: number };
  order: number;
}

export interface GenerationStage {
  id: string;
  order: number;
  provider: ProviderType;
  model: string;
  actionType: ActionType;

  // Prompt configuration (single text field as per requirements)
  prompt: string;

  // Input mapping (maps user uploads to generation inputs)
  inputMapping: Record<string, string>;

  // Reference images (admin-only, hidden from users)
  references: ReferenceImage[];

  // Provider-specific configuration
  config: ProviderConfig;

  // Retry logic
  retry: {
    enabled: boolean;
    maxAttempts: number;
    fallbackModel?: string;
  };
}

export interface ReferenceImage {
  id: string;
  url: string;
  type: 'inspiration' | 'composition' | 'style' | 'lighting';
}

export interface ProviderConfig {
  // Gemini-specific
  aspectRatio?: string;
  imageSize?: '512' | '1K' | '2K' | '4K';
  numberOfOutputs?: number;

  // Kling-specific
  duration?: number;
  motionPrompt?: string;

  // Generic
  [key: string]: any;
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
