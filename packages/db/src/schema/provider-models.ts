/**
 * `provider_models` — the capability registry.
 *
 * Why this exists: Gemini/Kling/Veo ship new models and deprecate old
 * ones every quarter. Each new model has slightly different aspect
 * ratios, image sizes, duration limits, etc. We do NOT want to hardcode
 * these — instead, the admin dashboard reads from this table to render
 * the right controls, and the mobile DTO is also derived from it.
 *
 * Updating a model's capabilities is a single row update; no app change
 * is required.
 */

import { sql } from 'drizzle-orm';
import { integer, numeric, pgTable, text, timestamp, unique, uuid, jsonb } from 'drizzle-orm/pg-core';

import { modelStatusEnum, providerEnum } from './enums';

/**
 * Shape of the `capabilities` JSONB blob. Kept intentionally opaque at
 * the DB layer — the canonical, fully-typed `ModelCapabilities` lives
 * in `@clickfy/providers` (the package the worker and the admin form
 * both import from). Pinning the DB type here would create a circular
 * dependency: providers → db → providers. The API layer validates the
 * blob against the providers schema before insert/update.
 */
type ProviderModelCapabilitiesJson = Record<string, unknown>;

export const providerModels = pgTable(
  'provider_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: providerEnum('provider').notNull(),
    modelKey: text('model_key').notNull(),
    displayName: text('display_name').notNull(),
    status: modelStatusEnum('status').default('active').notNull(),

    capabilities: jsonb('capabilities').$type<ProviderModelCapabilitiesJson>().notNull(),
    defaultFallbackModelKey: text('default_fallback_model_key'),

    /** USD per call, decimal — kept as numeric to avoid float drift. */
    costPerCallUsd: numeric('cost_per_call_usd', { precision: 10, scale: 4 }).notNull(),
    /**
     * What a user is charged in credits for one call against this model.
     * Set by an admin from `/admin/credits/models`. Templates compute
     * their total cost as the sum of the `cost_credits` of every model
     * in their pipeline (snapshotted into the template version on publish).
     */
    costCredits: integer('cost_credits').default(0).notNull(),
    timeoutMs: integer('timeout_ms').default(60000).notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedByAdminId: uuid('updated_by_admin_id'),
  },
  (t) => [unique('provider_models_unique').on(t.provider, t.modelKey)],
);

export type ProviderModel = typeof providerModels.$inferSelect;
export type NewProviderModel = typeof providerModels.$inferInsert;
