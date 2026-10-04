'use client';

/**
 * Models — pricing, status, and (for fal) the model definition itself.
 *
 * Every row is a `provider_models` entry. Credits are edited inline as
 * before; the API cascades a price change into every template whose
 * pipeline references the model. The Edit sheet exposes the rest: name,
 * status, USD reference cost, per-tier pricing — and, for database-driven
 * fal models, the capabilities blob that defines the model.
 *
 * "Add fal model" is the no-deploy path: paste a fal endpoint id, the API
 * reads fal's schema and price and proposes a draft, the admin corrects
 * it and saves. The model is in the picker on the next request.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2, Pencil, Plus, Search, Settings2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import {
  createFalModel,
  fetchModel,
  fetchModels,
  inspectFalEndpoint,
  updateModel,
  updateModelCost,
  type FalInspectResult,
  type ModelStatus,
  type ProviderModelRow,
} from '@/lib/api/credits';

const STATUSES: ModelStatus[] = ['active', 'preview', 'deprecated'];

function parseJsonObject(text: string, label: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    toast.error(`${label} must be a JSON object`);
    return null;
  }
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const details = (err as ApiError & { details?: unknown }).details;
    if (Array.isArray(details) && details.length) {
      const first = details[0] as { path?: unknown[]; message?: string };
      return `${err.message} ${Array.isArray(first.path) ? first.path.join('.') : ''}: ${first.message ?? ''}`.trim();
    }
    return err.message;
  }
  return fallback;
}

export default function ModelsPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'credits', 'models'],
    queryFn: () => fetchModels(tokenGetter),
  });

  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [editingRow, setEditingRow] = useState<ProviderModelRow | null>(null);
  const [adding, setAdding] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'credits'] });

  const updateMutation = useMutation({
    mutationFn: ({ id, cost }: { id: string; cost: number }) => updateModelCost(id, cost, tokenGetter),
    onSuccess: (res) => {
      invalidate();
      toast.success(
        `Price updated · ${res.templatesRecomputed} template${res.templatesRecomputed === 1 ? '' : 's'} recomputed`,
      );
      setEditing(null);
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to update price')),
  });

  function commit() {
    if (!editing) return;
    const num = Number.parseInt(editing.value, 10);
    if (!Number.isFinite(num) || num < 0) {
      toast.error('Enter a non-negative whole number');
      return;
    }
    updateMutation.mutate({ id: editing.id, cost: num });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Models</CardTitle>
          <p className="text-sm text-muted-foreground">
            Per-model credit cost, status and definition. Change a price and every template
            that uses the model is recomputed. fal models added here run without a deploy.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add fal model
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">USD / call</TableHead>
              <TableHead className="w-[180px] text-right">Credits</TableHead>
              <TableHead className="w-[110px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : (data?.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No models registered.
                </TableCell>
              </TableRow>
            ) : (
              data!.map((row) => {
                const isEditing = editing?.id === row.id;
                const unpriced = row.costCredits === 0;
                return (
                  <TableRow key={row.id} className={unpriced ? 'bg-amber-500/5' : undefined}>
                    <TableCell>
                      <div className="font-medium">{row.displayName}</div>
                      <div className="text-xs text-muted-foreground">{row.modelKey}</div>
                    </TableCell>
                    <TableCell className="capitalize">{row.provider}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'active' ? 'default' : 'secondary'} className="capitalize">
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">${row.costPerCallUsd}</TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          autoFocus
                          value={editing.value}
                          onChange={(e) => setEditing({ id: editing.id, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commit();
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          className="ml-auto h-8 w-24 text-right tabular-nums"
                        />
                      ) : (
                        <span className={unpriced ? 'font-semibold text-amber-600' : 'font-semibold tabular-nums'}>
                          {row.costCredits}
                          {unpriced ? ' · unpriced' : ''}
                          {row.tierPricing ? (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              +{Object.keys(row.tierPricing).length} tiers
                            </span>
                          ) : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" disabled={updateMutation.isPending} onClick={commit}>
                            {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                          <Button size="icon" variant="ghost" disabled={updateMutation.isPending} onClick={() => setEditing(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" title="Edit credits" onClick={() => setEditing({ id: row.id, value: String(row.costCredits) })}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" title="Edit model" onClick={() => setEditingRow(row)}>
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      {editingRow && (
        <EditModelSheet
          row={editingRow}
          tokenGetter={tokenGetter}
          onClose={() => setEditingRow(null)}
          onSaved={() => {
            invalidate();
            setEditingRow(null);
          }}
        />
      )}
      {adding && (
        <AddFalModelDialog
          tokenGetter={tokenGetter}
          onClose={() => setAdding(false)}
          onSaved={() => {
            invalidate();
            setAdding(false);
          }}
        />
      )}
    </Card>
  );
}

// ─── Edit sheet ──────────────────────────────────────────────────────

function EditModelSheet({
  row,
  tokenGetter,
  onClose,
  onSaved,
}: {
  row: ProviderModelRow;
  tokenGetter: () => Promise<string | null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const detail = useQuery({
    queryKey: ['admin', 'credits', 'models', row.id],
    queryFn: () => fetchModel(row.id, tokenGetter),
  });
  const [displayName, setDisplayName] = useState(row.displayName);
  const [status, setStatus] = useState<ModelStatus>(row.status);
  const [usd, setUsd] = useState(row.costPerCallUsd);
  const [credits, setCredits] = useState(String(row.costCredits));
  const [tierPricing, setTierPricing] = useState(row.tierPricing ? JSON.stringify(row.tierPricing, null, 2) : '');
  const [capabilities, setCapabilities] = useState<string | null>(null);

  const isDynamic = detail.data ? detail.data.provider === 'fal' && 'fal' in detail.data.capabilities : false;
  const capsText =
    capabilities ?? (detail.data ? JSON.stringify(stripFormFields(detail.data.capabilities), null, 2) : '');

  const save = useMutation({
    mutationFn: async () => {
      const tp = tierPricing.trim() ? parseJsonObject(tierPricing, 'Tier pricing') : null;
      if (tierPricing.trim() && !tp) throw new Error('bad tier pricing');
      const caps = isDynamic && capabilities !== null ? parseJsonObject(capabilities, 'Capabilities') : undefined;
      if (isDynamic && capabilities !== null && !caps) throw new Error('bad capabilities');
      return updateModel(
        row.id,
        {
          displayName,
          status,
          costPerCallUsd: Number(usd),
          costCredits: Number.parseInt(credits, 10),
          tierPricing: (tp as Record<string, number> | null) ?? null,
          ...(caps ? { capabilities: caps } : {}),
        },
        tokenGetter,
      );
    },
    onSuccess: (res) => {
      toast.success(`Saved · ${res.templatesRecomputed} template${res.templatesRecomputed === 1 ? '' : 's'} recomputed`);
      onSaved();
    },
    onError: (err) => {
      if (err instanceof Error && err.message.startsWith('bad ')) return;
      toast.error(errorMessage(err, 'Failed to save'));
    },
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{row.displayName}</SheetTitle>
          <SheetDescription>
            {row.provider} · {row.modelKey}
            {isDynamic ? ' · database-driven' : ' · code registry'}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="grid gap-2">
            <Label>Display name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ModelStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>USD / call</Label>
              <Input type="number" step="0.0001" min={0} value={usd} onChange={(e) => setUsd(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Credits</Label>
              <Input type="number" step={1} min={0} value={credits} onChange={(e) => setCredits(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Tier pricing (JSON, absolute credits per tier; empty = flat)</Label>
            <Textarea rows={4} value={tierPricing} onChange={(e) => setTierPricing(e.target.value)} placeholder='{"720p": 8, "1080p": 15}' className="font-mono text-xs" />
          </div>
          {detail.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : isDynamic ? (
            <div className="grid gap-2">
              <Label>Capabilities (JSON)</Label>
              <Textarea rows={22} value={capsText} onChange={(e) => setCapabilities(e.target.value)} className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">
                Validated on save. `fal.endpoints` picks the endpoint per task; `fal.input` maps our fields to the endpoint&apos;s.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              This model&apos;s capabilities live in the code registry and are not editable here.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The form owns these; keep them out of the JSON editor. */
