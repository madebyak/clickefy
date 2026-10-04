'use client';

/**
 * One run, in full. Opens from a row on the Jobs page and loads
 * `GET /v1/admin/analytics/jobs/:id`: the exact error (code, reason, the
 * sentence the user saw and the provider's verbatim text), timings,
 * inputs with their media, outputs, settings, the template pipeline,
 * how the cost was reached, every credit movement, and the identifiers
 * support will ask for.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, ExternalLink } from 'lucide-react';

import type { AnalyticsJobDetail, AnalyticsJobRow } from '@clickfy/types';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchAnalyticsJob } from '@/lib/api/analytics';
import { dubaiDateTimeLabel, int, signedUsd, usd } from '@/lib/analytics-format';
import type { TokenGetter } from '@/lib/api';

const STATUS_LABEL: Record<AnalyticsJobRow['status'], string> = { queued: 'Queued', processing: 'Processing', completed: 'Completed', failed: 'Failed' };

/** Why a failure code happened and whether the user was refunded, in words an admin can forward. */
const ERROR_CODE_HELP: Record<string, string> = {
  provider_error: 'The AI provider rejected or failed the request. Credits refunded.',
  provider_timeout: 'The provider did not return within our limit. Credits refunded.',
  r2_input_missing: 'A referenced upload was not in storage when the worker fetched it. Credits refunded.',
  unknown_model: 'The job named a model the worker does not know. Credits refunded.',
  template_missing: 'The template or its version could not be loaded. Credits refunded.',
  compile_error: 'The request could not be built for the provider from these inputs.',
};

