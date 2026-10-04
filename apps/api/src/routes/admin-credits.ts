/**
 * `/v1/admin/credits/*` — admin-only configuration of the credit system.
 *
 * Five sub-routes mounted here (all `withAuth + withCurrentUser +
 * withAdmin`, so the audit-log middleware records every mutation):
 *
 *   GET    /overview                  high-level KPIs (issued, spent, top
 *                                     burning templates, missing model
 *                                     prices)
 *   GET    /models                    list provider_models + cost_credits
 *   GET    /models/:id                one row, with capabilities
 *   PATCH  /models/:id                price / name / status / tier pricing /
 *                                     (fal) capabilities; a price change
 *                                     cascades a recompute to every template
 *                                     that references this (provider, model_key)
 *   POST   /models                    create a database-driven fal model
 *   POST   /models/fal/inspect        read fal's schema + price for an
 *                                     endpoint id and propose a draft
 *
 *   GET    /packs                     list credit_packs
 *   POST   /packs                     create
 *   PATCH  /packs/:id                 update
 *   DELETE /packs/:id                 soft-delete (is_active=false)
 *
 *   GET    /subscriptions             list subscription_plans
 *   POST   /subscriptions             create
 *   PATCH  /subscriptions/:id         update
 *   DELETE /subscriptions/:id         soft-delete
 *
 *   GET    /grants                    welcome + periodic_free_refresh
 *   PATCH  /grants/:kind              update policy (amount, period, on/off)
 *
 * Pricing rows are NEVER hard-deleted because the RC webhook is the
 * only path that turns a store productId into a credit grant — losing
 * a row mid-purchase would silently drop money on the floor. The
 * DELETE handler flips `is_active = false` instead.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ASSIGNABLE_ENTITLEMENTS, PAID_TIERS } from '@clickfy/types';
import { findCapabilities, listDynamicModels } from '@clickfy/providers';

import {
  creditBroadcasts,
  creditLedger,
  creditPacks,
  grantPolicies,
  providerModels,
  subscriptionPlans,
} from '@clickfy/db';

import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import { recomputeTemplatesForModel } from '../lib/template-cost';
import { falModelCapabilitiesSchema } from '../lib/fal-model-schema';
import { invalidateDynamicModels } from '../lib/dynamic-models';
import { inspectFalEndpoint } from '../lib/fal-inspect';
import type { AppEnv } from '../types';

export const adminCreditsRoute = new Hono<AppEnv>();

adminCreditsRoute.use(
  '*',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'credits' }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
);

// Pull rows out of a Drizzle `db.execute()` result regardless of driver.
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] } | null;
  return r?.rows ?? [];
}

const idParamSchema = z.object({ id: z.string().uuid() });
const grantKindParamSchema = z.object({
  kind: z.enum(['welcome', 'periodic_free_refresh']),
});

// ─── Overview ───────────────────────────────────────────────────────

adminCreditsRoute.get('/overview', async (c) => {
  const db = c.var.db;
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    ledgerTotals,
    topBurners,
    missingPricesRow,
    packsCountRow,
    subsCountRow,
    recentBroadcasts,
  ] = await Promise.all([
    // Issued vs spent over last 7d and lifetime.
    db.execute<{
      issued_lifetime: number;
      spent_lifetime: number;
      issued_7d: number;
      spent_7d: number;
    }>(sql`
      SELECT
        COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0)::int AS issued_lifetime,
        COALESCE(SUM(-delta) FILTER (WHERE delta < 0), 0)::int AS spent_lifetime,
        COALESCE(SUM(delta) FILTER (WHERE delta > 0 AND created_at >= ${last7d}), 0)::int AS issued_7d,
        COALESCE(SUM(-delta) FILTER (WHERE delta < 0 AND created_at >= ${last7d}), 0)::int AS spent_7d
      FROM credit_ledger
    `),

    // Top burning templates (credits charged in last 7d).
    db.execute<{ template_id: string; title: string; spent: number; runs: number }>(sql`
      SELECT
        j.template_id,
        t.title,
        COALESCE(SUM(-cl.delta), 0)::int AS spent,
        COUNT(*)::int AS runs
      FROM credit_ledger cl
      JOIN jobs j ON j.id = cl.job_id
      JOIN templates t ON t.id = j.template_id
      WHERE cl.reason = 'job_charge'
        AND cl.created_at >= ${last7d}
      GROUP BY j.template_id, t.title
      ORDER BY spent DESC
      LIMIT 5
    `),

    // How many provider_models still have cost_credits = 0 — the
    // admin UI surfaces this as "you have N unpriced models".
    db.execute<{ unpriced: number }>(sql`
      SELECT COUNT(*)::int AS unpriced
      FROM provider_models
      WHERE cost_credits = 0
    `),

    db.execute<{ active: number; total: number }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE is_active = true)::int AS active,
        COUNT(*)::int AS total
      FROM credit_packs
    `),

    db.execute<{ active: number; total: number }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE is_active = true)::int AS active,
        COUNT(*)::int AS total
      FROM subscription_plans
    `),

    db
      .select({
        id: creditBroadcasts.id,
        amount: creditBroadcasts.amount,
        reason: creditBroadcasts.reason,
        recipientCount: creditBroadcasts.recipientCount,
        grantedCount: creditBroadcasts.grantedCount,
        sentAt: creditBroadcasts.sentAt,
      })
      .from(creditBroadcasts)
      .orderBy(desc(creditBroadcasts.sentAt))
      .limit(5),
  ]);

  const ledger = rowsOf<{
    issued_lifetime: number;
    spent_lifetime: number;
    issued_7d: number;
    spent_7d: number;
  }>(ledgerTotals)[0] ?? {
    issued_lifetime: 0,
    spent_lifetime: 0,
    issued_7d: 0,
    spent_7d: 0,
  };
  const burners = rowsOf<{
    template_id: string;
    title: string;
    spent: number;
    runs: number;
  }>(topBurners);
  const unpriced = rowsOf<{ unpriced: number }>(missingPricesRow)[0]?.unpriced ?? 0;
  const packs = rowsOf<{ active: number; total: number }>(packsCountRow)[0] ?? {
    active: 0,
    total: 0,
  };
  const subs = rowsOf<{ active: number; total: number }>(subsCountRow)[0] ?? {
    active: 0,
    total: 0,
  };

  c.header('Cache-Control', 'private, max-age=30');
  return c.json({
    data: {
      ledger,
      topBurners: burners.map((b) => ({
        templateId: b.template_id,
        title: b.title,
        spent: b.spent,
        runs: b.runs,
      })),
      catalog: {
        unpricedModels: unpriced,
        activePacks: packs.active,
        totalPacks: packs.total,
        activeSubscriptions: subs.active,
        totalSubscriptions: subs.total,
      },
      recentBroadcasts,
      window: { last24h: last24h.toISOString(), last7d: last7d.toISOString() },
    },
  });
});

// ─── Models ─────────────────────────────────────────────────────────

adminCreditsRoute.get('/models', async (c) => {
  const rows = await c.var.db
    .select({
      id: providerModels.id,
      provider: providerModels.provider,
      modelKey: providerModels.modelKey,
      displayName: providerModels.displayName,
      status: providerModels.status,
      costCredits: providerModels.costCredits,
      // Needed by the template editor's cost summary: without it the
      // admin could only ever show the base price, which disagrees with
      // what publish actually charges for any tiered stage.
      tierPricing: providerModels.tierPricing,
      costPerCallUsd: providerModels.costPerCallUsd,
      updatedAt: providerModels.updatedAt,
    })
    .from(providerModels)
    .orderBy(providerModels.provider, providerModels.modelKey);
  return c.json({ data: rows });
});

adminCreditsRoute.get('/models/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const row = await c.var.db.query.providerModels.findFirst({ where: eq(providerModels.id, id) });
  if (!row) return c.json({ error: { code: 'not_found', message: 'Model not found.' } }, 404);
  return c.json({ data: row });
});

const tierPricingSchema = z.record(z.string().min(1), z.number().int().min(0).max(100000));

const updateModelSchema = z
  .object({
    costCredits: z.number().int().min(0).max(100000).optional(),
    displayName: z.string().min(1).max(80).optional(),
    status: z.enum(['active', 'preview', 'deprecated']).optional(),
    costPerCallUsd: z.number().min(0).max(1000).optional(),
    /** Absolute credits per tier key; null clears to flat pricing. */
    tierPricing: tierPricingSchema.nullable().optional(),
    /** Database-driven fal models only. Validated against the fal schema. */
    capabilities: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to update');

