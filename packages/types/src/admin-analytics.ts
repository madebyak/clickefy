/**
 * Cost & profit analytics — the contract between
 * `apps/api/src/routes/admin-analytics.ts` and the admin dashboard, plus
 * the date arithmetic both sides agree on.
 *
 * TIME
 *   Every period is a calendar period in Dubai (UTC+4, no daylight
 *   saving — founder's decision 2026-10-04). `from` / `to` travel as
 *   `YYYY-MM-DD` and mean "that whole day in Dubai"; bucket keys are the
 *   Dubai date the bucket starts on. The API converts to UTC instants
 *   once, here, so no query ever guesses an offset.
 *
 * MONEY
 *   Three numbers sit side by side and are never mixed:
 *     cost          dollars we paid providers (`jobs.provider_cost_usd`)
 *     credit value  the PAID credits a job consumed × $0.10 — promo
 *                   credits are excluded because nobody paid for them
 *     cash          dollars customers actually paid us (`payments`),
 *                   net of refunds, attributed to the day they paid
 *   Profit on the dashboard = credit value − cost. Cash − cost is shown
 *   next to it as a cross-check, never as the headline.
 */

import type { CostBasis } from './provider-cost';
import type { JobOrigin } from './json-types';

/** What one credit sells for. The house price book (2026-09-17) prices every tier from this. */
export const CREDIT_VALUE_USD = 0.1;

export const ANALYTICS_TIMEZONE = 'Asia/Dubai';
/** Dubai is UTC+4 all year. */
export const ANALYTICS_UTC_OFFSET_HOURS = 4;

export type AnalyticsBucket = 'day' | 'week' | 'month';
export const ANALYTICS_BUCKETS: readonly AnalyticsBucket[] = ['day', 'week', 'month'] as const;

export type AnalyticsDimension = 'model' | 'provider' | 'user' | 'origin' | 'template';
export const ANALYTICS_DIMENSIONS: readonly AnalyticsDimension[] = ['model', 'provider', 'user', 'origin', 'template'] as const;

/** Filters every analytics endpoint accepts. Jobs are attributed to the day they were created. */
export interface AnalyticsFilters {
  /** YYYY-MM-DD, inclusive, Dubai. */
  from: string;
  /** YYYY-MM-DD, inclusive, Dubai. */
  to: string;
  model?: string;
  provider?: string;
  userId?: string;
  origin?: JobOrigin;
  status?: 'completed' | 'failed';
  basis?: CostBasis;
}

export interface CashTotals {
  count: number;
  grossCents: number;
  refundedCents: number;
  netCents: number;
  subscriptionCents: number;
  packCents: number;
}

export interface CostTotals {
  jobs: number;
  completed: number;
  failed: number;
  running: number;
  /** Everything we paid providers, including failed jobs they billed. */
  costUsd: number;
  /** The part of `costUsd` spent on jobs that failed. */
  failedCostUsd: number;
  basis: { exact: number; computed: number; estimated: number; unpriced: number };
  creditsCharged: number;
  creditsRefunded: number;
  /** charged − refunded */
  creditsNet: number;
  /** Net credits that came from subscription or top-up lots. */
  paidCreditsNet: number;
  /** Net credits that came from the promo bucket (welcome, refresh, grants). */
  promoCreditsNet: number;
  /** paidCreditsNet × CREDIT_VALUE_USD */
  creditValueUsd: number;
  /** creditValueUsd − costUsd */
  profitUsd: number;
  /** profitUsd / creditValueUsd, null when no paid credits were consumed. */
  marginPct: number | null;
  /** Null when a model / provider / origin / status / basis filter is set — cash is not per model. */
  cash: CashTotals | null;
  /** cash.netCents / 100 − costUsd, null when `cash` is null. */
  cashProfitUsd: number | null;
}

export interface CostSeriesPoint extends CostTotals {
  /** Dubai date the bucket starts on, YYYY-MM-DD. */
  bucket: string;
}

export interface ProviderInvoiceRow {
  /** Null when no invoice has been typed in for this provider-month yet. */
  id: string | null;
  provider: string;
  /** YYYY-MM */
  month: string;
  billedUsd: number | null;
  /** Sum of `jobs.provider_cost_usd` for that provider in that Dubai month. */
  computedUsd: number;
  jobs: number;
  note: string | null;
  updatedAt: string | null;
}

