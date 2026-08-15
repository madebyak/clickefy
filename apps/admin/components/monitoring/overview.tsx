'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  FileStack,
  Minus,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { AdminRole, MonitoringAdminMetric, MonitoringSummary } from '@clickfy/types';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * A vibrant, on-brand palette drawn from the design-system chart tokens
 * (plus two complementary hues). Red (`--chart-4`) is intentionally
 * skipped so an admin's bar never reads as an error state.
 */
const PALETTE = [
  'var(--chart-1)', // purple
  'var(--chart-5)', // cyan
  'var(--chart-2)', // green
  'var(--chart-3)', // amber
  '#ec4899', // pink
  '#3b82f6', // blue
  '#a855f7', // violet
  '#14b8a6', // teal
];

const ROLE_LABELS: Record<AdminRole, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  creator: 'Creator',
};

// ─── Animated count-up ──────────────────────────────────────────────

function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    const from = prev.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else prev.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

function CountUp({ value, className }: { value: number; className?: string }) {
  const display = useCountUp(value);
  return <span className={className}>{display.toLocaleString()}</span>;
}

// ─── Delta badge (period-over-period) ───────────────────────────────

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function DeltaBadge({ current, previous, label }: { current: number; previous: number; label: string }) {
  const pct = pctChange(current, previous);
  const up = pct !== null && pct > 0;
  const down = pct !== null && pct < 0;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        up && 'text-success',
        down && 'text-destructive',
        !up && !down && 'text-muted-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {pct === null ? 'new' : `${pct > 0 ? '+' : ''}${pct}%`}
      <span className="font-normal text-muted-foreground">{label}</span>
    </span>
  );
}

// ─── KPI stat card ──────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  delta,
}: {
  title: string;
  value: number;
  icon: LucideIcon;
  color: string;
  delta?: { current: number; previous: number; label: string };
}) {
  return (
    <Card className="relative overflow-hidden p-5">
      {/* Soft color glow accent */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          <CountUp value={value} className="font-heading text-3xl font-bold tracking-tight" />
          {delta && <div><DeltaBadge {...delta} /></div>}
        </div>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)`, color }}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

// ─── Animated horizontal bar chart ──────────────────────────────────

interface BarRow {
  id: string;
  label: string;
  sublabel: string;
  role: AdminRole | null;
  value: number;
  last7d: number;
  prev7d: number;
  color: string;
}

function PublishesByAdmin({ rows }: { rows: BarRow[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className="space-y-4">
      {rows.map((r, i) => {
        const pct = (r.value / max) * 100;
        const wow = pctChange(r.last7d, r.prev7d);
        return (
          <div key={r.id} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                <span className="truncate font-medium">{r.label}</span>
                {r.role && (
                  <Badge variant="secondary" className="hidden sm:inline-flex">
                    {ROLE_LABELS[r.role]}
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {wow !== null && (
                  <span
                    className={cn(
                      'hidden items-center gap-0.5 text-xs sm:inline-flex',
                      wow > 0 ? 'text-success' : wow < 0 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {wow > 0 ? <ArrowUpRight className="h-3 w-3" /> : wow < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
                    {wow > 0 ? '+' : ''}
                    {wow}% wk
                  </span>
                )}
                <span className="w-10 text-right font-heading font-semibold tabular-nums">{r.value}</span>
              </div>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: mounted ? `${pct}%` : '0%',
                  backgroundColor: r.color,
                  transition: 'width 800ms cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDelay: `${i * 80}ms`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Animated donut (share of publishes) ────────────────────────────

function ShareDonut({ rows }: { rows: BarRow[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const total = rows.reduce((acc, r) => acc + r.value, 0);
  const R = 56;
  const STROKE = 18;
  const C = 2 * Math.PI * R;

  // Each arc starts where the previous one ended, so the offset is the
  // running total of the fractions before it. Built with a reduce rather
  // than a counter mutated inside map(): the lint rule is right that
  // mutating across a render pass is unsound, and the accumulator is the
  // honest way to express "offset depends on everything prior".
  const segments = rows.reduce<
    { color: string; len: number; offset: number; frac: number }[]
  >((acc, r) => {
    const frac = total > 0 ? r.value / total : 0;
    const prior = acc.length > 0 ? acc[acc.length - 1]! : undefined;
    const offset = prior ? prior.offset + prior.frac * C : 0;
    acc.push({ color: r.color, len: frac * C, offset, frac });
    return acc;
  }, []);

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--muted)" strokeWidth={STROKE} />
          {segments.map((s, i) => (
            <circle
              key={i}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              strokeLinecap="butt"
              strokeDasharray={mounted ? `${s.len} ${C - s.len}` : `0 ${C}`}
              strokeDashoffset={-s.offset}
              style={{
                transition: 'stroke-dasharray 900ms cubic-bezier(0.22, 1, 0.36, 1)',
                transitionDelay: `${i * 90}ms`,
              }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <CountUp value={total} className="font-heading text-2xl font-bold leading-none" />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">publishes</span>
        </div>
      </div>

      <ul className="w-full space-y-1.5">
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.value / total) * 100) : 0;
          return (
            <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                <span className="truncate">{r.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Overview tab ───────────────────────────────────────────────────

export function MonitoringOverview({
  metrics,
  summary,
}: {
  metrics: MonitoringAdminMetric[];
  summary: MonitoringSummary;
}) {
  // Attributed admins only, ranked by total, top 8 for the visuals.
  const rows: BarRow[] = useMemo(() => {
    return metrics
      .filter((m) => m.adminId !== null && m.total > 0)
      .slice(0, 8)
      .map((m, i) => ({
        id: m.adminId!,
        label: m.name ?? m.email ?? 'Unknown',
        sublabel: m.email ?? '',
        role: m.role,
        value: m.total,
        last7d: m.last7d,
        prev7d: m.prev7d,
        color: PALETTE[i % PALETTE.length],
      }));
  }, [metrics]);

  return (
    <div className="mt-4 space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Published templates"
          value={summary.publishedTemplates}
          icon={FileStack}
          color="var(--chart-1)"
        />
        <StatCard
          title="Published this week"
          value={summary.thisWeek}
          icon={TrendingUp}
          color="var(--chart-5)"
          delta={{ current: summary.thisWeek, previous: summary.lastWeek, label: 'vs last week' }}
        />
        <StatCard
          title="Published this month"
          value={summary.thisMonth}
          icon={CalendarDays}
          color="var(--chart-2)"
          delta={{ current: summary.thisMonth, previous: summary.lastMonth, label: 'vs last month' }}
        />
        <StatCard
          title="Active publishers"
          value={summary.activePublishers}
          icon={Users}
          color="var(--chart-3)"
        />
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No publishing activity yet.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-2">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-heading text-base font-semibold">Publishes by admin</h3>
              <span className="text-xs text-muted-foreground">all-time · weekly trend</span>
            </div>
            <PublishesByAdmin rows={rows} />
          </Card>

          <Card className="p-6">
            <h3 className="mb-5 font-heading text-base font-semibold">Share of publishes</h3>
            <ShareDonut rows={rows} />
          </Card>
        </div>
      )}
    </div>
  );
}