adminCreditsRoute.patch(
  '/models/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateModelSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const adminId = c.var.user?.id ?? null;

    const existing = await c.var.db.query.providerModels.findFirst({ where: eq(providerModels.id, id) });
    if (!existing) {
      return c.json({ error: { code: 'not_found', message: 'Model not found.' } }, 404);
    }

    const set: Partial<typeof providerModels.$inferInsert> = {
      updatedAt: new Date(),
      updatedByAdminId: adminId,
    };
    if (body.costCredits !== undefined) set.costCredits = body.costCredits;
    if (body.displayName !== undefined) set.displayName = body.displayName;
    if (body.status !== undefined) set.status = body.status;
    if (body.costPerCallUsd !== undefined) set.costPerCallUsd = body.costPerCallUsd.toFixed(4);
    if (body.tierPricing !== undefined) set.tierPricing = body.tierPricing;

    if (body.capabilities !== undefined) {
      // Only a spec-driven fal row owns its capabilities; every other
      // row's blob is a copy of the code registry and is not editable.
      const isDynamic = existing.provider === 'fal' && 'fal' in (existing.capabilities ?? {});
      if (!isDynamic) {
        return c.json(
          { error: { code: 'capabilities_readonly', message: 'Only database-driven fal models can have their capabilities edited.' } },
          409,
        );
      }
      const parsed = falModelCapabilitiesSchema.safeParse({
        ...body.capabilities,
        provider: 'fal',
        modelKey: existing.modelKey,
        displayName: body.displayName ?? existing.displayName,
        status: body.status ?? existing.status,
      });
      if (!parsed.success) {
        return c.json(
          { error: { code: 'invalid_capabilities', message: 'Capabilities failed validation.', details: parsed.error.issues } },
          422,
        );
      }
      set.capabilities = parsed.data as Record<string, unknown>;
    } else if (body.displayName !== undefined || body.status !== undefined) {
      // Keep the blob's own copies of name/status in step for dynamic rows.
      if (existing.provider === 'fal' && 'fal' in (existing.capabilities ?? {})) {
        set.capabilities = {
          ...existing.capabilities,
          displayName: body.displayName ?? existing.displayName,
          status: body.status ?? existing.status,
        };
      }
    }

    const [updated] = await c.var.db
      .update(providerModels)
      .set(set)
      .where(eq(providerModels.id, id))
      .returning();
    if (!updated) {
      return c.json({ error: { code: 'not_found', message: 'Model not found.' } }, 404);
    }
    invalidateDynamicModels();

    // Cascade: every template whose pipeline references this model
    // gets its cost_credits recomputed against the new pricing. This
    // keeps the "auto-calculated template cost" promise honoured even
    // when admin changes prices long after a template was authored.
    const touched =
      body.costCredits !== undefined || body.tierPricing !== undefined
        ? await recomputeTemplatesForModel(c.var.db, updated.provider, updated.modelKey)
        : 0;

    return c.json({ data: { ...updated, templatesRecomputed: touched } });
  },
);

