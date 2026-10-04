/**
 * The SQL behind `/v1/admin/analytics/*`.
 *
 * Every query starts from the same two CTEs:
 *
 *   j   the jobs in the requested Dubai range that pass the filters, with
 *       the model key resolved (a template job has no `model_key`; its
 *       first billed unit names the model) and the cost columns cast
 *   c   those jobs' ledger rows folded to four integers — credits
 *       charged, credits refunded, and the PAID share of each. The paid
 *       share is read from the breakdown the allocator wrote on the row
 *       (`fromSubscription + fromTopup` on a charge, `rSub + rTopup` on a
 *       refund); the one pre-lots row without a breakdown falls back to
 *       its `bucket`.
 *
 * Reads only. Nothing here writes, and nothing here is reached without
 * `withAdmin({ page: 'analytics' })`.
 */

import { sql, type SQL } from 'drizzle-orm';

import type { Db } from '@clickfy/db';
import {
  ANALYTICS_TIMEZONE,
  creditValueUsd,
  marginPct,
  round2,
  type AnalyticsBucket,
  type AnalyticsDimension,
  type AnalyticsFilters,
  type AnalyticsJobDetail,
  type AnalyticsJobRow,
  type AnalyticsRange,
  type CashTotals,
  type CostBreakdownRow,
  type CostTotals,
  type ProviderInvoiceRow,
} from '@clickfy/types';

export type JobFilters = Omit<AnalyticsFilters, 'from' | 'to'>;

/** Neon HTTP returns the array; the socket driver returns `{ rows }`. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] } | null;
  return r?.rows ?? [];
}

const MODEL_KEY = sql`COALESCE(j.model_key, j.provider_billed_units->0->>'model')`;

function jobsWhere(range: AnalyticsRange, f: JobFilters): SQL {
  const parts: SQL[] = [sql`j.created_at >= ${range.fromUtc}`, sql`j.created_at < ${range.toUtc}`];
  if (f.model) parts.push(sql`${MODEL_KEY} = ${f.model}`);
  if (f.provider) parts.push(sql`j.provider = ${f.provider}`);
  if (f.userId) parts.push(sql`j.user_id = ${f.userId}::uuid`);
  if (f.origin) parts.push(sql`j.origin = ${f.origin}`);
  if (f.status) parts.push(sql`j.status = ${f.status}::job_status`);
  if (f.basis) parts.push(sql`j.cost_basis = ${f.basis}`);
  return sql.join(parts, sql` AND `);
}

/** `WITH j AS (…), c AS (…)` — see the file header. */
function withJobs(range: AnalyticsRange, f: JobFilters): SQL {
  return sql`
    WITH j AS (
      SELECT
        j.id, j.user_id, j.status::text AS status, j.origin, j.provider, j.created_at, j.completed_at,
        j.template_id, j.options, j.error, j.provider_billed_units, j.provider_request_ids, j.cost_basis,
        ${MODEL_KEY} AS model_key,
        j.provider_cost_usd::float8 AS cost_usd
      FROM jobs j
      WHERE ${jobsWhere(range, f)}
    ),
    c AS (
      SELECT
        l.job_id,
        COALESCE(SUM(CASE WHEN l.reason = 'job_charge' THEN -l.delta END), 0)::int AS charged,
        COALESCE(SUM(CASE WHEN l.reason = 'refund' THEN l.delta END), 0)::int AS refunded,
        COALESCE(SUM(CASE WHEN l.reason = 'job_charge' THEN
          CASE WHEN l.metadata ? 'fromPromo'
               THEN COALESCE((l.metadata->>'fromSubscription')::int, 0) + COALESCE((l.metadata->>'fromTopup')::int, 0)
               WHEN l.bucket IN ('subscription', 'topup') THEN -l.delta
               ELSE 0 END
        END), 0)::int AS paid_charged,
        COALESCE(SUM(CASE WHEN l.reason = 'refund' THEN
          CASE WHEN l.metadata ? 'rSub'
               THEN COALESCE((l.metadata->>'rSub')::int, 0) + COALESCE((l.metadata->>'rTopup')::int, 0)
               WHEN l.bucket IN ('subscription', 'topup') THEN l.delta
               ELSE 0 END
        END), 0)::int AS paid_refunded
      FROM credit_ledger l
      JOIN j ON j.id = l.job_id
      GROUP BY l.job_id
    )`;
}