export interface CostsResponse {
  range: { from: string; to: string; bucket: AnalyticsBucket; timezone: string };
  filters: Omit<AnalyticsFilters, 'from' | 'to'>;
  totals: CostTotals;
  series: CostSeriesPoint[];
  /** One row per provider-month touched by the range. */
  invoices: ProviderInvoiceRow[];
  generatedAt: string;
}

export interface CostBreakdownRow {
  key: string;
  label: string;
  sublabel: string | null;
  jobs: number;
  completed: number;
  failed: number;
  costUsd: number;
  failedCostUsd: number;
  avgCostUsd: number;
  creditsNet: number;
  paidCreditsNet: number;
  creditValueUsd: number;
  profitUsd: number;
  marginPct: number | null;
  /** Only for `dim=user`: what this user paid us in the range, net of refunds. */
  cashNetCents: number | null;
}

export interface CostBreakdownResponse {
  dim: AnalyticsDimension;
  range: { from: string; to: string; timezone: string };
  rows: CostBreakdownRow[];
  generatedAt: string;
}

export interface AnalyticsJobRow {
  id: string;
  createdAt: string;
  completedAt: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  origin: JobOrigin;
  provider: string | null;
  modelKey: string | null;
  modelName: string | null;
  templateId: string | null;
  templateTitle: string | null;
  user: { id: string; email: string; name: string | null };
  mode: string | null;
  durationSeconds: number | null;
  creditsCharged: number;
  creditsRefunded: number;
  creditsNet: number;
  paidCreditsNet: number;
  creditValueUsd: number;
  providerCostUsd: number | null;
  costBasis: CostBasis | null;
  /** creditValueUsd − providerCostUsd (null while unpriced). */
  profitUsd: number | null;
  billedUnits: Array<{ stage: number; model: string; unit: string; quantity: number; unitPriceUsd: number; usd: number; mode: string | null; basis: CostBasis; note?: string }> | null;
  requestIds: string[] | null;
  errorCode: string | null;
}

/** One generation, everything the row and its ledger know. `GET /jobs/:id`. */
export interface AnalyticsJobDetail extends AnalyticsJobRow {
  source: 'template' | 'user';
  templateVersionId: string | null;
  projectId: string | null;
  userEntitlement: string;
  startedAt: string | null;
  /** created → started, ms. */
  queueMs: number | null;
  /** started → completed, ms. */
  runMs: number | null;
  triggerRunId: string | null;
  /** Trigger.dev dashboard page for the run, when we know the run id. */
  triggerRunUrl: string | null;
  idempotencyKey: string | null;
  progress: { stage: number; totalStages: number; message: string } | null;
  /** The raw error object, including the provider's verbatim `detail`. */
  error: { code: string; message: string; stage: number; retryCount: number; reason?: string; detail?: string } | null;
  /** `jobs.options` as stored. */
  options: Record<string, unknown>;
  inputs: Array<
    | { key: string; kind: 'text'; value: string }
    | { key: string; kind: 'image' | 'video' | 'audio'; url: string; mimeType: string; sizeBytes: number }
  >;
  outputs: Array<
    | { kind: 'image'; url: string; width: number | null; height: number | null }
    | { kind: 'video'; url: string; posterUrl: string | null; durationSec: number | null; width: number | null; height: number | null }
  >;
  resultDurationMs: number | null;
  providerTaskId: string | null;
  /** The template's pipeline at the version this job ran, when it was a template job. */
  stages: Array<{ stage: number; provider: string; model: string; config: Record<string, unknown> }> | null;
  /** Every ledger row that names this job, oldest first. */
  ledger: Array<{ id: string; reason: string; delta: number; bucket: string | null; balanceAfter: number; note: string | null; metadata: Record<string, unknown>; createdAt: string }>;
}

export interface AnalyticsJobsResponse {
  data: AnalyticsJobRow[];
  nextCursor: string | null;
  /** Only on the first page. */
  total: number | null;
}

// ─── Date arithmetic ──────────────────────────────────────────────────

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const YM = /^(\d{4})-(\d{2})$/;

