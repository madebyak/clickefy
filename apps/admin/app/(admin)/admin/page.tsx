'use client';

/**
 * Admin dashboard.
 *
 * Live data from `GET /v1/admin/stats/overview`. React Query polls
 * every 30s; the API caps client cache at the same window, so the
 * dashboard always shows fresh-ish numbers without hammering Postgres.
 *
 * Layout is intentionally top-down by urgency:
 *   1. Live ops strip — turns warning/destructive when something
 *      actually needs attention right now.
 *   2. Last-24h KPI cards with vs-prior-24h deltas.
 *   3. Catalog + user pulse row.
 *   4. Quick actions (kept from the original page).
 *   5. Recent activity feed (replaces the old empty-state).
 */

import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  Coins,
  Flag,
  FolderTree,
  Loader2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchAdminStatsOverview,
  type ActivityItem,
  type ActivityType,
  type AdminStatsOverview,
  type Delta,
} from '@/lib/api/admin-stats';

const POLL_MS = 30_000;
/** Threshold above which the Queued pill turns warning. Mirrors the
 *  jobs-worker recover cron interval (every minute). */
const QUEUED_AGE_WARN_SEC = 30;
/** Stuck jobs are >10min in `processing`. Cron fails them at 600s. */
const STUCK_JOB_VISIBLE_FROM = 1;

export default function DashboardPage() {
  const { getToken } = useAuth();

  const { data, isLoading, error, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['admin', 'stats', 'overview'],
    queryFn: () => fetchAdminStatsOverview(() => getToken()),
    refetchInterval: POLL_MS,
    staleTime: POLL_MS,
  });

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Live snapshot of the platform — last 24 hours unless noted.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
          {dataUpdatedAt > 0 && (
            <span>Updated {formatAge(Date.now() - dataUpdatedAt)} ago</span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load stats: {error instanceof Error ? error.message : 'unknown error'}
        </div>
      )}

      {/* ── Live ops strip ─────────────────────────────────────────── */}
      <LiveStrip data={data} loading={isLoading} />

      {/* ── Last 24h KPI cards ────────────────────────────────────── */}
      <KpiGrid data={data} loading={isLoading} />

      {/* ── Catalog + users pulse ──────────────────────────────────── */}
      <PulseRow data={data} loading={isLoading} />

      {/* ── Quick actions (unchanged) ─────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {QUICK_ACTIONS.map((a) => (
            <Link key={a.label} href={a.href}>
              <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                <CardContent className="pt-6">
                  <a.icon className="h-8 w-8 text-primary mb-3" />
                  <p className="font-medium">{a.label}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Activity feed ─────────────────────────────────────────── */}
      <ActivityFeed data={data} loading={isLoading} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Live ops strip — 4 status pills.
// ──────────────────────────────────────────────────────────────────

function LiveStrip({
  data,
  loading,
}: {
  data: AdminStatsOverview | undefined;
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px]" />
        ))}
      </div>
    );
  }

  const { live } = data;

  const queuedAge = live.queuedOldestAgeSec ?? 0;
  const queuedWarn = queuedAge > QUEUED_AGE_WARN_SEC;
  const stuckWarn = live.stuckJobs >= STUCK_JOB_VISIBLE_FROM;
  const failedWarn = live.failedLastHour > 0;
  const reportsWarn = live.openReports > 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatusPill
        label="Processing now"
        value={live.jobsProcessing}
        icon={Loader2}
        spinIcon={live.jobsProcessing > 0}
        tone="neutral"
        hint={
          stuckWarn
            ? `${live.stuckJobs} stuck >10min`
            : 'Jobs being generated right now'
        }
        emphasizeWarn={stuckWarn}
        href="/admin/jobs"
      />
      <StatusPill
        label="Queued"
        value={live.jobsQueued}
        icon={Clock}
        tone={queuedWarn ? 'warn' : 'neutral'}
        hint={
          live.jobsQueued > 0
            ? `Oldest waiting ${formatAgeSec(queuedAge)}`
            : 'Queue is empty'
        }
        href="/admin/jobs"
      />
      <StatusPill
        label="Failed last hour"
        value={live.failedLastHour}
        icon={XCircle}
        tone={failedWarn ? 'destructive' : 'neutral'}
        hint={
          live.topErrorCodes.length > 0
            ? `Top: ${live.topErrorCodes[0].code} (${live.topErrorCodes[0].count})`
            : `${live.failedLast24h} in last 24h`
        }
        href="/admin/jobs"
      />
      <StatusPill
        label="Open reports"
        value={live.openReports}
        icon={Flag}
        tone={reportsWarn ? 'warn' : 'neutral'}
        hint={
          live.openReportsOldestAgeHr != null
            ? `Oldest ${live.openReportsOldestAgeHr.toFixed(0)}h waiting`
            : 'Nothing pending'
        }
        href="/admin/reports"
      />
    </div>
  );
}