// ─── Database-driven fal models ──────────────────────────────────────
//
// A fal model is configuration: an endpoint per task, a field map, the
// option lists, a price. `POST /models` creates one from that; the
// registry picks it up on the next request (API) and the next job
// (worker) with no deploy. `POST /models/fal/inspect` reads fal's own
// OpenAPI schema and price for an endpoint and proposes a draft, so the
// admin edits a filled-in form rather than writing JSON from memory.

const createModelSchema = z.object({
  modelKey: z.string().min(2).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().min(1).max(80),
  status: z.enum(['active', 'preview', 'deprecated']).default('preview'),
  costPerCallUsd: z.number().min(0).max(1000),
  costCredits: z.number().int().min(0).max(100000).default(0),
  tierPricing: tierPricingSchema.nullable().optional(),
  capabilities: z.record(z.string(), z.unknown()),
});

adminCreditsRoute.post('/models', zValidator('json', createModelSchema), async (c) => {
  const body = c.req.valid('json');
  const adminId = c.var.user?.id ?? null;

  const parsed = falModelCapabilitiesSchema.safeParse({
    ...body.capabilities,
    provider: 'fal',
    modelKey: body.modelKey,
    displayName: body.displayName,
    status: body.status,
  });
  if (!parsed.success) {
    return c.json(
      { error: { code: 'invalid_capabilities', message: 'Capabilities failed validation.', details: parsed.error.issues } },
      422,
    );
  }
  // A code-registry key cannot be shadowed by a row.
  if (findCapabilities(body.modelKey) && !listDynamicModels().some((m) => m.modelKey === body.modelKey)) {
    return c.json(
      { error: { code: 'model_key_taken', message: 'That model key belongs to a code-registry model.' } },
      409,
    );
  }

  const [row] = await c.var.db
    .insert(providerModels)
    .values({
      provider: 'fal',
      modelKey: body.modelKey,
      displayName: body.displayName,
      status: body.status,
      capabilities: parsed.data as Record<string, unknown>,
      costPerCallUsd: body.costPerCallUsd.toFixed(4),
      costCredits: body.costCredits,
      tierPricing: body.tierPricing ?? null,
      updatedAt: new Date(),
      updatedByAdminId: adminId,
    })
    .onConflictDoNothing({ target: [providerModels.provider, providerModels.modelKey] })
    .returning();
  if (!row) {
    return c.json({ error: { code: 'model_exists', message: 'A model with that key already exists.' } }, 409);
  }
  invalidateDynamicModels();
  return c.json({ data: row }, 201);
});

