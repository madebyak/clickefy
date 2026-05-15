'use client';

/**
 * Jobs & Runs — global generation queue / history view.
 *
 * MOCK DATA today. The shape of `mockJobs` matches the future
 * `GET /v1/admin/jobs` response so swapping to a real fetch is
 * mechanical:
 *
 *   const { data } = useQuery({
 *     queryKey: ['admin', 'jobs', filters],
 *     queryFn:  () => apiFetch<AdminJobListResponse>('/v1/admin/jobs?...', { tokenGetter }),
 *     refetchInterval: 5_000,
 *   });
 *
 * Backed by the `jobs` table in `packages/db/src/schema/jobs.ts` plus
 * a join on `users` and `templates`. The Trigger.dev run id and
 * progress columns already exist on the row.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  Loader2,
  MoreVertical,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

type AdminJobListItem = {
  id: string;
  user: { id: string; email: string; name: string | null };
  template: { id: string; title: string };
  status: JobStatus;
  progress: { stage: string; percent: number } | null;
  provider: 'gemini' | 'kling' | 'mixed';
  costCredits: number;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
  error: { code: string; message: string } | null;
};

// MOCK DATA — replace with real API. Shapes mirror DB columns.
const mockJobs: AdminJobListItem[] = [
  {
    id: 'job_01HXY8ZAB12C3D4E',
    user: { id: 'usr_a1', email: 'sara@example.com', name: 'Sara Khalil' },
    template: { id: 'tpl_product_lifestyle', title: 'Product Lifestyle Shot' },
    status: 'completed',
    progress: { stage: 'render', percent: 100 },
    provider: 'gemini',
    costCredits: 4,
    durationMs: 12_400,
    createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
    completedAt: new Date(Date.now() - 1000 * 60 * 3 + 12_400).toISOString(),
    error: null,
  },
  {
    id: 'job_01HXY8ZAB99XYZ12',
    user: { id: 'usr_b2', email: 'omar@studio.io', name: 'Omar Al-Hassan' },
    template: { id: 'tpl_video_promo_15s', title: 'Promo Video — 15s' },
    status: 'processing',
    progress: { stage: 'kling-render', percent: 62 },
    provider: 'kling',
    costCredits: 25,
    durationMs: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 1.5).toISOString(),
    completedAt: null,
    error: null,
  },
  {
    id: 'job_01HXY8ZAC4QQ77LL',
    user: { id: 'usr_c3', email: 'nadia@brand.co', name: 'Nadia Rahman' },
    template: { id: 'tpl_logo_animation', title: 'Logo Animation' },
    status: 'queued',
    progress: null,
    provider: 'mixed',
    costCredits: 18,
    durationMs: null,
    createdAt: new Date(Date.now() - 1000 * 30).toISOString(),
    completedAt: null,
    error: null,
  },
  {
    id: 'job_01HXY8Z9PP002233',
    user: { id: 'usr_d4', email: 'mike.t@gmail.com', name: null },
    template: { id: 'tpl_thumbnail', title: 'YouTube Thumbnail' },
    status: 'failed',
    progress: { stage: 'gemini-image', percent: 40 },
    provider: 'gemini',
    costCredits: 0,
    durationMs: 4_800,
    createdAt: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    completedAt: new Date(Date.now() - 1000 * 60 * 22 + 4_800).toISOString(),
    error: {
      code: 'PROVIDER_TIMEOUT',
      message: 'Gemini request timed out after 30s. Retried 1× — refunded.',
    },
  },
  {
    id: 'job_01HXY8Z8AA887766',
    user: { id: 'usr_e5', email: 'lina@creative.studio', name: 'Lina Costa' },
    template: { id: 'tpl_product_lifestyle', title: 'Product Lifestyle Shot' },
    status: 'completed',
    progress: { stage: 'render', percent: 100 },
    provider: 'gemini',
    costCredits: 4,
    durationMs: 9_100,
    createdAt: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
    completedAt: new Date(Date.now() - 1000 * 60 * 47 + 9_100).toISOString(),
    error: null,
  },
  {
    id: 'job_01HXY8Z700ABCDEF',
    user: { id: 'usr_f6', email: 'team@agency.dev', name: 'Agency Test' },
    template: { id: 'tpl_video_promo_15s', title: 'Promo Video — 15s' },
    status: 'completed',
    progress: { stage: 'render', percent: 100 },
    provider: 'kling',
    costCredits: 25,
    durationMs: 78_300,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    completedAt: new Date(
      Date.now() - 1000 * 60 * 60 * 2 + 78_300,
    ).toISOString(),
    error: null,
  },
  {
    id: 'job_01HXY8Z610FAILED1',
    user: { id: 'usr_g7', email: 'free.user@gmail.com', name: null },
    template: { id: 'tpl_logo_animation', title: 'Logo Animation' },
    status: 'failed',
    progress: { stage: 'kling-render', percent: 80 },
    provider: 'kling',
    costCredits: 0,
    durationMs: 65_200,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    completedAt: new Date(
      Date.now() - 1000 * 60 * 60 * 5 + 65_200,
    ).toISOString(),
    error: {
      code: 'KLING_QUOTA_EXCEEDED',
      message: 'Provider quota exceeded — refunded user credits.',
    },
  },
];

const STATUS_META: Record<
  JobStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: typeof Clock }
> = {
  queued: { label: 'Queued', variant: 'outline', icon: Clock },
  processing: { label: 'Processing', variant: 'secondary', icon: Loader2 },
  completed: { label: 'Completed', variant: 'default', icon: CheckCircle2 },
  failed: { label: 'Failed', variant: 'destructive', icon: XCircle },
};

function shortId(id: string) {
  return id.slice(-8);
}

function initials(name: string | null, email: string) {
  const source = (name ?? email).trim();
  if (!source) return '?';
  const parts = source.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function formatDuration(ms: number | null) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

export default function JobsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
  const [providerFilter, setProviderFilter] = useState<'all' | 'gemini' | 'kling' | 'mixed'>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mockJobs.filter((j) => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false;
      if (providerFilter !== 'all' && j.provider !== providerFilter) return false;
      if (!q) return true;
      return (
        j.id.toLowerCase().includes(q) ||
        j.user.email.toLowerCase().includes(q) ||
        (j.user.name?.toLowerCase().includes(q) ?? false) ||
        j.template.title.toLowerCase().includes(q)
      );
    });
  }, [search, statusFilter, providerFilter]);

  const counts = useMemo(() => {
    const acc: Record<JobStatus, number> = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };
    for (const j of mockJobs) acc[j.status] += 1;
    return acc;
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs & Runs</h1>
          <p className="text-muted-foreground mt-1">
            Live view of every generation job — queued, running, completed and failed.
          </p>
        </div>
        <Button variant="outline" disabled>
          <RefreshCw className="h-4 w-4 mr-2" />
          Auto-refresh: 5s
        </Button>
      </div>

      {/* Status pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(Object.keys(STATUS_META) as JobStatus[]).map((s) => {
          const meta = STATUS_META[s];
          const Icon = meta.icon;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
              className={`flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 ${
                statusFilter === s ? 'border-primary ring-1 ring-primary/30' : 'border-border'
              }`}
            >
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {meta.label}
                </div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{counts[s]}</div>
              </div>
              <Icon
                className={`h-5 w-5 ${
                  s === 'completed'
                    ? 'text-primary-green'
                    : s === 'failed'
                      ? 'text-destructive'
                      : s === 'processing'
                        ? 'text-primary-purple animate-spin'
                        : 'text-muted-foreground'
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by job id, user email, name or template…"
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as JobStatus | 'all')}
        >
          <SelectTrigger className="md:w-44">
            <Filter className="h-4 w-4 mr-2" />
            {/* Base UI <SelectValue> renders the raw value; map to label here. */}
            <SelectValue placeholder="Status">
              {(val) =>
                ({
                  all: 'All statuses',
                  queued: 'Queued',
                  processing: 'Processing',
                  completed: 'Completed',
                  failed: 'Failed',
                } as const)[val as JobStatus | 'all'] ?? 'Status'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={providerFilter}
          onValueChange={(v) =>
            setProviderFilter(v as 'all' | 'gemini' | 'kling' | 'mixed')
          }
        >
          <SelectTrigger className="md:w-44">
            <SelectValue placeholder="Provider">
              {(val) =>
                ({
                  all: 'All providers',
                  gemini: 'Gemini',
                  kling: 'Kling',
                  mixed: 'Mixed (multi-stage)',
                } as const)[val as 'all' | 'gemini' | 'kling' | 'mixed'] ??
                'Provider'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            <SelectItem value="gemini">Gemini</SelectItem>
            <SelectItem value="kling">Kling</SelectItem>
            <SelectItem value="mixed">Mixed (multi-stage)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">No jobs match your filters</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((job) => {
                const meta = STATUS_META[job.status];
                const StatusIcon = meta.icon;
                return (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="font-mono text-xs">{shortId(job.id)}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {job.provider}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar size="sm">
                          <AvatarFallback>
                            {initials(job.user.name, job.user.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {job.user.name ?? (
                              <span className="text-muted-foreground">(no name)</span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {job.user.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{job.template.title}</TableCell>
                    <TableCell>
                      <Badge variant={meta.variant} className="gap-1">
                        <StatusIcon
                          className={`h-3 w-3 ${
                            job.status === 'processing' ? 'animate-spin' : ''
                          }`}
                        />
                        {meta.label}
                      </Badge>
                      {job.error && (
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-destructive">
                          {job.error.code}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {job.progress ? (
                        <div className="w-32">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="truncate">{job.progress.stage}</span>
                            <span className="tabular-nums">{job.progress.percent}%</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full transition-all ${
                                job.status === 'failed'
                                  ? 'bg-destructive'
                                  : job.status === 'completed'
                                    ? 'bg-primary-green'
                                    : 'bg-primary-purple'
                              }`}
                              style={{ width: `${job.progress.percent}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {job.costCredits > 0 ? job.costCredits : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {formatDuration(job.durationMs)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelative(job.createdAt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-xs" />}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled>View details</DropdownMenuItem>
                          <DropdownMenuItem disabled>Open Trigger run</DropdownMenuItem>
                          {job.status === 'failed' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem disabled>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Retry job
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Showing mock data. Hook up to <code className="rounded bg-muted px-1 py-0.5">GET /v1/admin/jobs</code> when the
        endpoint lands — see <code className="rounded bg-muted px-1 py-0.5">apps/api/src/routes/jobs.ts</code>.
      </p>
    </div>
  );
}