function StatusPill({
  label,
  value,
  icon: Icon,
  spinIcon,
  tone,
  hint,
  emphasizeWarn,
  href,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  spinIcon?: boolean;
  tone: 'neutral' | 'warn' | 'destructive';
  hint: string;
  emphasizeWarn?: boolean;
  href: string;
}) {
  const toneClass =
    tone === 'destructive'
      ? 'border-destructive/40 bg-destructive/5'
      : tone === 'warn'
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'border-border bg-card';
  const iconClass =
    tone === 'destructive'
      ? 'text-destructive'
      : tone === 'warn'
        ? 'text-amber-500'
        : 'text-muted-foreground';

  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors hover:border-primary/50 ${toneClass}`}
    >
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums">{value}</span>
          {emphasizeWarn && <Badge variant="destructive">stuck</Badge>}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      </div>
      <Icon className={`h-5 w-5 ${iconClass} ${spinIcon ? 'animate-spin' : ''}`} />
    </Link>
  );
}

// ──────────────────────────────────────────────────────────────────
// Last-24h KPI cards.
// ──────────────────────────────────────────────────────────────────

function KpiGrid({
  data,
  loading,
}: {
  data: AdminStatsOverview | undefined;
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[110px]" />
        ))}
      </div>
    );
  }

  const cards: Array<{
    label: string;
    delta: Delta;
    icon: LucideIcon;
    accent: string;
    formatter?: (n: number) => string;
    suffix?: string;
  }> = [
    {
      label: 'Generations',
      delta: data.today.generations,
      icon: Zap,
      accent: 'text-primary-purple',
    },
    {
      label: 'Success rate',
      delta: data.today.successRatePct,
      icon: TrendingUp,
      accent: 'text-primary-green',
      formatter: (n) => n.toFixed(1),
      suffix: '%',
    },
    {
      label: 'Active users',
      delta: data.today.activeUsers,
      icon: Users,
      accent: 'text-primary-purple',
    },
    {
      label: 'Credits spent',
      delta: data.today.creditsSpent,
      icon: Coins,
      accent: 'text-primary-green',
    },
    {
      label: 'New signups',
      delta: data.today.newSignups,
      icon: Sparkles,
      accent: 'text-primary-purple',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map((c) => (
        <KpiCard key={c.label} {...c} />
      ))}
    </div>
  );
}

function KpiCard({
  label,
  delta,
  icon: Icon,
  accent,
  formatter,
  suffix,
}: {
  label: string;
  delta: Delta;
  icon: LucideIcon;
  accent: string;
  formatter?: (n: number) => string;
  suffix?: string;
}) {
  const display = formatter
    ? formatter(delta.value)
    : delta.value.toLocaleString();
  const positive = (delta.deltaPct ?? 0) >= 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardDescription className="text-sm font-medium">
          {label}
        </CardDescription>
        <Icon className={`h-4 w-4 ${accent}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${accent}`}>
          {display}
          {suffix}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs">
          {delta.deltaPct == null ? (
            <span className="text-muted-foreground">no prior data</span>
          ) : (
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
              {Math.abs(delta.deltaPct).toFixed(1)}%
            </span>
          )}
          <span className="text-muted-foreground">vs prior 24h</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────
// Catalog + users pulse.
// ──────────────────────────────────────────────────────────────────

function PulseRow({
  data,
  loading,
}: {
  data: AdminStatsOverview | undefined;
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-[180px]" />
        <Skeleton className="h-[180px]" />
      </div>
    );
  }

  const { catalog, users } = data;
  const publishedPct =
    catalog.templatesTotal > 0
      ? (catalog.templatesPublished / catalog.templatesTotal) * 100
      : 0;
  const paidPct =
    users.total > 0 ? (users.paid / users.total) * 100 : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardDescription className="text-sm font-medium">
            Catalog
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Total" value={catalog.templatesTotal} />
            <Stat
              label="Published"
              value={catalog.templatesPublished}
              hint={`${publishedPct.toFixed(0)}%`}
              accent="text-primary-green"
            />
            <Stat
              label="Drafts"
              value={catalog.templatesDraft}
              accent="text-muted-foreground"
            />
          </div>
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-sm">
            {catalog.topTemplate24h ? (
              <>
                <div className="text-xs text-muted-foreground">
                  Top template (24h)
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <Link
                    href={`/admin/templates/${catalog.topTemplate24h.id}`}
                    className="truncate font-medium hover:underline"
                  >
                    {catalog.topTemplate24h.title}
                  </Link>
                  <Badge variant="secondary" className="font-mono">
                    {catalog.topTemplate24h.runs} runs
                  </Badge>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">
                No completed jobs in the last 24h.
              </div>
            )}
          </div>
          {catalog.categoriesEmpty > 0 && (
            <Link
              href="/admin/categories"
              className="flex items-center justify-between rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm hover:bg-amber-500/10"
            >
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                {catalog.categoriesEmpty}{' '}
                {catalog.categoriesEmpty === 1 ? 'category has' : 'categories have'}{' '}
                no published templates
              </span>
              <span className="text-xs text-muted-foreground">Review</span>
            </Link>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription className="text-sm font-medium">
            Users
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total" value={users.total} />
            <Stat
              label="Paid"
              value={users.paid}
              hint={`${paidPct.toFixed(0)}%`}
              accent="text-primary-purple"
            />
            <Stat label="Power (30d ≥10 jobs)" value={users.powerUsers30d} />
            <Stat
              label="Renewing next 7d"
              value={users.renewingNext7d}
              accent="text-primary-green"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Power users submit 10+ jobs in the last 30 days. Renewals are based
            on the RevenueCat subscription window mirrored on{' '}
            <code className="rounded bg-muted px-1 py-0.5">
              users.subscription_renews_at
            </code>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  accent?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-xl font-bold tabular-nums ${accent ?? 'text-foreground'}`}
      >
        {value.toLocaleString()}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Activity feed.