const inspectSchema = z.object({
  endpointId: z.string().min(3).max(200).regex(/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/i),
});

adminCreditsRoute.post('/models/fal/inspect', zValidator('json', inspectSchema), async (c) => {
  const { endpointId } = c.req.valid('json');
  try {
    const draft = await inspectFalEndpoint(endpointId, c.env.FAL_KEY);
    return c.json({ data: draft });
  } catch (err) {
    return c.json(
      { error: { code: 'inspect_failed', message: err instanceof Error ? err.message : 'Could not inspect that endpoint.' } },
      502,
    );
  }
});

// ─── Credit packs (consumable IAPs) ─────────────────────────────────

adminCreditsRoute.get('/packs', async (c) => {
  const rows = await c.var.db
    .select()
    .from(creditPacks)
    .orderBy(creditPacks.displayOrder, creditPacks.createdAt);
  return c.json({ data: rows });
});

const createPackSchema = z.object({
  storeProductId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(120),
  credits: z.number().int().min(1).max(1_000_000),
  bonusCredits: z.number().int().min(0).max(1_000_000).default(0),
  displayOrder: z.number().int().min(0).max(1_000).default(0),
  isFeatured: z.boolean().default(false),
  isActive: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});

adminCreditsRoute.post(
  '/packs',
  zValidator('json', createPackSchema),
  async (c) => {
    const body = c.req.valid('json');
    const adminId = c.var.user?.id ?? null;

    try {
      const [row] = await c.var.db
        .insert(creditPacks)
        .values({
          ...body,
          notes: body.notes ?? null,
          updatedByAdminId: adminId,
        })
        .returning();
      return c.json({ data: row }, 201);
    } catch (err) {
      if (err instanceof Error && err.message.includes('credit_packs_store_product_id')) {
        return c.json(
          {
            error: {
              code: 'duplicate_product_id',
              message: 'A pack with this store product id already exists.',
            },
          },
          409,
        );
      }
      throw err;
    }
  },
);

const updatePackSchema = createPackSchema.partial();

adminCreditsRoute.patch(
  '/packs/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updatePackSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const adminId = c.var.user?.id ?? null;

    const [row] = await c.var.db
      .update(creditPacks)
      .set({
        ...body,
        notes: body.notes === undefined ? undefined : body.notes ?? null,
        updatedAt: new Date(),
        updatedByAdminId: adminId,
      })
      .where(eq(creditPacks.id, id))
      .returning();

    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Pack not found.' } }, 404);
    }
    return c.json({ data: row });
  },
);

adminCreditsRoute.delete(
  '/packs/:id',
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    // Soft-delete only — see file header for the rationale.
    const [row] = await c.var.db
      .update(creditPacks)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(creditPacks.id, id))
      .returning();
    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Pack not found.' } }, 404);
    }
    return c.json({ data: { id: row.id, isActive: false } });
  },
);

// ─── Subscription plans ─────────────────────────────────────────────

adminCreditsRoute.get('/subscriptions', async (c) => {
  const rows = await c.var.db
    .select()
    .from(subscriptionPlans)
    .orderBy(subscriptionPlans.displayOrder, subscriptionPlans.createdAt);
  return c.json({ data: rows });
});

const createSubSchema = z.object({
  storeProductId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(120),
  entitlement: z.enum(PAID_TIERS),
  intervalUnit: z.enum(['week', 'month', 'year']),
  intervalCount: z.number().int().min(1).max(12).default(1),
  creditsPerPeriod: z.number().int().min(0).max(1_000_000),
  displayOrder: z.number().int().min(0).max(1_000).default(0),
  isFeatured: z.boolean().default(false),
  isActive: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});

