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
 *   PATCH  /models/:id                set cost_credits; cascades a
 *                                     recompute to every template that
 *                                     references this (provider, model_key)
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
import type { AppEnv } from '../types';

export const adminCreditsRoute = new Hono<AppEnv>();

adminCreditsRoute.use(
  '*',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin(),
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
      costPerCallUsd: providerModels.costPerCallUsd,
      updatedAt: providerModels.updatedAt,
    })
    .from(providerModels)
    .orderBy(providerModels.provider, providerModels.modelKey);
  return c.json({ data: rows });
});

const updateModelSchema = z.object({
  costCredits: z.number().int().min(0).max(100000),
});

adminCreditsRoute.patch(
  '/models/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateModelSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { costCredits } = c.req.valid('json');
    const adminId = c.var.user?.id ?? null;

    const [updated] = await c.var.db
      .update(providerModels)
      .set({
        costCredits,
        updatedAt: new Date(),
        updatedByAdminId: adminId,
      })
      .where(eq(providerModels.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: { code: 'not_found', message: 'Model not found.' } }, 404);
    }

    // Cascade: every template whose pipeline references this model
    // gets its cost_credits recomputed against the new pricing. This
    // keeps the "auto-calculated template cost" promise honoured even
    // when admin changes prices long after a template was authored.
    const touched = await recomputeTemplatesForModel(
      c.var.db,
      updated.provider,
      updated.modelKey,
    );

    return c.json({ data: { ...updated, templatesRecomputed: touched } });
  },
);

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
  entitlement: z.enum(['pro', 'pro_max']),
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
      entitlement: z.enum(['free', 'pro', 'pro_max']).optional(),
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