/** The per-group aggregates every roll-up shares. Expects `j LEFT JOIN c`. */
const AGGREGATES = sql`
  COUNT(*)::int AS jobs,
  COUNT(*) FILTER (WHERE j.status = 'completed')::int AS completed,
  COUNT(*) FILTER (WHERE j.status = 'failed')::int AS failed,
  COUNT(*) FILTER (WHERE j.status IN ('queued', 'processing'))::int AS running,
  COALESCE(SUM(j.cost_usd), 0)::float8 AS cost_usd,
  COALESCE(SUM(j.cost_usd) FILTER (WHERE j.status = 'failed'), 0)::float8 AS failed_cost_usd,
  COUNT(*) FILTER (WHERE j.cost_basis = 'exact')::int AS basis_exact,
  COUNT(*) FILTER (WHERE j.cost_basis = 'computed')::int AS basis_computed,
  COUNT(*) FILTER (WHERE j.cost_basis = 'estimated')::int AS basis_estimated,
  COUNT(*) FILTER (WHERE j.cost_basis IS NULL AND j.status IN ('completed', 'failed'))::int AS unpriced,
  COALESCE(SUM(c.charged), 0)::int AS credits_charged,
  COALESCE(SUM(c.refunded), 0)::int AS credits_refunded,
  COALESCE(SUM(c.paid_charged - c.paid_refunded), 0)::int AS paid_net`;

interface AggRow {
  jobs: number;
  completed: number;
  failed: number;
  running: number;
  cost_usd: number;
  failed_cost_usd: number;
  basis_exact: number;
  basis_computed: number;
  basis_estimated: number;
  unpriced: number;
  credits_charged: number;
  credits_refunded: number;
  paid_net: number;
}

const EMPTY_AGG: AggRow = {
  jobs: 0, completed: 0, failed: 0, running: 0, cost_usd: 0, failed_cost_usd: 0,
  basis_exact: 0, basis_computed: 0, basis_estimated: 0, unpriced: 0,
  credits_charged: 0, credits_refunded: 0, paid_net: 0,
};

function addAgg(a: AggRow, b: AggRow): AggRow {
  const out = { ...a };
  for (const k of Object.keys(EMPTY_AGG) as Array<keyof AggRow>) out[k] = Number(a[k]) + Number(b[k]);
  return out;
}

export function toTotals(r: AggRow, cash: CashTotals | null): CostTotals {
  const costUsd = round2(Number(r.cost_usd));
  const creditsNet = r.credits_charged - r.credits_refunded;
  const value = creditValueUsd(r.paid_net);
  return {
    jobs: r.jobs,
    completed: r.completed,
    failed: r.failed,
    running: r.running,
    costUsd,
    failedCostUsd: round2(Number(r.failed_cost_usd)),
    basis: { exact: r.basis_exact, computed: r.basis_computed, estimated: r.basis_estimated, unpriced: r.unpriced },
    creditsCharged: r.credits_charged,
    creditsRefunded: r.credits_refunded,
    creditsNet,
    paidCreditsNet: r.paid_net,
    promoCreditsNet: creditsNet - r.paid_net,
    creditValueUsd: value,
    profitUsd: round2(value - costUsd),
    marginPct: marginPct(value, costUsd),
    cash,
    cashProfitUsd: cash ? round2(cash.netCents / 100 - costUsd) : null,
  };
}

/** Dubai-local bucket key for a timestamptz column. */
function bucketKeyOf(column: SQL, bucket: AnalyticsBucket): SQL {
  return sql`to_char(date_trunc(${bucket}, ${column} AT TIME ZONE ${ANALYTICS_TIMEZONE}), 'YYYY-MM-DD')`;
}

// ─── Series ───────────────────────────────────────────────────────────

export async function costSeries(
  db: Db,
  range: AnalyticsRange,
  bucket: AnalyticsBucket,
  f: JobFilters,
): Promise<{ byBucket: Map<string, AggRow>; total: AggRow }> {
  const rows = rowsOf<AggRow & { bucket: string }>(
    await db.execute(sql`
      ${withJobs(range, f)}
      SELECT ${bucketKeyOf(sql`j.created_at`, bucket)} AS bucket, ${AGGREGATES}
      FROM j LEFT JOIN c ON c.job_id = j.id
      GROUP BY 1
      ORDER BY 1`),
  );
  const byBucket = new Map<string, AggRow>();
  let total = EMPTY_AGG;
  for (const r of rows) {
    byBucket.set(r.bucket, r);
    total = addAgg(total, r);
  }
  return { byBucket, total };
}