function ms(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1000) return `${n} ms`;
  const s = n / 1000;
  if (s < 90) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function JobDetailSheet({ job, getToken, onClose }: { job: AnalyticsJobRow | null; getToken: TokenGetter; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'analytics', 'job', job?.id],
    queryFn: () => fetchAnalyticsJob(getToken, job!.id),
    enabled: job != null,
    staleTime: 60_000,
  });

  return (
    <Sheet open={job != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {job && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {job.modelName ?? job.modelKey ?? job.templateTitle ?? 'Job'}
                <Badge variant={job.status === 'failed' ? 'destructive' : job.status === 'completed' ? 'default' : 'secondary'}>{STATUS_LABEL[job.status]}</Badge>
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2 font-mono text-xs">
                {job.id} <CopyButton value={job.id} />
              </SheetDescription>
            </SheetHeader>
            {error ? (
              <p className="px-4 text-sm text-destructive">{error instanceof Error ? error.message : 'Could not load the job'}</p>
            ) : isLoading || !data ? (
              <div className="space-y-3 px-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : (
              <Detail d={data} />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ d }: { d: AnalyticsJobDetail }) {
  const prompt = d.inputs.find((i) => i.kind === 'text' && (i.key === 'prompt' || i.key === 'text')) ?? d.inputs.find((i) => i.kind === 'text');
  const media = d.inputs.filter((i) => i.kind !== 'text') as Array<Extract<AnalyticsJobDetail['inputs'][number], { kind: 'image' | 'video' | 'audio' }>>;
  const otherText = d.inputs.filter((i) => i.kind === 'text' && i !== prompt) as Array<Extract<AnalyticsJobDetail['inputs'][number], { kind: 'text' }>>;
  const settings = Object.entries(d.options).filter(([, v]) => v !== undefined && v !== null);

  return (
    <div className="space-y-6 px-4 pb-8 text-sm">
      {/* Error, first and loud */}
      {d.error && (
        <Section title="What went wrong">
          <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive" className="font-mono">{d.error.code}</Badge>
              {d.error.reason && <Badge variant="outline" className="font-mono">reason: {d.error.reason}</Badge>}
              <span className="text-xs text-muted-foreground">stage {d.error.stage}{d.error.retryCount ? ` · ${d.error.retryCount} retr${d.error.retryCount === 1 ? 'y' : 'ies'}` : ''}</span>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Shown to the user</div>
              <div>{d.error.message}</div>
            </div>
            {d.error.detail && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Provider said (verbatim)</div>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs">{d.error.detail}</pre>
              </div>
            )}
            {!d.error.detail && !d.error.reason && (
              <p className="text-xs text-muted-foreground">This is the provider&apos;s own text: no friendlier sentence replaced it.</p>
            )}
            {ERROR_CODE_HELP[d.error.code] && <p className="text-xs text-muted-foreground">{ERROR_CODE_HELP[d.error.code]}</p>}
          </div>
        </Section>
      )}

      {/* Timeline */}
      <Section title="Timeline">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          <Field label="Created" value={dubaiDateTimeLabel(d.createdAt)} />
          <Field label="Started" value={d.startedAt ? dubaiDateTimeLabel(d.startedAt) : '—'} sub={d.queueMs != null ? `${ms(d.queueMs)} in queue` : undefined} />
          <Field label="Finished" value={d.completedAt ? dubaiDateTimeLabel(d.completedAt) : '—'} sub={d.runMs != null ? `${ms(d.runMs)} running` : undefined} />
          <Field label="User" value={d.user.email} sub={[d.user.name, d.userEntitlement].filter(Boolean).join(' · ')} />
          <Field label="Origin" value={`${d.origin}${d.templateTitle ? ` · ${d.templateTitle}` : ''}`} />
          <Field label="Provider" value={d.provider ?? '—'} sub={d.modelKey ?? undefined} />
          {d.progress && d.status === 'processing' && (
            <Field label="Progress" value={`stage ${d.progress.stage}/${d.progress.totalStages}`} sub={d.progress.message} />
          )}
        </dl>
      </Section>

      {/* Money */}
      <Section title="Money">
        <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border text-center">
          <Stat label="Credit value" value={usd(d.creditValueUsd)} sub={`${d.paidCreditsNet} paid of ${d.creditsNet} net credits`} />
          <Stat label="Provider cost" value={usd(d.providerCostUsd)} sub={d.costBasis ?? 'unpriced'} />
          <Stat label="Profit" value={signedUsd(d.profitUsd)} sub={d.creditsRefunded ? `${d.creditsRefunded} credits refunded` : ' '} tone={d.profitUsd != null && d.profitUsd < 0 ? 'text-destructive' : 'text-primary-green'} />
        </div>
        {d.billedUnits && d.billedUnits.length > 0 && (
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead><TableHead>Model</TableHead><TableHead>Mode</TableHead>
                <TableHead className="text-right">Units</TableHead><TableHead className="text-right">Unit price</TableHead><TableHead className="text-right">USD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.billedUnits.map((u) => (
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
        )}
        {d.billedUnits?.some((u) => u.note) && (
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">{d.billedUnits.filter((u) => u.note).map((u) => <li key={u.stage}>Stage {u.stage}: {u.note}</li>)}</ul>
        )}
      </Section>

      {/* Inputs */}
      <Section title="Inputs">
        {prompt && (
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{prompt.key}</div>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs">{(prompt as { value: string }).value}</pre>
          </div>
        )}
        {otherText.map((t) => (
          <div key={t.key} className="mb-2"><span className="text-xs text-muted-foreground">{t.key}: </span><span className="text-xs">{t.value}</span></div>
        ))}
        {media.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {media.map((m) => (
              <a key={m.key} href={m.url} target="_blank" rel="noreferrer" className="group relative block h-24 w-24 overflow-hidden rounded-md border border-border bg-muted" title={`${m.key} · ${m.mimeType} · ${bytes(m.sizeBytes)}`}>
                {m.kind === 'image' ? (
                  <img src={m.url} alt={m.key} className="h-full w-full object-cover" />
                ) : m.kind === 'video' ? (
                  <video src={m.url} muted className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs">audio</div>
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-[10px] text-white">{m.key}</span>
              </a>
            ))}
          </div>
        ) : (
          !prompt && <p className="text-xs text-muted-foreground">No inputs recorded.</p>
        )}
      </Section>

      {/* Outputs */}
      {d.outputs.length > 0 && (
        <Section title={`Outputs (${d.outputs.length})`}>
          <div className="flex flex-wrap gap-2">
            {d.outputs.map((o, i) => (
              <a key={i} href={o.url} target="_blank" rel="noreferrer" className="relative block h-32 w-32 overflow-hidden rounded-md border border-border bg-muted" title={o.kind === 'video' ? `${o.durationSec ?? '?'} s · ${o.width ?? '?'}×${o.height ?? '?'}` : `${o.width ?? '?'}×${o.height ?? '?'}`}>
                {o.kind === 'image' ? (
                  <img src={o.url} alt="" className="h-full w-full object-cover" />
                ) : o.posterUrl ? (
                  <img src={o.posterUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <video src={o.url} muted className="h-full w-full object-cover" />
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-[10px] text-white">
                  {o.kind === 'video' ? `video · ${o.durationSec ?? '?'} s` : 'image'}{o.width && o.height ? ` · ${o.width}×${o.height}` : ''}
                </span>
              </a>
            ))}
          </div>
          {d.resultDurationMs != null && <p className="mt-2 text-xs text-muted-foreground">Provider round-trip {ms(d.resultDurationMs)}.</p>}
        </Section>
      )}

      {/* Settings + pipeline */}
      <Section title="Settings">
        {settings.length === 0 ? (
          <p className="text-xs text-muted-foreground">No options stored.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {settings.map(([k, v]) => (
              <Field key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
            ))}
          </dl>
        )}
        {d.stages && d.stages.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Template pipeline at this version</div>
            <ol className="mt-1 space-y-1">
              {d.stages.map((s) => (
                <li key={s.stage} className="text-xs">
                  <span className="font-medium">{s.stage}.</span> {s.provider} · <span className="font-mono">{s.model}</span>
                  {Object.keys(s.config).length > 0 && <span className="text-muted-foreground"> · {Object.entries(s.config).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(', ')}</span>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </Section>

      {/* Ledger */}
      <Section title="Credits">
        {d.ledger.length === 0 ? (
          <p className="text-xs text-muted-foreground">No ledger rows name this job.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>When</TableHead><TableHead>Entry</TableHead><TableHead>Bucket</TableHead><TableHead className="text-right">Δ</TableHead><TableHead className="text-right">Balance after</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {d.ledger.map((l) => {
                const meta = l.metadata as Record<string, number | undefined>;
                const split = l.reason === 'job_charge'
                  ? [meta.fromSubscription ? `${meta.fromSubscription} sub` : null, meta.fromTopup ? `${meta.fromTopup} top-up` : null, meta.fromPromo ? `${meta.fromPromo} promo` : null]
                  : l.reason === 'refund'
                    ? [meta.rSub ? `${meta.rSub} sub` : null, meta.rTopup ? `${meta.rTopup} top-up` : null, meta.rPromo ? `${meta.rPromo} promo` : null]
                    : [];
                return (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dubaiDateTimeLabel(l.createdAt)}</TableCell>
                    <TableCell className="text-xs">
                      {l.reason.replace(/_/g, ' ')}
                      {split.filter(Boolean).length > 0 && <div className="text-[10px] text-muted-foreground">{split.filter(Boolean).join(' · ')}</div>}
                      {l.note && <div className="text-[10px] text-muted-foreground">{l.note}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{l.bucket ?? '—'}</TableCell>
                    <TableCell className={`text-right tabular-nums ${l.delta < 0 ? '' : 'text-primary-green'}`}>{l.delta > 0 ? `+${l.delta}` : l.delta}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{int(l.balanceAfter)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>

      {/* Identifiers */}
      <Section title="Identifiers">
        <dl className="grid grid-cols-1 gap-y-1.5">
          <IdField label="Job" value={d.id} />
          <IdField label="User" value={d.user.id} />
          {d.triggerRunId && <IdField label="Trigger.dev run" value={d.triggerRunId} href={d.triggerRunUrl ?? undefined} />}
          {d.providerTaskId && <IdField label="Provider task" value={d.providerTaskId} />}
          {d.requestIds?.map((r) => <IdField key={r} label="Provider request" value={r} />)}
          {d.templateId && <IdField label="Template" value={d.templateId} href={`/admin/templates/${d.templateId}`} />}
          {d.templateVersionId && <IdField label="Template version" value={d.templateVersionId} />}
          {d.projectId && <IdField label="Project" value={d.projectId} />}
          {d.idempotencyKey && <IdField label="Idempotency key" value={d.idempotencyKey} />}
        </dl>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm" title={value}>{value}</dd>
      {sub && <dd className="truncate text-xs text-muted-foreground" title={sub}>{sub}</dd>}
    </div>
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

function IdField({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1 font-mono">
        <span className="truncate">{value}</span>
        <CopyButton value={value} />
        {href && (
          <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Open">
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </dd>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 shrink-0"
      title="Copy"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); });
      }}
    >
      {done ? <Check className="h-3 w-3 text-primary-green" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}