adminCreditsRoute.post(
  '/subscriptions',
  zValidator('json', createSubSchema),
  async (c) => {
    const body = c.req.valid('json');
    const adminId = c.var.user?.id ?? null;
    try {
      const [row] = await c.var.db
        .insert(subscriptionPlans)
        .values({
          ...body,
          notes: body.notes ?? null,
          updatedByAdminId: adminId,
        })
        .returning();
      return c.json({ data: row }, 201);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('subscription_plans_store_product_id')
      ) {
        return c.json(
          {
            error: {
              code: 'duplicate_product_id',
              message: 'A subscription with this store product id already exists.',
            },
          },
          409,
        );
      }
      throw err;
    }
  },
);

const updateSubSchema = createSubSchema.partial();

adminCreditsRoute.patch(
  '/subscriptions/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateSubSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const adminId = c.var.user?.id ?? null;

    const [row] = await c.var.db
      .update(subscriptionPlans)
      .set({
        ...body,
        notes: body.notes === undefined ? undefined : body.notes ?? null,
        updatedAt: new Date(),
        updatedByAdminId: adminId,
      })
      .where(eq(subscriptionPlans.id, id))
      .returning();

    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Plan not found.' } }, 404);
    }
    return c.json({ data: row });
  },
);

adminCreditsRoute.delete(
  '/subscriptions/:id',
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const [row] = await c.var.db
      .update(subscriptionPlans)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(subscriptionPlans.id, id))
      .returning();
    if (!row) {
      return c.json({ error: { code: 'not_found', message: 'Plan not found.' } }, 404);
    }
    return c.json({ data: { id: row.id, isActive: false } });
  },
);

// ─── Grant policies (welcome / periodic refresh) ────────────────────

adminCreditsRoute.get('/grants', async (c) => {
  const rows = await c.var.db
    .select()
    .from(grantPolicies)
    .orderBy(grantPolicies.kind);
  return c.json({ data: rows });
});

const updateGrantSchema = z.object({
  isActive: z.boolean().optional(),
  amount: z.number().int().min(0).max(1_000_000).optional(),
  periodUnit: z.enum(['day', 'week', 'month']).nullable().optional(),
  periodCount: z.number().int().min(1).max(52).nullable().optional(),
  audience: z
    .object({
      entitlement: z.enum(ASSIGNABLE_ENTITLEMENTS).optional(),
    })
    .optional(),
});

adminCreditsRoute.patch(
  '/grants/:kind',
  zValidator('param', grantKindParamSchema),
  zValidator('json', updateGrantSchema),
  async (c) => {
    const { kind } = c.req.valid('param');
    const body = c.req.valid('json');
    const adminId = c.var.user?.id ?? null;

    const setObj: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedByAdminId: adminId,
    };
    if (body.isActive !== undefined) setObj.isActive = body.isActive;
    if (body.amount !== undefined) setObj.amount = body.amount;
    if (body.periodUnit !== undefined) setObj.periodUnit = body.periodUnit;
    if (body.periodCount !== undefined) setObj.periodCount = body.periodCount;
    if (body.audience !== undefined) setObj.audience = body.audience;

    const [row] = await c.var.db
      .update(grantPolicies)
      .set(setObj)
      .where(eq(grantPolicies.kind, kind))
      .returning();

    if (!row) {
      return c.json(
        { error: { code: 'not_found', message: `Grant policy '${kind}' not found.` } },
        404,
      );
    }
    return c.json({ data: row });
  },
);

// ─── Ledger sample (audit support) ──────────────────────────────────

/**
 * GET /admin/credits/ledger?limit=N
 *
 * Recent credit_ledger rows for the admin audit page. Lightweight —
 * the full audit lives in `admin_audit_log`, but a sample of the
 * ledger answers "what credit moves happened in the last hour" at a
 * glance.
 */
adminCreditsRoute.get(
  '/ledger',
  zValidator(
    'query',
    z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      since: z.coerce.date().optional(),
    }),
  ),
  async (c) => {
    const { limit, since } = c.req.valid('query');
    const where = since ? gte(creditLedger.createdAt, since) : undefined;
    const rows = await c.var.db
      .select()
      .from(creditLedger)
      .where(where)
      .orderBy(desc(creditLedger.createdAt))
      .limit(limit);
    return c.json({ data: rows });
  },
);