function stripFormFields(caps: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...caps };
  for (const k of ['provider', 'modelKey', 'displayName', 'status']) delete rest[k];
  return rest;
}

// ─── Add fal model dialog ────────────────────────────────────────────

function AddFalModelDialog({
  tokenGetter,
  onClose,
  onSaved,
}: {
  tokenGetter: () => Promise<string | null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [endpointId, setEndpointId] = useState('');
  const [inspected, setInspected] = useState<FalInspectResult | null>(null);
  const [modelKey, setModelKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<ModelStatus>('preview');
  const [usd, setUsd] = useState('0');
  const [credits, setCredits] = useState('0');
  const [tierPricing, setTierPricing] = useState('');
  const [capabilities, setCapabilities] = useState('');

  const inspect = useMutation({
    mutationFn: () => inspectFalEndpoint(endpointId.trim(), tokenGetter),
    onSuccess: (res) => {
      setInspected(res);
      setModelKey(res.suggestedModelKey);
      setDisplayName(res.title ?? res.suggestedModelKey);
      setUsd(res.unitPrice ? String(res.unitPrice.price) : '0');
      setCredits(res.suggestedCredits ? String(res.suggestedCredits) : '0');
      setCapabilities(JSON.stringify(res.draft, null, 2));
      toast.success(`Read ${res.inputFields.length} input fields from fal`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not inspect that endpoint')),
  });

  const create = useMutation({
    mutationFn: async () => {
      const caps = parseJsonObject(capabilities, 'Capabilities');
      if (!caps) throw new Error('bad capabilities');
      const tp = tierPricing.trim() ? parseJsonObject(tierPricing, 'Tier pricing') : null;
      if (tierPricing.trim() && !tp) throw new Error('bad tier pricing');
      return createFalModel(
        {
          modelKey: modelKey.trim(),
          displayName: displayName.trim(),
          status,
          costPerCallUsd: Number(usd),
          costCredits: Number.parseInt(credits, 10) || 0,
          tierPricing: (tp as Record<string, number> | null) ?? null,
          capabilities: caps,
        },
        tokenGetter,
      );
    },
    onSuccess: (row) => {
      toast.success(`${row.displayName} created as ${row.status}`);
      onSaved();
    },
    onError: (err) => {
      if (err instanceof Error && err.message.startsWith('bad ')) return;
      toast.error(errorMessage(err, 'Failed to create model'));
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add a fal model</DialogTitle>
          <DialogDescription>
            Paste a fal endpoint id. We read its schema and price and propose a definition; check the
            field names against the schema summary, set the price, and save. The model is live on the next request.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            placeholder="alibaba/wan-3.0/image-to-video"
            value={endpointId}
            onChange={(e) => setEndpointId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && inspect.mutate()}
            className="font-mono"
          />
          <Button variant="outline" onClick={() => inspect.mutate()} disabled={inspect.isPending || !endpointId.trim()}>
            {inspect.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Inspect
          </Button>
        </div>

        {inspected && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="rounded-md border p-3 text-xs">
                <div className="font-medium">{inspected.title ?? inspected.endpointId}</div>
                <div className="text-muted-foreground">
                  {inspected.kind} · {inspected.unitPrice ? `$${inspected.unitPrice.price} per ${inspected.unitPrice.unit}` : 'price unknown (set FAL_KEY on the API to read it)'}
                </div>
                <div className="mt-2 max-h-56 overflow-y-auto">
                  {inspected.inputFields.map((f) => (
                    <div key={f.name} className="border-t py-1">
                      <span className="font-mono">{f.name}</span>
                      <span className="text-muted-foreground"> · {f.type}{f.required ? ' · required' : ''}</span>
                      {f.enum ? <div className="text-muted-foreground">enum: {f.enum.map(String).join(', ')}</div> : null}
                      {f.default !== undefined ? <div className="text-muted-foreground">default: {String(f.default)}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Model key</Label>
                <Input value={modelKey} onChange={(e) => setModelKey(e.target.value)} className="font-mono" />
              </div>
              <div className="grid gap-2">
                <Label>Display name</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as ModelStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>USD / call</Label>
                  <Input type="number" step="0.0001" min={0} value={usd} onChange={(e) => setUsd(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Credits</Label>
                  <Input type="number" step={1} min={0} value={credits} onChange={(e) => setCredits(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Tier pricing (JSON, optional)</Label>
                <Textarea rows={3} value={tierPricing} onChange={(e) => setTierPricing(e.target.value)} placeholder='{"720p": 8, "1080p": 15}' className="font-mono text-xs" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Capabilities (JSON)</Label>
              <Textarea rows={26} value={capabilities} onChange={(e) => setCapabilities(e.target.value)} className="font-mono text-xs" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!inspected || create.isPending || !modelKey.trim() || !displayName.trim()}>
            {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create model
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
