/**
 * `/v1/admin/analytics/*` — cost, credit value, cash and profit.
 *
 *   GET  /costs                 totals + a zero-filled series for the range
 *                               (`?from&to&bucket=day|week|month` + filters),
 *                               with provider-invoice rows for the months touched
 *   GET  /costs/by              one row per model | provider | user | origin | template
 *   GET  /jobs                  per-generation drill-down, cursor-paginated
 *   GET  /jobs/:id              one run in full: inputs, outputs, raw error, timings, ledger
 *   GET  /export.csv            the same rows as a spreadsheet (newest first, capped)
 *   GET  /export-monthly.csv    one month, one row per model
 *   PUT  /invoices              type in (or correct) a provider's monthly invoice total
 *   DELETE /invoices/:id        remove one
 *
 * Common query params: `from`, `to` (YYYY-MM-DD, Dubai, inclusive;
 * default the last 30 days), `model`, `provider`, `userId`, `origin`,
 * `status`, `basis`. A job belongs to the Dubai day it was created.
 *
 * All of it sits behind `withAdmin({ page: 'analytics' })`; the audit
 * middleware records the two mutations. Every number's definition is in
 * `@clickfy/types/admin-analytics`; every query is in
 * `lib/analytics-sql.ts`.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { providerInvoices } from '@clickfy/db';
import {
  ANALYTICS_BUCKETS,
  ANALYTICS_DIMENSIONS,
  ANALYTICS_TIMEZONE,
  bucketKeys,
  csvRow,
  dubaiDateOf,
  monthKeys,
  monthRange,
  parseAnalyticsRange,
  type AnalyticsRange,
  type CostBreakdownResponse,
  type CostSeriesPoint,
  type CostsResponse,
  type AnalyticsJobsResponse,
} from '@clickfy/types';

import { withAdmin, withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import {
  EMPTY_AGG,
  cashSeries,
  costBreakdown,
  costSeries,
  exportJobs,
  invoiceComparison,
  jobDetail,
  listJobs,
  toTotals,
  type JobFilters,
} from '../lib/analytics-sql';
import { assetUrl } from '../lib/asset-url';
import type { AppEnv } from '../types';

export const adminAnalyticsRoute = new Hono<AppEnv>();

adminAnalyticsRoute.use(
  '*',
  withAuth({ required: true }),
  withCurrentUser(),
  withAdmin({ page: 'analytics' }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
);

/** Rows the CSV export will hand back at most; a Worker holds the whole file in memory. */
const EXPORT_MAX_ROWS = 20_000;

const filtersSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  model: z.string().min(1).max(120).optional(),
  provider: z.string().min(1).max(40).optional(),
  userId: z.string().uuid().optional(),
  origin: z.enum(['create', 'template', 'tool']).optional(),
  status: z.enum(['completed', 'failed']).optional(),
  basis: z.enum(['exact', 'computed', 'estimated']).optional(),
});
type FiltersQuery = z.infer<typeof filtersSchema>;

function splitQuery(q: FiltersQuery): { range: AnalyticsRange; filters: JobFilters } | { error: string } {
  try {
    const range = parseAnalyticsRange(q.from, q.to);
    const { from: _f, to: _t, ...filters } = q;
    return { range, filters };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'invalid range' };
  }
}

/** Cash is money per customer, not per model: it is only meaningful unfiltered or per user. */
function cashApplies(f: JobFilters): boolean {
  return !f.model && !f.provider && !f.origin && !f.status && !f.basis;
}

const invalidRange = (c: { json: (body: unknown, status: 400) => Response }, message: string) =>
  c.json({ error: { code: 'invalid_range', message } }, 400);

// ─── GET /costs ───────────────────────────────────────────────────────

