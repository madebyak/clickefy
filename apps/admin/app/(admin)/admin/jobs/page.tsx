'use client';

/**
 * Jobs — every generation with what it cost us and what it earned.
 *
 * Backed by `/v1/admin/analytics/jobs` (cursor paginated) and the CSV
 * export. Filters live in the URL, so the Analytics breakdown can link
 * straight into "the Seedance jobs of this user last month".
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Download, Loader2, Search, XCircle, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

import type { AnalyticsJobRow } from '@clickfy/types';

import { RangePicker } from '@/components/analytics/range-picker';
import { useDashboardFilters, type DashboardFilters } from '@/components/analytics/use-filters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { downloadCsv, fetchAnalyticsJobs, jobsExportPath } from '@/lib/api/analytics';
import { dubaiDateTimeLabel, int, signedUsd, usd } from '@/lib/analytics-format';

const STATUS: Record<AnalyticsJobRow['status'], { label: string; icon: LucideIcon; className: string }> = {
  queued: { label: 'Queued', icon: Clock, className: 'text-muted-foreground' },
  processing: { label: 'Processing', icon: Loader2, className: 'text-primary-purple animate-spin' },
  completed: { label: 'Completed', icon: CheckCircle2, className: 'text-primary-green' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-destructive' },
};

const PROVIDERS: Record<string, string> = { all: 'All providers', gemini: 'Google', kling: 'Kling', seedance: 'BytePlus', openai: 'OpenAI', fal: 'fal.ai' };
const ORIGINS: Record<string, string> = { all: 'All origins', create: 'Create', template: 'Template', tool: 'Tool' };
const STATUSES: Record<string, string> = { all: 'All statuses', completed: 'Completed', failed: 'Failed' };
const BASES: Record<string, string> = { all: 'Any cost basis', exact: 'Exact', computed: 'Computed', estimated: 'Estimated' };

function FilterSelect({ value, options, onChange, width = 'md:w-40' }: { value: string | undefined; options: Record<string, string>; onChange: (v: string) => void; width?: string }) {
  return (
    <Select value={value ?? 'all'} onValueChange={(v) => onChange(v as string)}>
      <SelectTrigger className={width}><SelectValue>{(v) => options[v as string] ?? options.all}</SelectValue></SelectTrigger>
      <SelectContent>{Object.entries(options).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <JobsTable />
    </Suspense>
  );
}

function JobsTable() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);
  const [filters, setFilters] = useDashboardFilters();
  const { from, to, model, provider, userId, origin, status, basis, search } = filters;
  const q = { from, to, model, provider, userId, origin, status, basis, search };

  // Debounce the email search into the URL.
  const [searchDraft, setSearchDraft] = useState(search ?? '');
  useEffect(() => { setSearchDraft(search ?? ''); }, [search]);
  useEffect(() => {
    const t = setTimeout(() => { if ((searchDraft || undefined) !== search) setFilters({ search: searchDraft || undefined }); }, 350);
    return () => clearTimeout(t);
  }, [searchDraft, search, setFilters]);

  const query = useInfiniteQuery({
    queryKey: ['admin', 'analytics', 'jobs', q],
    queryFn: ({ pageParam }) => fetchAnalyticsJobs(tokenGetter, { ...q, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];
  const total = query.data?.pages[0]?.total ?? null;
  const [selected, setSelected] = useState<AnalyticsJobRow | null>(null);

  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    try { await downloadCsv(tokenGetter, jobsExportPath({ from, to, model, provider, userId, origin, status, basis })); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed'); }
    finally { setExporting(false); }
  }

  const pinned = Object.entries({ model, userId }).filter(([, v]) => v) as Array<[keyof DashboardFilters, string]>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
          <p className="mt-1 text-muted-foreground">Every generation with its credits, provider cost and profit. Dubai time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker from={from} to={to} onChange={(r) => setFilters(r)} />
          <Button variant="outline" onClick={exportCsv} disabled={exporting}>
            <Download className="mr-2 h-4 w-4" />{exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Search by user email…" className="pl-9" />
        </div>
        <FilterSelect value={status} options={STATUSES} onChange={(v) => setFilters({ status: v })} />
        <FilterSelect value={provider} options={PROVIDERS} onChange={(v) => setFilters({ provider: v })} />
        <FilterSelect value={origin} options={ORIGINS} onChange={(v) => setFilters({ origin: v })} />
        <FilterSelect value={basis} options={BASES} onChange={(v) => setFilters({ basis: v })} width="md:w-44" />
      </div>

      {pinned.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Also filtered by:</span>
          {pinned.map(([k, v]) => (
            <Badge key={k} variant="secondary" className="cursor-pointer gap-1 font-mono" onClick={() => setFilters({ [k]: undefined })} title="Remove filter">
              {k} = {v.length > 24 ? `${v.slice(0, 8)}…` : v} ×
            </Badge>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <span>{total != null ? `${int(total)} job${total === 1 ? '' : 's'} match` : 'Loading…'}</span>
          <span>Click a row for the cost breakdown</span>
        </div>
        {query.isLoading ? (
          <div className="space-y-2 p-6">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : query.error ? (
          <div className="p-6 text-sm text-destructive">{query.error instanceof Error ? query.error.message : 'Could not load jobs'}</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No jobs match these filters</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Settings</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((j) => {
                const s = STATUS[j.status];
                const Icon = s.icon;
                return (
                  <TableRow key={j.id} className="cursor-pointer" onClick={() => setSelected(j)}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dubaiDateTimeLabel(j.createdAt)}</TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="truncate text-sm">{j.user.email}</div>
                      {j.user.name && <div className="truncate text-xs text-muted-foreground">{j.user.name}</div>}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="truncate text-sm font-medium">{j.modelName ?? j.modelKey ?? j.templateTitle ?? '—'}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {j.origin}{j.provider ? ` · ${j.provider}` : ''}{j.templateTitle && j.modelName ? ` · ${j.templateTitle}` : ''}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 text-sm ${s.className}`}><Icon className="h-3.5 w-3.5" />{s.label}</span>
                      {j.errorCode && <div className="text-[10px] uppercase tracking-wide text-destructive">{j.errorCode}</div>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[j.mode, j.durationSeconds != null ? `${j.durationSeconds}s` : null].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="text-sm">{int(j.creditsNet)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {j.creditsRefunded > 0 ? `${j.creditsCharged} − ${j.creditsRefunded} refunded` : j.paidCreditsNet < j.creditsNet ? `${j.paidCreditsNet} paid · ${j.creditsNet - j.paidCreditsNet} promo` : 'paid'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="text-sm">{usd(j.providerCostUsd)}</div>
                      {j.costBasis && <div className="text-[10px] text-muted-foreground">{j.costBasis}</div>}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums text-sm font-medium ${j.profitUsd != null && j.profitUsd < 0 ? 'text-destructive' : ''}`}>
                      {signedUsd(j.profitUsd)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {query.hasNextPage && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="outline" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? 'Loading…' : `Load more (${int(rows.length)} of ${int(total)})`}
            </Button>
          </div>
        )}
      </div>

      <JobSheet job={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function JobSheet({ job, onClose }: { job: AnalyticsJobRow | null; onClose: () => void }) {
  return (
    <Sheet open={job != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {job && (
          <>
            <SheetHeader>
              <SheetTitle>{job.modelName ?? job.modelKey ?? job.templateTitle ?? 'Job'}</SheetTitle>
              <SheetDescription className="font-mono text-xs">{job.id}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Field label="User" value={job.user.email} />
                <Field label="Created" value={dubaiDateTimeLabel(job.createdAt)} />
                <Field label="Status" value={`${STATUS[job.status].label}${job.errorCode ? ` · ${job.errorCode}` : ''}`} />
                <Field label="Completed" value={job.completedAt ? dubaiDateTimeLabel(job.completedAt) : '—'} />
                <Field label="Origin" value={`${job.origin}${job.templateTitle ? ` · ${job.templateTitle}` : ''}`} />
                <Field label="Provider" value={job.provider ?? '—'} />
                <Field label="Mode" value={job.mode ?? '—'} />
                <Field label="Duration" value={job.durationSeconds != null ? `${job.durationSeconds} s` : '—'} />
              </dl>

              <div className="rounded-lg border border-border">
                <div className="grid grid-cols-3 divide-x divide-border text-center">
                  <Stat label="Credit value" value={usd(job.creditValueUsd)} sub={`${job.paidCreditsNet} paid of ${job.creditsNet} net`} />
                  <Stat label="Provider cost" value={usd(job.providerCostUsd)} sub={job.costBasis ?? 'unpriced'} />
                  <Stat label="Profit" value={signedUsd(job.profitUsd)} sub={job.creditsRefunded ? `${job.creditsRefunded} credits refunded` : ' '} tone={job.profitUsd != null && job.profitUsd < 0 ? 'text-destructive' : 'text-primary-green'} />
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">How the cost was reached</h3>
                {job.billedUnits && job.billedUnits.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Stage</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead className="text-right">Units</TableHead>
                        <TableHead className="text-right">Unit price</TableHead>
                        <TableHead className="text-right">USD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {job.billedUnits.map((u) => (
                        <TableRow key={u.stage}>
                          <TableCell>{u.stage}</TableCell>
                          <TableCell className="font-mono text-xs">{u.model}</TableCell>
                          <TableCell className="text-xs">{u.mode ?? '—'}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{int(u.quantity)} {u.unit}{u.quantity === 1 ? '' : 's'}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">${u.unitPriceUsd}</TableCell>
                          <TableCell className="text-right tabular-nums">{usd(u.usd)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-xs text-muted-foreground">No cost recorded for this job.</p>
                )}
                {job.billedUnits?.some((u) => u.note) && (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {job.billedUnits.filter((u) => u.note).map((u) => <li key={u.stage}>Stage {u.stage}: {u.note}</li>)}
                  </ul>
                )}
              </div>

              {job.requestIds && job.requestIds.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider request ids</h3>
                  <div className="space-y-0.5 font-mono text-xs">{job.requestIds.map((id) => <div key={id}>{id}</div>)}</div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm" title={value}>{value}</dd>
    </>
  );
}

function Stat({ label, value, sub, tone = '' }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}
