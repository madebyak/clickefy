/**
 * Re-export of canonical JSONB column types from `@clickfy/types`.
 *
 * These shapes used to live in this file. They were moved to
 * `@clickfy/types` so the admin and mobile apps can consume them
 * without taking a dependency on Drizzle. Schema files import them
 * here for ergonomic `import type { ... } from './json-types';` paths
 * inside the schema directory.
 */
export type {
  MediaRef,
  StreamRef,
  TemplateInputType,
  TemplateInputBase,
  TemplateInputText,
  TemplateInputTextarea,
  TemplateInputImage,
  TemplateInputImageMulti,
  TemplateInputVideo,
  TemplateInputSelectOption,
  TemplateInputSelect,
  TemplateInputToggle,
  TemplateInputColor,
  TemplateInputField,
  Provider,
  ReferenceImageRole,
  GenerationReference,
  GenerationStage,
  TemplateGeneration,
  TemplateOutput,
  TemplateStats,
  JobInputValue,
  JobProgress,
  JobResult,
  JobError,
} from '@clickfy/types';