adminAnalyticsRoute.get(
  '/costs',
  zValidator('query', filtersSchema.extend({ bucket: z.enum(ANALYTICS_BUCKETS as [string, ...string[]]).default('day') })),
  async (c) => {
    const q = c.req.valid('query');
    const parsed = splitQuery(q);
    if ('error' in parsed) return invalidRange(c, parsed.error);
    const { range, filters } = parsed;
    const bucket = q.bucket as (typeof ANALYTICS_BUCKETS)[number];
    const withCash = cashApplies(filters);

    const [costs, cash, invoices] = await Promise.all([
      costSeries(c.var.db, range, bucket, filters),
      withCash ? cashSeries(c.var.db, range, bucket, filters.userId) : null,
      invoiceComparison(c.var.db, range, monthKeys(range)),
    ]);

    const series: CostSeriesPoint[] = bucketKeys(range, bucket).map((key) => ({
      bucket: key,
      ...toTotals(costs.byBucket.get(key) ?? EMPTY_AGG, cash ? (cash.byBucket.get(key) ?? emptyCash()) : null),
    }));

    const body: CostsResponse = {
      range: { from: range.from, to: range.to, bucket, timezone: ANALYTICS_TIMEZONE },
      filters,
      totals: toTotals(costs.total, cash ? cash.total : null),
      series,
      invoices,
      generatedAt: new Date().toISOString(),
    };
    c.header('Cache-Control', 'private, max-age=30');
    return c.json({ data: body });
  },
);

function emptyCash() {
  return { count: 0, grossCents: 0, refundedCents: 0, netCents: 0, subscriptionCents: 0, packCents: 0 };
}

// ─── GET /costs/by ────────────────────────────────────────────────────

adminAnalyticsRoute.get(
  '/costs/by',
  zValidator(
    'query',
    filtersSchema.extend({
      dim: z.enum(ANALYTICS_DIMENSIONS as [string, ...string[]]).default('model'),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  ),
  async (c) => {
    const q = c.req.valid('query');
    const parsed = splitQuery(q);
    if ('error' in parsed) return invalidRange(c, parsed.error);
    const dim = q.dim as (typeof ANALYTICS_DIMENSIONS)[number];
    const rows = await costBreakdown(c.var.db, parsed.range, parsed.filters, dim, q.limit);
    const body: CostBreakdownResponse = {
      dim,
      range: { from: parsed.range.from, to: parsed.range.to, timezone: ANALYTICS_TIMEZONE },
      rows,
      generatedAt: new Date().toISOString(),
    };
    c.header('Cache-Control', 'private, max-age=30');
    return c.json({ data: body });
  },
);

// ─── GET /jobs ────────────────────────────────────────────────────────

adminAnalyticsRoute.get(
  '/jobs',
  zValidator(
    'query',
    filtersSchema.extend({
      search: z.string().min(1).max(120).optional(),
      cursor: z.string().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  ),
  async (c) => {
    const q = c.req.valid('query');
    const parsed = splitQuery(q);
    if ('error' in parsed) return invalidRange(c, parsed.error);
    const { rows, nextCursor, total } = await listJobs(c.var.db, parsed.range, parsed.filters, {
      search: q.search,
      cursor: q.cursor,
      limit: q.limit,
    });
    const body: AnalyticsJobsResponse = { data: rows, nextCursor, total };
    return c.json(body);
  },
);

adminAnalyticsRoute.get('/jobs/:id', zValidator('param', z.object({ id: z.string().uuid() })), async (c) => {
  const { id } = c.req.valid('param');
  const detail = await jobDetail(c.var.db, id, new URL(c.req.url).origin, assetUrl);
  if (!detail) return c.json({ error: { code: 'not_found', message: 'Job not found.' } }, 404);
  return c.json({ data: detail });
});

// ─── CSV exports ──────────────────────────────────────────────────────

const JOB_CSV_HEADER = [
  'job_id', 'created_at_dubai', 'created_at_utc', 'status', 'origin', 'provider', 'model_key', 'model_name', 'template',
  'user_email', 'mode', 'duration_s', 'credits_charged', 'credits_refunded', 'credits_net', 'paid_credits_net',
  'credit_value_usd', 'provider_cost_usd', 'cost_basis', 'profit_usd', 'error_code', 'provider_request_ids',
];

function csvResponse(c: { body: (data: string, status: 200, headers: Record<string, string>) => Response }, lines: string[], filename: string, truncated = false) {
  const headers: Record<string, string> = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  };
  if (truncated) headers['X-Truncated'] = 'true';
  // BOM so Excel opens UTF-8 (Arabic names) correctly.
  return c.body(`﻿${lines.join('\r\n')}\r\n`, 200, headers);
}

adminAnalyticsRoute.get('/export.csv', zValidator('query', filtersSchema), async (c) => {
  const parsed = splitQuery(c.req.valid('query'));
  if ('error' in parsed) return invalidRange(c, parsed.error);
  const { rows, truncated } = await exportJobs(c.var.db, parsed.range, parsed.filters, EXPORT_MAX_ROWS);
  const lines = [csvRow(JOB_CSV_HEADER)];
  for (const r of rows) {
    const created = new Date(r.createdAt);
    lines.push(
      csvRow([
        r.id, `${dubaiDateOf(created)} ${dubaiClock(created)}`, r.createdAt, r.status, r.origin, r.provider, r.modelKey, r.modelName,
        r.templateTitle, r.user.email, r.mode, r.durationSeconds, r.creditsCharged, r.creditsRefunded, r.creditsNet,
        r.paidCreditsNet, r.creditValueUsd, r.providerCostUsd, r.costBasis, r.profitUsd, r.errorCode, r.requestIds?.join(' ') ?? null,
      ]),
    );
  }
  return csvResponse(c, lines, `clickefy-generations-${parsed.range.from}-to-${parsed.range.to}.csv`, truncated);
});

function dubaiClock(d: Date): string {
  return new Date(d.getTime() + 4 * 3600_000).toISOString().slice(11, 19);
}

adminAnalyticsRoute.get(
  '/export-monthly.csv',
  zValidator('query', z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) })),
  async (c) => {
    const { month } = c.req.valid('query');
    let range: AnalyticsRange;
    try {
      range = monthRange(month);
    } catch (e) {
      return invalidRange(c, e instanceof Error ? e.message : 'invalid month');
    }
    const rows = await costBreakdown(c.var.db, range, {}, 'model', 200);
    const lines = [
      csvRow(['month', 'model_key', 'model_name', 'provider', 'jobs', 'completed', 'failed', 'provider_cost_usd', 'failed_cost_usd',
        'avg_cost_usd', 'credits_net', 'paid_credits_net', 'credit_value_usd', 'profit_usd', 'margin_pct']),
      ...rows.map((r) =>
        csvRow([month, r.key, r.label, r.sublabel, r.jobs, r.completed, r.failed, r.costUsd, r.failedCostUsd, r.avgCostUsd,
          r.creditsNet, r.paidCreditsNet, r.creditValueUsd, r.profitUsd, r.marginPct]),
      ),
    ];
    return csvResponse(c, lines, `clickefy-models-${month}.csv`);
  },
);

