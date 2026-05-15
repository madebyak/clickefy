'use client';

/**
 * Analytics — platform-wide usage and revenue dashboard.
 *
 * MOCK DATA today. The shape of `mockOverview` mirrors what
 * `GET /v1/admin/analytics/overview` will return. Recommended
 * window param: `?range=7d|30d|90d` (server uses Drizzle aggregates
 * over `jobs`, `users`, and `credit_ledger`).
 *
 *   const { data } = useQuery({
 *     queryKey: ['admin', 'analytics', range],
 *     queryFn:  () => apiFetch<AnalyticsOverview>(`/v1/admin/analytics/overview?range=${range}`, { tokenGetter }),
 *     staleTime: 60_000,
 *   });
 */

import { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  type LucideIcon,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Range = '7d' | '30d' | '90d';

type Kpi = {
  label: string;
  value: string;
  delta: number; // signed percent vs prior period
  icon: LucideIcon;
  accent: string;
  hint: string;
};

type SeriesPoint = { day: string; jobs: number; failed: number };
type TopTemplate = { id: string; title: string; runs: number; successRate: number };
type ProviderSplit = { provider: 'Gemini' | 'Kling'; jobs: number; share: number };

// MOCK DATA — replace with real API.
const mockOverview: Record<
  Range,
  {
    kpis: Kpi[];
    series: SeriesPoint[];
    topTemplates: TopTemplate[];
    providerSplit: ProviderSplit[];
    funnel: { label: string; value: number }[];
  }
> = {
  '7d': {
    kpis: [
      {
        label: 'Generations',
        value: '1,284',
        delta: 12.4,
        icon: Zap,
        accent: 'text-primary-purple',
        hint: 'vs prior 7 days',
      },
      {
        label: 'Success rate',
        value: '94.2%',
        delta: 1.1,
        icon: TrendingUp,
        accent: 'text-primary-green',
        hint: 'completed / (completed + failed)',
      },
      {
        label: 'Active users',
        value: '312',
        delta: -3.6,
        icon: Users,
        accent: 'text-primary-purple',
        hint: 'submitted ≥ 1 job',
      },
      {
        label: 'Credits spent',
        value: '14,720',
        delta: 8.2,
        icon: Coins,
        accent: 'text-primary-green',
        hint: 'sum of debits in ledger',
      },
    ],
    series: [
      { day: 'Mon', jobs: 152, failed: 8 },
      { day: 'Tue', jobs: 178, failed: 11 },
      { day: 'Wed', jobs: 201, failed: 9 },
      { day: 'Thu', jobs: 162, failed: 14 },
      { day: 'Fri', jobs: 220, failed: 12 },
      { day: 'Sat', jobs: 198, failed: 10 },
      { day: 'Sun', jobs: 173, failed: 6 },
    ],
    topTemplates: [
      { id: 'tpl_product_lifestyle', title: 'Product Lifestyle Shot', runs: 412, successRate: 96 },
      { id: 'tpl_video_promo_15s', title: 'Promo Video — 15s', runs: 287, successRate: 91 },
      { id: 'tpl_thumbnail', title: 'YouTube Thumbnail', runs: 224, successRate: 93 },
      { id: 'tpl_logo_animation', title: 'Logo Animation', runs: 168, successRate: 88 },
      { id: 'tpl_avatar_portrait', title: 'Pro Avatar Portrait', runs: 121, successRate: 97 },
    ],
    providerSplit: [
      { provider: 'Gemini', jobs: 871, share: 67.8 },
      { provider: 'Kling', jobs: 413, share: 32.2 },
    ],
    funnel: [
      { label: 'Opened template', value: 4_812 },
      { label: 'Filled inputs', value: 2_104 },
      { label: 'Submitted job', value: 1_284 },
      { label: 'Completed', value: 1_210 },
    ],
  },
  '30d': {
    kpis: [
      { label: 'Generations', value: '5,612', delta: 18.0, icon: Zap, accent: 'text-primary-purple', hint: 'vs prior 30 days' },
      { label: 'Success rate', value: '93.6%', delta: 0.4, icon: TrendingUp, accent: 'text-primary-green', hint: 'completed / total' },
      { label: 'Active users', value: '894', delta: 5.1, icon: Users, accent: 'text-primary-purple', hint: 'submitted ≥ 1 job' },
      { label: 'Credits spent', value: '64,330', delta: 22.4, icon: Coins, accent: 'text-primary-green', hint: 'sum of debits' },
    ],
    series: Array.from({ length: 14 }, (_, i) => ({
      day: `D${i + 1}`,
      jobs: 130 + Math.round(Math.sin(i / 2) * 40 + i * 4),
      failed: 5 + Math.round(Math.random() * 8),
    })),
    topTemplates: [
      { id: 'tpl_product_lifestyle', title: 'Product Lifestyle Shot', runs: 1_812, successRate: 95 },
      { id: 'tpl_video_promo_15s', title: 'Promo Video — 15s', runs: 1_204, successRate: 90 },
      { id: 'tpl_thumbnail', title: 'YouTube Thumbnail', runs: 982, successRate: 92 },
      { id: 'tpl_logo_animation', title: 'Logo Animation', runs: 711, successRate: 87 },
      { id: 'tpl_avatar_portrait', title: 'Pro Avatar Portrait', runs: 503, successRate: 96 },
    ],
    providerSplit: [
      { provider: 'Gemini', jobs: 3_810, share: 67.9 },
      { provider: 'Kling', jobs: 1_802, share: 32.1 },
    ],
    funnel: [
      { label: 'Opened template', value: 21_330 },
      { label: 'Filled inputs', value: 9_412 },
      { label: 'Submitted job', value: 5_612 },
      { label: 'Completed', value: 5_254 },
    ],
  },
  '90d': {
    kpis: [
      { label: 'Generations', value: '17,402', delta: 26.5, icon: Zap, accent: 'text-primary-purple', hint: 'vs prior 90 days' },
      { label: 'Success rate', value: '93.1%', delta: -0.2, icon: TrendingUp, accent: 'text-primary-green', hint: 'completed / total' },
      { label: 'Active users', value: '2,140', delta: 12.7, icon: Users, accent: 'text-primary-purple', hint: 'submitted ≥ 1 job' },
      { label: 'Credits spent', value: '198,704', delta: 31.2, icon: Coins, accent: 'text-primary-green', hint: 'sum of debits' },
    ],
    series: Array.from({ length: 14 }, (_, i) => ({
      day: `W${i + 1}`,
      jobs: 900 + Math.round(Math.cos(i / 3) * 200 + i * 25),
      failed: 30 + Math.round(Math.random() * 20),
    })),
    topTemplates: [
      { id: 'tpl_product_lifestyle', title: 'Product Lifestyle Shot', runs: 5_204, successRate: 94 },
      { id: 'tpl_video_promo_15s', title: 'Promo Video — 15s', runs: 3_811, successRate: 90 },
      { id: 'tpl_thumbnail', title: 'YouTube Thumbnail', runs: 2_980, successRate: 92 },
      { id: 'tpl_logo_animation', title: 'Logo Animation', runs: 2_311, successRate: 88 },
      { id: 'tpl_avatar_portrait', title: 'Pro Avatar Portrait', runs: 1_603, successRate: 96 },
    ],
    providerSplit: [
      { provider: 'Gemini', jobs: 11_790, share: 67.8 },
      { provider: 'Kling', jobs: 5_612, share: 32.2 },
    ],
    funnel: [
      { label: 'Opened template', value: 64_120 },
      { label: 'Filled inputs', value: 28_940 },
      { label: 'Submitted job', value: 17_402 },
      { label: 'Completed', value: 16_201 },
    ],
  },
};

const RANGE_LABELS: Record<Range, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>('7d');
  const data = mockOverview[range];

  const seriesMax = useMemo(
    () => Math.max(...data.series.map((p) => p.jobs)),
    [data.series],
  );
  const funnelMax = useMemo(
    () => Math.max(...data.funnel.map((f) => f.value)),
    [data.funnel],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Generation volume, success rate and user behaviour at a glance.
          </p>
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as Range)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Range">
              {(val) => RANGE_LABELS[val as Range] ?? 'Range'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {data.kpis.map((kpi) => {
          const Icon = kpi.icon;
          const positive = kpi.delta >= 0;
          return (
            <Card key={kpi.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardDescription className="text-sm font-medium">
                  {kpi.label}
                </CardDescription>
                <Icon className={`h-4 w-4 ${kpi.accent}`} />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${kpi.accent}`}>
                  {kpi.value}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs">
                  <span
                    className={`inline-flex items-center gap-0.5 font-medium ${
                      positive ? 'text-primary-green' : 'text-destructive'
                    }`}
                  >
                    {positive ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3" />
                    )}
                    {Math.abs(kpi.delta).toFixed(1)}%
                  </span>
                  <span className="text-muted-foreground">{kpi.hint}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Trend + provider split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardDescription className="text-sm font-medium">
              Generations over time
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1.5 h-40">
              {data.series.map((p) => {
                const h = (p.jobs / seriesMax) * 100;
                const failedH = (p.failed / seriesMax) * 100;
                return (
                  <div
                    key={p.day}
                    className="flex flex-1 flex-col items-center gap-1.5"
                  >
                    <div className="relative flex w-full flex-1 items-end justify-center">
                      <div
                        className="w-full rounded-t-md bg-primary-purple/30"
                        style={{ height: `${h}%` }}
                      />
                      <div
                        className="absolute bottom-0 w-full rounded-t-md bg-destructive/60"
                        style={{ height: `${failedH}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {p.day}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-primary-purple/60" />
                Total jobs
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-destructive/60" />
                Failed
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="text-sm font-medium">
              Provider split
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.providerSplit.map((p) => (
              <div key={p.provider}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{p.provider}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {p.jobs.toLocaleString()} · {p.share.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${
                      p.provider === 'Gemini'
                        ? 'bg-primary-purple'
                        : 'bg-primary-green'
                    }`}
                    style={{ width: `${p.share}%` }}
                  />
                </div>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">
              Multi-stage jobs (Gemini → Kling) count toward each provider they
              touch.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top templates + funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardDescription className="text-sm font-medium">
              Top templates
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.topTemplates.map((t, i) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-sm font-semibold tabular-nums">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.runs.toLocaleString()} runs
                  </div>
                </div>
                <Badge
                  variant={t.successRate >= 95 ? 'default' : 'secondary'}
                  className="font-mono"
                >
                  {t.successRate}%
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="text-sm font-medium">
              Generation funnel
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.funnel.map((step, i) => {
              const w = (step.value / funnelMax) * 100;
              const drop =
                i > 0
                  ? ((data.funnel[i - 1].value - step.value) /
                      data.funnel[i - 1].value) *
                    100
                  : 0;
              return (
                <div key={step.label}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{step.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {step.value.toLocaleString()}
                      {i > 0 && (
                        <span className="ml-2 text-destructive">
                          −{drop.toFixed(1)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary-purple/70"
                      style={{ width: `${w}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
        <Sparkles className="h-3 w-3" />
        Showing mock data. Hook up to <code className="rounded bg-muted px-1 py-0.5">GET /v1/admin/analytics/overview?range=…</code> when the
        endpoint lands.
      </p>
    </div>
  );
}