export function isYmd(s: string): boolean {
  const m = YMD.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** A Dubai calendar date as a UTC-midnight Date — a number line for day arithmetic, not an instant. */
function ymdToDay(s: string): Date {
  const m = YMD.exec(s)!;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function dayToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The UTC instant at which the Dubai day `ymd` begins. */
export function dubaiDayStartUtc(ymd: string): Date {
  return new Date(ymdToDay(ymd).getTime() - ANALYTICS_UTC_OFFSET_HOURS * 3600_000);
}

/** The Dubai calendar date of a UTC instant. */
export function dubaiDateOf(instant: Date): string {
  return dayToYmd(new Date(instant.getTime() + ANALYTICS_UTC_OFFSET_HOURS * 3600_000));
}

export interface AnalyticsRange {
  from: string;
  to: string;
  /** Inclusive start, UTC. */
  fromUtc: Date;
  /** Exclusive end, UTC. */
  toUtc: Date;
}

/** Longest range one request may ask for. */
export const ANALYTICS_MAX_RANGE_DAYS = 400;

/**
 * Resolve the `from` / `to` query params. Defaults to the last 30 Dubai
 * days ending today. Throws on malformed dates, an inverted range or a
 * range longer than `ANALYTICS_MAX_RANGE_DAYS`.
 */
export function parseAnalyticsRange(from: string | undefined, to: string | undefined, now: Date = new Date()): AnalyticsRange {
  const today = dubaiDateOf(now);
  const toYmd = to ?? today;
  if (!isYmd(toYmd)) throw new RangeError(`to: expected YYYY-MM-DD, got "${toYmd}"`);
  const fromYmd = from ?? dayToYmd(new Date(ymdToDay(toYmd).getTime() - 29 * 86400_000));
  if (!isYmd(fromYmd)) throw new RangeError(`from: expected YYYY-MM-DD, got "${fromYmd}"`);
  const days = (ymdToDay(toYmd).getTime() - ymdToDay(fromYmd).getTime()) / 86400_000 + 1;
  if (days < 1) throw new RangeError('from must not be after to');
  if (days > ANALYTICS_MAX_RANGE_DAYS) throw new RangeError(`range longer than ${ANALYTICS_MAX_RANGE_DAYS} days`);
  return {
    from: fromYmd,
    to: toYmd,
    fromUtc: dubaiDayStartUtc(fromYmd),
    toUtc: dubaiDayStartUtc(dayToYmd(new Date(ymdToDay(toYmd).getTime() + 86400_000))),
  };
}

/** `YYYY-MM` → the range covering that whole Dubai month. */
export function monthRange(month: string): AnalyticsRange {
  const m = YM.exec(month);
  if (!m) throw new RangeError(`month: expected YYYY-MM, got "${month}"`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new RangeError(`month: "${month}" is not a calendar month`);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const last = new Date(Date.UTC(y, mo, 0));
  return parseAnalyticsRange(dayToYmd(first), dayToYmd(last), last);
}

/** Start of the bucket a Dubai date falls in: the day itself, its Monday, or the 1st of its month. */
export function bucketStart(ymd: string, bucket: AnalyticsBucket): string {
  const d = ymdToDay(ymd);
  if (bucket === 'day') return ymd;
  if (bucket === 'week') {
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0, matching Postgres date_trunc('week')
    return dayToYmd(new Date(d.getTime() - dow * 86400_000));
  }
  return dayToYmd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/**
 * Every bucket key the range touches, in order, so a series can be
 * zero-filled; a day with no jobs still gets a point.
 */
export function bucketKeys(range: Pick<AnalyticsRange, 'from' | 'to'>, bucket: AnalyticsBucket): string[] {
  const keys: string[] = [];
  let cur = ymdToDay(bucketStart(range.from, bucket));
  const end = ymdToDay(range.to).getTime();
  while (cur.getTime() <= end) {
    keys.push(dayToYmd(cur));
    cur = bucket === 'day'
      ? new Date(cur.getTime() + 86400_000)
      : bucket === 'week'
        ? new Date(cur.getTime() + 7 * 86400_000)
        : new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return keys;
}

/** Months (YYYY-MM) the range touches, in order. */
export function monthKeys(range: Pick<AnalyticsRange, 'from' | 'to'>): string[] {
  return bucketKeys(range, 'month').map((k) => k.slice(0, 7));
}

// ─── Derived numbers ──────────────────────────────────────────────────

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function creditValueUsd(paidCredits: number): number {
  return round2(paidCredits * CREDIT_VALUE_USD);
}

export function marginPct(valueUsd: number, costUsd: number): number | null {
  if (valueUsd <= 0) return null;
  return Math.round(((valueUsd - costUsd) / valueUsd) * 1000) / 10;
}

// ─── CSV ──────────────────────────────────────────────────────────────

/** One CSV record, RFC 4180 quoting; `null` / `undefined` become empty cells. */
export function csvRow(values: ReadonlyArray<string | number | boolean | null | undefined>): string {
  return values
    .map((v) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}
