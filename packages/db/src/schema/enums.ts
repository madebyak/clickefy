/**
 * Postgres enums — the single source of truth for every fixed-set string
 * column in the schema. Naming convention: snake_case for the enum's DB
 * identifier, camelCase for the exported TS binding.
 *
 * When adding a value, add a migration (do not mutate enums in place);
 * Postgres only allows additions via `ALTER TYPE ... ADD VALUE`.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const localeEnum = pgEnum('locale', ['ar', 'en']);

export const entitlementEnum = pgEnum('entitlement', [
  'free',
  'pro',
  'pro_max',
  'admin',
]);

/**
 * `template_kind` — what a published template produces, from the user's
 * point of view. Not to be confused with `generation.mode` (a JSON field
 * that captures the *pipeline shape*, e.g. "render an image then animate
 * it"). The DB stores this user-facing axis so list/filter queries don't
 * have to parse the generation JSON.
 *
 * Values:
 *   - `image`     — single image output
 *   - `video`     — single video clip output
 *   - `image_set` — coordinated set of images (lookbooks, carousels)
 */
export const templateKindEnum = pgEnum('template_kind', [
  'image',
  'video',
  'image_set',
]);

export const templateStatusEnum = pgEnum('template_status', [
  'draft',
  'published',
  'archived',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'processing',
  'completed',
  'failed',
  'purged',
]);

export const creditReasonEnum = pgEnum('credit_reason', [
  'purchase',
  'subscription_grant',
  'job_charge',
  'refund',
  'admin_adjust',
  'signup_bonus',
  'daily_free',
]);

/**
 * `provider` — AI provider families.
 *
 * The DB enum intentionally includes `veo` as a forward-compatible slot
 * even though the TS `Provider` union in `@clickfy/types` and the API
 * Zod schemas only accept `gemini | kling` today. Postgres only allows
 * appending enum values (no in-place removal without a destructive
 * migration), so we keep the wider set in the DB and let the API layer
 * be the gatekeeper. Add a `Provider` arm before turning on the column
 * for that value at the application layer.
 */
export const providerEnum = pgEnum('provider', ['gemini', 'kling', 'veo']);

export const modelStatusEnum = pgEnum('model_status', [
  'active',
  'preview',
  'deprecated',
]);