// ─── Provider invoices ────────────────────────────────────────────────

const invoiceBodySchema = z.object({
  provider: z.string().trim().min(1).max(40),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  amountUsd: z.number().min(0).max(10_000_000),
  note: z.string().trim().max(500).optional().nullable(),
});

adminAnalyticsRoute.put('/invoices', zValidator('json', invoiceBodySchema), async (c) => {
  const b = c.req.valid('json');
  const [row] = await c.var.db
    .insert(providerInvoices)
    .values({
      provider: b.provider,
      month: `${b.month}-01`,
      amountUsd: b.amountUsd.toFixed(2),
      note: b.note ?? null,
      updatedByAdminId: c.var.user?.id ?? null,
    })
    .onConflictDoUpdate({
      target: [providerInvoices.provider, providerInvoices.month],
      set: { amountUsd: b.amountUsd.toFixed(2), note: b.note ?? null, updatedByAdminId: c.var.user?.id ?? null, updatedAt: new Date() },
    })
    .returning();
  return c.json({
    data: {
      id: row!.id,
      provider: row!.provider,
      month: b.month,
      billedUsd: Number(row!.amountUsd),
      note: row!.note,
      updatedAt: row!.updatedAt.toISOString(),
    },
  });
});

adminAnalyticsRoute.delete('/invoices/:id', zValidator('param', z.object({ id: z.string().uuid() })), async (c) => {
  const { id } = c.req.valid('param');
  const deleted = await c.var.db.delete(providerInvoices).where(eq(providerInvoices.id, id)).returning();
  if (deleted.length === 0) return c.json({ error: { code: 'not_found', message: 'Invoice not found.' } }, 404);
  return new Response(null, { status: 204 });
});