export { EMPTY_AGG, type AggRow };

interface CashRow {
  bucket: string;
  count: number;
  gross_cents: number;
  refunded_cents: number;
  subscription_cents: number;
  pack_cents: number;
}

function toCash(r: CashRow | undefined): CashTotals {
  if (!r) return { count: 0, grossCents: 0, refundedCents: 0, netCents: 0, subscriptionCents: 0, packCents: 0 };
  return {
    count: r.count,
    grossCents: r.gross_cents,
    refundedCents: r.refunded_cents,
    netCents: r.gross_cents - r.refunded_cents,
    subscriptionCents: r.subscription_cents,
    packCents: r.pack_cents,
  };
}

function addCash(a: CashTotals, b: CashTotals): CashTotals {
  return {
    count: a.count + b.count,
    grossCents: a.grossCents + b.grossCents,
    refundedCents: a.refundedCents + b.refundedCents,
    netCents: a.netCents + b.netCents,
    subscriptionCents: a.subscriptionCents + b.subscriptionCents,
    packCents: a.packCents + b.packCents,
  };
}

/** Payments by the Dubai day they happened, optionally one user's. Refunds reduce the row they belong to. */
export async function cashSeries(
  db: Db,
  range: AnalyticsRange,
  bucket: AnalyticsBucket,
  userId?: string,
): Promise<{ byBucket: Map<string, CashTotals>; total: CashTotals }> {
  const userClause = userId ? sql` AND p.user_id = ${userId}::uuid` : sql``;
  const rows = rowsOf<CashRow>(
    await db.execute(sql`
      SELECT
        ${bucketKeyOf(sql`p.occurred_at`, bucket)} AS bucket,
        COUNT(*)::int AS count,
        COALESCE(SUM(p.amount_cents), 0)::int AS gross_cents,
        COALESCE(SUM(p.amount_refunded_cents), 0)::int AS refunded_cents,
        COALESCE(SUM(p.amount_cents - p.amount_refunded_cents) FILTER (WHERE p.kind = 'subscription'), 0)::int AS subscription_cents,
        COALESCE(SUM(p.amount_cents - p.amount_refunded_cents) FILTER (WHERE p.kind = 'pack'), 0)::int AS pack_cents
      FROM payments p
      WHERE p.occurred_at >= ${range.fromUtc} AND p.occurred_at < ${range.toUtc}${userClause}
      GROUP BY 1
      ORDER BY 1`),
  );
  const byBucket = new Map<string, CashTotals>();
  let total = toCash(undefined);
  for (const r of rows) {
    const cash = toCash(r);
    byBucket.set(r.bucket, cash);
    total = addCash(total, cash);
  }
  return { byBucket, total };
}

// ─── Provider invoices vs computed ────────────────────────────────────

/**
 * One row per provider-month the range touches: what the rate card says
 * we spent (all jobs, unfiltered — an invoice is for everything) next to
 * the invoice total an admin typed in, when there is one.
 */
export async function invoiceComparison(db: Db, range: AnalyticsRange, months: string[]): Promise<ProviderInvoiceRow[]> {
  if (months.length === 0) return [];
  const firstMonth = `${months[0]}-01`;
  const lastMonth = `${months[months.length - 1]}-01`;
  const [computed, typed] = await Promise.all([
    db.execute(sql`
      SELECT j.provider, to_char(date_trunc('month', j.created_at AT TIME ZONE ${ANALYTICS_TIMEZONE}), 'YYYY-MM') AS month,
             COALESCE(SUM(j.provider_cost_usd), 0)::float8 AS computed_usd, COUNT(*)::int AS jobs
      FROM jobs j
      WHERE j.provider IS NOT NULL
        AND j.created_at >= ${range.fromUtc} AND j.created_at < ${range.toUtc}
      GROUP BY 1, 2`),
    db.execute(sql`
      SELECT id, provider, to_char(month, 'YYYY-MM') AS month, amount_usd::float8 AS billed_usd, note, updated_at
      FROM provider_invoices
      WHERE month >= ${firstMonth}::date AND month <= ${lastMonth}::date`),
  ]);
  const byKey = new Map<string, ProviderInvoiceRow>();
  const keyOf = (provider: string, month: string) => `${provider}|${month}`;
  for (const r of rowsOf<{ provider: string; month: string; computed_usd: number; jobs: number }>(computed)) {
    byKey.set(keyOf(r.provider, r.month), {
      id: null, provider: r.provider, month: r.month, billedUsd: null,
      computedUsd: round2(Number(r.computed_usd)), jobs: r.jobs, note: null, updatedAt: null,
    });
  }
  for (const r of rowsOf<{ id: string; provider: string; month: string; billed_usd: number; note: string | null; updated_at: string | Date }>(typed)) {
    const k = keyOf(r.provider, r.month);
    const base = byKey.get(k) ?? { id: null, provider: r.provider, month: r.month, billedUsd: null, computedUsd: 0, jobs: 0, note: null, updatedAt: null };
    byKey.set(k, {
      ...base,
      id: r.id,
      billedUsd: round2(Number(r.billed_usd)),
      note: r.note,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : new Date(r.updated_at).toISOString(),
    });
  }
  return [...byKey.values()].sort((a, b) => (a.month === b.month ? a.provider.localeCompare(b.provider) : a.month < b.month ? 1 : -1));
}

