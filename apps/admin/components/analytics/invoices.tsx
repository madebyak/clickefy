'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import type { ProviderInvoiceRow } from '@clickfy/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { deleteProviderInvoice, upsertProviderInvoice } from '@/lib/api/analytics';
import { monthLabel, signedUsd, usd } from '@/lib/analytics-format';
import type { TokenGetter } from '@/lib/api';

const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Google (Gemini)', kling: 'Kling', seedance: 'BytePlus (Seedance / Seedream)', openai: 'OpenAI', fal: 'fal.ai',
};

/**
 * Computed cost per provider-month next to the invoice total an admin
 * typed in. A gap of more than a few percent means a rate in the cost
 * book is wrong, or a provider billed something we never saw.
 */
export function InvoicePanel({ rows, getToken }: { rows: ProviderInvoiceRow[]; getToken: TokenGetter }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ProviderInvoiceRow | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'analytics'] });

  const save = useMutation({
    mutationFn: (r: ProviderInvoiceRow) =>
      upsertProviderInvoice(getToken, { provider: r.provider, month: r.month, amountUsd: Number(amount), note: note.trim() || null }),
    onSuccess: () => { invalidate(); toast.success('Invoice saved'); setEditing(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteProviderInvoice(getToken, id),
    onSuccess: () => { invalidate(); toast.success('Invoice removed'); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not remove'),
  });

  function open(r: ProviderInvoiceRow) {
    setEditing(r);
    setAmount(r.billedUsd != null ? String(r.billedUsd) : r.computedUsd.toFixed(2));
    setNote(r.note ?? '');
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription className="text-sm font-medium">Provider invoices · computed vs billed</CardDescription>
        <p className="text-xs text-muted-foreground">
          Type in each provider&apos;s monthly bill when it arrives. The computed column is the rate card applied to every job that month.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No provider activity in this range.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Jobs</TableHead>
                <TableHead className="text-right">Computed</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const diff = r.billedUsd != null ? r.billedUsd - r.computedUsd : null;
                const diffPct = diff != null && r.computedUsd > 0 ? (diff / r.computedUsd) * 100 : null;
                return (
                  <TableRow key={`${r.provider}-${r.month}`}>
                    <TableCell className="text-sm">{monthLabel(r.month)}</TableCell>
                    <TableCell className="text-sm font-medium">{PROVIDER_LABEL[r.provider] ?? r.provider}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.jobs}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(r.computedUsd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.billedUsd != null ? usd(r.billedUsd) : <span className="text-muted-foreground">not entered</span>}</TableCell>
                    <TableCell className={`text-right tabular-nums ${diff == null ? 'text-muted-foreground' : Math.abs(diffPct ?? 0) > 10 ? 'text-warning' : ''}`}>
                      {diff == null ? '—' : `${signedUsd(diff)}${diffPct != null ? ` (${diffPct > 0 ? '+' : ''}${diffPct.toFixed(1)}%)` : ''}`}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{r.note ?? ''}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => open(r)} title="Enter invoice total"><Pencil className="h-3.5 w-3.5" /></Button>
                        {r.id && (
                          <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => { if (confirm(`Remove the ${PROVIDER_LABEL[r.provider] ?? r.provider} invoice for ${monthLabel(r.month)}?`)) remove.mutate(r.id!); }} title="Remove">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{PROVIDER_LABEL[editing.provider] ?? editing.provider} · {monthLabel(editing.month)}</DialogTitle>
                <DialogDescription>Computed from the rate card: {usd(editing.computedUsd)} across {editing.jobs} jobs.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-amount">Invoice total (USD)</Label>
                  <Input id="inv-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-note">Note</Label>
                  <Input id="inv-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Invoice number, credits applied, anything odd" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button
                  disabled={save.isPending || !Number.isFinite(Number(amount)) || Number(amount) < 0 || amount.trim() === ''}
                  onClick={() => save.mutate(editing)}
                >
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
