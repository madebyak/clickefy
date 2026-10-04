/**
 * Number and date formatting for the cost dashboard. Everything money is
 * USD; everything time is Dubai, matching the API (`@clickfy/types`).
 */

import { ANALYTICS_TIMEZONE, dubaiDateOf } from '@clickfy/types';

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const usdFmt0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const intFmt = new Intl.NumberFormat('en-US');

export function usd(n: number | null | undefined, opts: { whole?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return (opts.whole ? usdFmt0 : usdFmt).format(n);
}

export function cents(c: number | null | undefined): string {
  return c == null ? '—' : usd(c / 100);
}

export function int(n: number | null | undefined): string {
  return n == null ? '—' : intFmt.format(n);
}

export function pct(p: number | null | undefined, digits = 1): string {
  return p == null || !Number.isFinite(p) ? '—' : `${p.toFixed(digits)}%`;
}

/** Signed, for profit cells. */
export function signedUsd(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n < 0 ? '−' : ''}${usd(Math.abs(n))}`;
}

const dubaiDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: ANALYTICS_TIMEZONE,
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});
const dubaiDate = new Intl.DateTimeFormat('en-GB', { timeZone: ANALYTICS_TIMEZONE, day: '2-digit', month: 'short', year: 'numeric' });

export function dubaiDateTimeLabel(iso: string): string {
  return dubaiDateTime.format(new Date(iso));
}

/** A `YYYY-MM-DD` bucket key → "4 Oct", "Oct 2026", or "w/c 28 Sep". */
export function bucketLabel(key: string, bucket: 'day' | 'week' | 'month'): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  if (bucket === 'month') return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dm = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return bucket === 'week' ? `w/c ${dm}` : dm;
}

export function ymdLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return dubaiDate.format(new Date(Date.UTC(y!, m! - 1, d!, 12)));
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ─── Range presets ──────────────────────────────────────────────────

export type RangePreset = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | '90d' | 'custom';

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
  lastMonth: 'Last month',
  '90d': 'Last 90 days',
  custom: 'Custom',
};

function shift(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now = new Date()): { from: string; to: string } {
  const today = dubaiDateOf(now);
  const [y, m] = today.split('-').map(Number);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case '7d': return { from: shift(today, -6), to: today };
    case '30d': return { from: shift(today, -29), to: today };
    case '90d': return { from: shift(today, -89), to: today };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const first = new Date(Date.UTC(y!, m! - 2, 1));
      const last = new Date(Date.UTC(y!, m! - 1, 0));
      return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
    }
  }
}

/** Which preset a from/to pair is, for the picker's label. */
export function presetOf(from: string, to: string, now = new Date()): RangePreset {
  for (const p of ['today', '7d', '30d', 'month', 'lastMonth', '90d'] as const) {
    const r = presetRange(p, now);
    if (r.from === from && r.to === to) return p;
  }
  return 'custom';
}

/** Tailwind classes for a margin cell: the house floor is 33%. */
export function marginTone(margin: number | null): string {
  if (margin == null) return 'text-muted-foreground';
  if (margin >= 33) return 'text-primary-green';
  if (margin >= 0) return 'text-warning';
  return 'text-destructive';
}