// ─── Breakdown ────────────────────────────────────────────────────────

interface BreakdownRaw extends AggRow {
  key: string | null;
  label: string | null;
  sublabel: string | null;
  cash_net_cents: number | null;
}

export async function costBreakdown(
  db: Db,
  range: AnalyticsRange,
  f: JobFilters,
  dim: AnalyticsDimension,
  limit: number,
): Promise<CostBreakdownRow[]> {
  // Each dimension names its key, how to label it, and any extra join.
  const spec: Record<AnalyticsDimension, { key: SQL; label: SQL; sublabel: SQL; cash: SQL; from: SQL; where: SQL }> = {
    model: {
      key: sql`j.model_key`,
      label: sql`(SELECT pm.display_name FROM provider_models pm WHERE pm.model_key = j.model_key LIMIT 1)`,
      sublabel: sql`MIN(j.provider)`,
      cash: sql`NULL::int`,
      from: sql``,
      where: sql``,
    },
    provider: { key: sql`j.provider`, label: sql`NULL::text`, sublabel: sql`NULL::text`, cash: sql`NULL::int`, from: sql``, where: sql`` },
    origin: { key: sql`j.origin`, label: sql`NULL::text`, sublabel: sql`NULL::text`, cash: sql`NULL::int`, from: sql``, where: sql`` },
    user: {
      key: sql`u.id::text`,
      label: sql`u.email`,
      sublabel: sql`u.name`,
      cash: sql`(SELECT COALESCE(SUM(p.amount_cents - p.amount_refunded_cents), 0)::int FROM payments p
                 WHERE p.user_id = u.id AND p.occurred_at >= ${range.fromUtc} AND p.occurred_at < ${range.toUtc})`,
      from: sql`JOIN users u ON u.id = j.user_id`,
      where: sql``,
    },
    template: {
      key: sql`t.id::text`,
      label: sql`t.title`,
      sublabel: sql`NULL::text`,
      cash: sql`NULL::int`,
      from: sql`JOIN templates t ON t.id = j.template_id`,
      where: sql`WHERE j.template_id IS NOT NULL`,
    },
  };
  const s = spec[dim];
  // Label/sublabel/cash are functionally dependent on the key but Postgres
  // wants them aggregated or grouped; MIN() over a constant-per-group is the
  // cheapest way to say "take the one value".
  const rows = rowsOf<BreakdownRaw>(
    await db.execute(sql`
      ${withJobs(range, f)}
      SELECT ${s.key} AS key, MIN(${s.label}) AS label, ${dim === 'model' ? s.sublabel : sql`MIN(${s.sublabel})`} AS sublabel,
             MIN(${s.cash}) AS cash_net_cents, ${AGGREGATES}
      FROM j LEFT JOIN c ON c.job_id = j.id ${s.from}
      ${s.where}
      GROUP BY ${s.key}
      ORDER BY cost_usd DESC, jobs DESC
      LIMIT ${limit}`),
  );
  return rows.map((r) => {
    const t = toTotals(r, null);
    const key = r.key ?? 'unknown';
    return {
      key,
      label: r.label ?? key,
      sublabel: r.sublabel,
      jobs: t.jobs,
      completed: t.completed,
      failed: t.failed,
      costUsd: t.costUsd,
      failedCostUsd: t.failedCostUsd,
      avgCostUsd: t.jobs ? Math.round((t.costUsd / t.jobs) * 10000) / 10000 : 0,
      creditsNet: t.creditsNet,
      paidCreditsNet: t.paidCreditsNet,
      creditValueUsd: t.creditValueUsd,
      profitUsd: t.profitUsd,
      marginPct: t.marginPct,
      cashNetCents: dim === 'user' ? Number(r.cash_net_cents ?? 0) : null,
    };
  });
}