// ──────────────────────────────────────────────────────────────────

const ACTIVITY_META: Record<
  ActivityType,
  { icon: LucideIcon; accent: string }
> = {
  signup: { icon: Sparkles, accent: 'text-primary-purple' },
  job_failed: { icon: XCircle, accent: 'text-destructive' },
  report_opened: { icon: Flag, accent: 'text-amber-500' },
  template_published: { icon: CheckCircle2, accent: 'text-primary-green' },
  credit_grant: { icon: Coins, accent: 'text-primary-green' },
  admin_action: { icon: ShieldCheck, accent: 'text-muted-foreground' },
};

function ActivityFeed({
  data,
  loading,
}: {
  data: AdminStatsOverview | undefined;
  loading: boolean;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Recent activity</h2>
      <Card>
        <CardContent className="py-3">
          {loading || !data ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : data.activity.length === 0 ? (
            <div className="py-9 text-center">
              <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Nothing has happened recently.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.activity.map((item, i) => (
                <ActivityRow key={`${item.type}-${item.at}-${i}`} item={item} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const meta = ACTIVITY_META[item.type];
  const Icon = meta.icon;
  return (
    <li>
      <Link
        href={item.href}
        className="flex items-center gap-3 py-2.5 px-1 hover:bg-muted/40 rounded-md transition-colors"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
          <Icon className={`h-4 w-4 ${meta.accent}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium">{item.title}</div>
          {item.subtitle && (
            <div className="truncate text-xs text-muted-foreground">
              {item.subtitle}
            </div>
          )}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {formatAge(Date.now() - new Date(item.at).getTime())} ago
        </div>
      </Link>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────
// Quick actions — same set as before, plus Reports.
// ──────────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Create Template', href: '/admin/templates/new', icon: Sparkles },
  { label: 'View Templates', href: '/admin/templates', icon: ClipboardList },
  { label: 'Manage Categories', href: '/admin/categories', icon: FolderTree },
  { label: 'View Jobs', href: '/admin/jobs', icon: Activity },
] as const;

// ──────────────────────────────────────────────────────────────────
// Time-format helpers.
// ──────────────────────────────────────────────────────────────────

function formatAge(ms: number): string {
  if (ms < 0) return '0s';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function formatAgeSec(sec: number): string {
  return formatAge(sec * 1000);
}