// ─── Job drill-down ───────────────────────────────────────────────────

interface JobRaw {
  id: string;
  created_at: string | Date;
  completed_at: string | Date | null;
  status: AnalyticsJobRow['status'];
  origin: AnalyticsJobRow['origin'];
  provider: string | null;
  model_key: string | null;
  model_name: string | null;
  template_id: string | null;
  template_title: string | null;
  user_id: string;
  email: string;
  user_name: string | null;
  mode: string | null;
  duration_seconds: number | null;
  charged: number;
  refunded: number;
  paid_net: number;
  cost_usd: number | null;
  cost_basis: AnalyticsJobRow['costBasis'];
  provider_billed_units: AnalyticsJobRow['billedUnits'];
  provider_request_ids: string[] | null;
  error_code: string | null;
}

const iso = (v: string | Date | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

function toJobRow(r: JobRaw): AnalyticsJobRow {
  const paid = Number(r.paid_net);
  const value = creditValueUsd(paid);
  const cost = r.cost_usd == null ? null : Number(r.cost_usd);
  return {
    id: r.id,
    createdAt: iso(r.created_at)!,
    completedAt: iso(r.completed_at),
    status: r.status,
    origin: r.origin,
    provider: r.provider,
    modelKey: r.model_key,
    modelName: r.model_name,
    templateId: r.template_id,
    templateTitle: r.template_title,
    user: { id: r.user_id, email: r.email, name: r.user_name },
    mode: r.mode,
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    creditsCharged: Number(r.charged),
    creditsRefunded: Number(r.refunded),
    creditsNet: Number(r.charged) - Number(r.refunded),
    paidCreditsNet: paid,
    creditValueUsd: value,
    providerCostUsd: cost,
    costBasis: r.cost_basis,
    profitUsd: cost == null ? null : round2(value - cost),
    billedUnits: r.provider_billed_units,
    requestIds: r.provider_request_ids,
    errorCode: r.error_code,
  };
}

const JOB_COLUMNS = sql`
  j.id, j.created_at, j.completed_at, j.status, j.origin, j.provider, j.model_key,
  (SELECT pm.display_name FROM provider_models pm WHERE pm.model_key = j.model_key LIMIT 1) AS model_name,
  j.template_id, t.title AS template_title,
  u.id AS user_id, u.email, u.name AS user_name,
  COALESCE(j.options->>'mode', j.provider_billed_units->0->>'mode') AS mode,
  COALESCE((j.options->>'duration')::float8, (j.options->>'sourceSeconds')::float8) AS duration_seconds,
  COALESCE(c.charged, 0) AS charged, COALESCE(c.refunded, 0) AS refunded,
  COALESCE(c.paid_charged, 0) - COALESCE(c.paid_refunded, 0) AS paid_net,
  j.cost_usd, j.cost_basis, j.provider_billed_units, j.provider_request_ids,
  j.error->>'code' AS error_code`;

const JOB_JOINS = sql`
  FROM j
  LEFT JOIN c ON c.job_id = j.id
  JOIN users u ON u.id = j.user_id
  LEFT JOIN templates t ON t.id = j.template_id`;

export interface JobListOptions {
  /** Case-insensitive match on the user's email. */
  search?: string;
  /** `<createdAtMs>:<id>` from the previous page. */
  cursor?: string;
  limit: number;
}

export async function listJobs(
  db: Db,
  range: AnalyticsRange,
  f: JobFilters,
  opts: JobListOptions,
): Promise<{ rows: AnalyticsJobRow[]; nextCursor: string | null; total: number | null }> {
  const where: SQL[] = [];
  if (opts.search) where.push(sql`u.email ILIKE ${`%${opts.search}%`}`);
  if (opts.cursor) {
    const [msRaw, id] = opts.cursor.split(':');
    const ms = Number.parseInt(msRaw ?? '', 10);
    if (Number.isFinite(ms) && id) where.push(sql`(j.created_at, j.id::text) < (to_timestamp(${ms / 1000}), ${id})`);
  }
  const whereSql = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
  const raw = rowsOf<JobRaw>(
    await db.execute(sql`
      ${withJobs(range, f)}
      SELECT ${JOB_COLUMNS} ${JOB_JOINS}
      ${whereSql}
      ORDER BY j.created_at DESC, j.id DESC
      LIMIT ${opts.limit + 1}`),
  );
  const hasMore = raw.length > opts.limit;
  const page = hasMore ? raw.slice(0, opts.limit) : raw;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${new Date(last.created_at).getTime()}:${last.id}` : null;

  let total: number | null = null;
  if (!opts.cursor) {
    const searchSql = opts.search ? sql`WHERE u.email ILIKE ${`%${opts.search}%`}` : sql``;
    const [row] = rowsOf<{ n: number }>(
      await db.execute(sql`
        ${withJobs(range, f)}
        SELECT COUNT(*)::int AS n FROM j JOIN users u ON u.id = j.user_id ${searchSql}`),
    );
    total = row?.n ?? 0;
  }
  return { rows: page.map(toJobRow), nextCursor, total };
}

/** Every matching job, newest first, for the CSV export. `limit + 1` rows signal truncation. */
export async function exportJobs(db: Db, range: AnalyticsRange, f: JobFilters, limit: number): Promise<{ rows: AnalyticsJobRow[]; truncated: boolean }> {
  const raw = rowsOf<JobRaw>(
    await db.execute(sql`
      ${withJobs(range, f)}
      SELECT ${JOB_COLUMNS} ${JOB_JOINS}
      ORDER BY j.created_at DESC, j.id DESC
      LIMIT ${limit + 1}`),
  );
  return { rows: raw.slice(0, limit).map(toJobRow), truncated: raw.length > limit };
}

// ─── One job, in full ─────────────────────────────────────────────────

/** Trigger.dev project the jobs worker deploys to (see apps/jobs-worker/trigger.config.ts). Not a secret. */
const TRIGGER_PROJECT_REF = 'proj_dqwnwsfyhccgrtzxoqbt';

interface JobDetailRaw extends JobRaw {
  source: 'template' | 'user';
  template_version_id: string | null;
  project_id: string | null;
  entitlement: string;
  started_at: string | Date | null;
  trigger_run_id: string | null;
  idempotency_key: string | null;
  progress: AnalyticsJobDetail['progress'];
  error: AnalyticsJobDetail['error'];
  options: Record<string, unknown> | null;
  inputs: Record<string, { kind: string; r2Key?: string; mimeType?: string; sizeBytes?: number; value?: string }> | null;
  result: {
    images?: Array<{ r2Key: string; width?: number; height?: number }>;
    videos?: Array<{ streamId: string; posterR2Key?: string | null; durationSec?: number; width?: number; height?: number }>;
    durationMs?: number;
    providerTaskId?: string;
  } | null;
  snapshot: { generation?: { stages?: Array<{ provider: string; model: string; config?: Record<string, unknown> }> } } | null;
}

/**
 * Everything the admin needs to answer "what happened to this run": the
 * row, the media (as URLs the admin's browser can load), the template's
 * stage list at the version that ran, and every ledger movement.
 */
export async function jobDetail(db: Db, id: string, origin: string, assetUrl: (origin: string, key: string) => string): Promise<AnalyticsJobDetail | null> {
  const [raw] = rowsOf<JobDetailRaw>(
    await db.execute(sql`
      WITH j AS (
        SELECT
          j.id, j.user_id, j.status::text AS status, j.origin, j.source, j.provider, j.created_at, j.started_at, j.completed_at,
          j.template_id, j.template_version_id, j.project_id, j.options, j.inputs, j.result, j.error, j.progress,
          j.trigger_run_id, j.idempotency_key, j.provider_billed_units, j.provider_request_ids, j.cost_basis,
          ${MODEL_KEY} AS model_key,
          j.provider_cost_usd::float8 AS cost_usd
        FROM jobs j
        WHERE j.id = ${id}::uuid
      ),
      c AS (
        SELECT
          l.job_id,
          COALESCE(SUM(CASE WHEN l.reason = 'job_charge' THEN -l.delta END), 0)::int AS charged,
          COALESCE(SUM(CASE WHEN l.reason = 'refund' THEN l.delta END), 0)::int AS refunded,
          COALESCE(SUM(CASE WHEN l.reason = 'job_charge' THEN
            CASE WHEN l.metadata ? 'fromPromo'
                 THEN COALESCE((l.metadata->>'fromSubscription')::int, 0) + COALESCE((l.metadata->>'fromTopup')::int, 0)
                 WHEN l.bucket IN ('subscription', 'topup') THEN -l.delta ELSE 0 END END), 0)::int AS paid_charged,
          COALESCE(SUM(CASE WHEN l.reason = 'refund' THEN
            CASE WHEN l.metadata ? 'rSub'
                 THEN COALESCE((l.metadata->>'rSub')::int, 0) + COALESCE((l.metadata->>'rTopup')::int, 0)
                 WHEN l.bucket IN ('subscription', 'topup') THEN l.delta ELSE 0 END END), 0)::int AS paid_refunded
        FROM credit_ledger l JOIN j ON j.id = l.job_id
        GROUP BY l.job_id
      )
      SELECT ${JOB_COLUMNS},
             j.source, j.template_version_id, j.project_id, u.entitlement, j.started_at, j.trigger_run_id, j.idempotency_key,
             j.progress, j.error, j.options, j.inputs, j.result,
             tv.snapshot
      ${JOB_JOINS}
      LEFT JOIN template_versions tv ON tv.id = j.template_version_id`),
  );
  if (!raw) return null;

  const ledger = rowsOf<{ id: string; reason: string; delta: number; bucket: string | null; balance_after: number; note: string | null; metadata: Record<string, unknown>; created_at: string | Date }>(
    await db.execute(sql`
      SELECT id, reason::text AS reason, delta, bucket, balance_after, note, metadata, created_at
      FROM credit_ledger WHERE job_id = ${id}::uuid ORDER BY created_at ASC`),
  );

  const base = toJobRow(raw);
  const createdMs = new Date(raw.created_at).getTime();
  const startedMs = raw.started_at ? new Date(raw.started_at).getTime() : null;
  const completedMs = raw.completed_at ? new Date(raw.completed_at).getTime() : null;

  const inputs: AnalyticsJobDetail['inputs'] = Object.entries(raw.inputs ?? {}).map(([key, v]) =>
    v.kind === 'text'
      ? { key, kind: 'text' as const, value: v.value ?? '' }
      : { key, kind: v.kind as 'image' | 'video' | 'audio', url: assetUrl(origin, v.r2Key ?? ''), mimeType: v.mimeType ?? '', sizeBytes: v.sizeBytes ?? 0 },
  );
  const outputs: AnalyticsJobDetail['outputs'] = [
    ...(raw.result?.images ?? []).map((img) => ({ kind: 'image' as const, url: assetUrl(origin, img.r2Key), width: img.width ?? null, height: img.height ?? null })),
    ...(raw.result?.videos ?? []).map((v) => ({
      kind: 'video' as const,
      url: assetUrl(origin, v.streamId),
      posterUrl: v.posterR2Key ? assetUrl(origin, v.posterR2Key) : null,
      durationSec: v.durationSec ?? null,
      width: v.width ?? null,
      height: v.height ?? null,
    })),
  ];
  const stages = raw.snapshot?.generation?.stages?.map((s, i) => ({ stage: i + 1, provider: s.provider, model: s.model, config: s.config ?? {} })) ?? null;

  return {
    ...base,
    source: raw.source,
    templateVersionId: raw.template_version_id,
    projectId: raw.project_id,
    userEntitlement: raw.entitlement,
    startedAt: iso(raw.started_at),
    queueMs: startedMs != null ? startedMs - createdMs : null,
    runMs: startedMs != null && completedMs != null ? completedMs - startedMs : null,
    triggerRunId: raw.trigger_run_id,
    triggerRunUrl: raw.trigger_run_id ? `https://cloud.trigger.dev/projects/v3/${TRIGGER_PROJECT_REF}/runs/${raw.trigger_run_id}` : null,
    idempotencyKey: raw.idempotency_key,
    progress: raw.progress ?? null,
    error: raw.error ?? null,
    options: raw.options ?? {},
    inputs,
    outputs,
    resultDurationMs: raw.result?.durationMs ?? null,
    providerTaskId: raw.result?.providerTaskId ?? null,
    stages,
    ledger: ledger.map((l) => ({
      id: l.id, reason: l.reason, delta: l.delta, bucket: l.bucket, balanceAfter: l.balance_after, note: l.note,
      metadata: l.metadata ?? {}, createdAt: iso(l.created_at)!,
    })),
  };
}
