'use client';

/**
 * Top-up credit packs — non-renewing consumable IAPs that grant credits
 * to subscribed users. The store_product_id MUST exactly match the
 * RevenueCat product id; otherwise the webhook can't resolve a purchase
 * into a credit grant.
 *
 * Delete is a soft-delete (sets is_active=false) — see the API route
 * file header for why we never hard-delete pricing rows.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, Power, Loader2, Star } from 'lucide-react';

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
  createPack,
  deletePack,
  fetchPacks,
  updatePack,
  type CreditPackInput,
  type CreditPackRow,
} from '@/lib/api/credits';

interface FormState {
  storeProductId: string;
  displayName: string;
  credits: string;
  bonusCredits: string;
  displayOrder: string;
  isFeatured: boolean;
  isActive: boolean;
  notes: string;
}

function emptyForm(): FormState {
  return {
    storeProductId: '',
    displayName: '',
    credits: '',
    bonusCredits: '0',
    displayOrder: '0',
    isFeatured: false,
    isActive: true,
    notes: '',
  };
}

function fromRow(row: CreditPackRow): FormState {
  return {
    storeProductId: row.storeProductId,
    displayName: row.displayName,
    credits: String(row.credits),
    bonusCredits: String(row.bonusCredits),
    displayOrder: String(row.displayOrder),
    isFeatured: row.isFeatured,
    isActive: row.isActive,
    notes: row.notes ?? '',
  };
}

function toInput(f: FormState): CreditPackInput | null {
  const credits = Number.parseInt(f.credits, 10);
  const bonus = Number.parseInt(f.bonusCredits, 10);
  const order = Number.parseInt(f.displayOrder, 10);
  if (!f.storeProductId.trim() || !f.displayName.trim() || !Number.isFinite(credits) || credits <= 0) {
    return null;
  }
  return {
    storeProductId: f.storeProductId.trim(),
    displayName: f.displayName.trim(),
    credits,
    bonusCredits: Number.isFinite(bonus) ? Math.max(0, bonus) : 0,
    displayOrder: Number.isFinite(order) ? Math.max(0, order) : 0,
    isFeatured: f.isFeatured,
    isActive: f.isActive,
    notes: f.notes.trim() || undefined,
  };
}

export default function PacksPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'credits', 'packs'],
    queryFn: () => fetchPacks(tokenGetter),
  });

  const [editing, setEditing] = useState<CreditPackRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const isOpen = creating || editing !== null;

  function openCreate() {
    setForm(emptyForm());
    setEditing(null);
    setCreating(true);
  }
  function openEdit(row: CreditPackRow) {
    setForm(fromRow(row));
    setCreating(false);
    setEditing(row);
  }
  function close() {
    setCreating(false);
    setEditing(null);
  }

  const createMut = useMutation({
    mutationFn: (input: CreditPackInput) => createPack(input, tokenGetter),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'credits'] });
      toast.success('Pack created');
      close();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Create failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CreditPackInput> }) =>
      updatePack(id, input, tokenGetter),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'credits'] });
      toast.success('Pack updated');
      close();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Update failed'),
  });

  const toggleMut = useMutation({
    mutationFn: async (row: CreditPackRow) => {
      if (row.isActive) {
        await deletePack(row.id, tokenGetter);
      } else {
        await updatePack(row.id, { isActive: true }, tokenGetter);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'credits'] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Toggle failed'),
  });

  function submit() {
    const input = toInput(form);
    if (!input) {
      toast.error('Product id, name and credits (> 0) are required.');
      return;
    }
    if (editing) {
      updateMut.mutate({ id: editing.id, input });
    } else {
      createMut.mutate(input);
    }
  }

  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Top-up packs</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              One-time credit purchases. Store product ids MUST match
              RevenueCat exactly.
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" /> New pack
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pack</TableHead>
                <TableHead>Store product id</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Bonus</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[140px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (data?.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No packs yet. Add one to start selling credits.
                  </TableCell>
                </TableRow>
              ) : (
                data!.map((row) => (
                  <TableRow key={row.id} className={!row.isActive ? 'opacity-60' : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.displayName}</span>
                        {row.isFeatured ? (
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">order #{row.displayOrder}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.storeProductId}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {row.credits}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.bonusCredits > 0 ? `+${row.bonusCredits}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.isActive ? 'default' : 'secondary'}>
                        {row.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(row)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={toggleMut.isPending}
                          onClick={() => toggleMut.mutate(row)}
                          title={row.isActive ? 'Deactivate' : 'Reactivate'}
                        >
                          <Power
                            className={
                              row.isActive
                                ? 'h-4 w-4 text-emerald-500'
                                : 'h-4 w-4 text-muted-foreground'
                            }
                          />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isOpen} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit pack' : 'New pack'}</DialogTitle>
            <DialogDescription>
              These fields drive the mobile paywall + the RevenueCat webhook&apos;s
              credit grant. The store product id must match RevenueCat
              exactly.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label htmlFor="store-id">Store product id</Label>
              <Input
                id="store-id"
                value={form.storeProductId}
                onChange={(e) => setForm((s) => ({ ...s, storeProductId: e.target.value }))}
                placeholder="com.clickefy.credits.100"
                disabled={!!editing}
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={form.displayName}
                onChange={(e) => setForm((s) => ({ ...s, displayName: e.target.value }))}
                placeholder="100 Credits"
              />
            </div>
            <div>
              <Label htmlFor="credits">Credits</Label>
              <Input
                id="credits"
                type="number"
                min={1}
                value={form.credits}
                onChange={(e) => setForm((s) => ({ ...s, credits: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="bonus">Bonus</Label>
              <Input
                id="bonus"
                type="number"
                min={0}
                value={form.bonusCredits}
                onChange={(e) => setForm((s) => ({ ...s, bonusCredits: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="order">Display order</Label>
              <Input
                id="order"
                type="number"
                min={0}
                value={form.displayOrder}
                onChange={(e) => setForm((s) => ({ ...s, displayOrder: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-4 pt-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isFeatured}
                  onChange={(e) => setForm((s) => ({ ...s, isFeatured: e.target.checked }))}
                />
                Featured
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.checked }))}
                />
                Active
              </label>
            </div>
            <div className="col-span-2">
              <Label htmlFor="notes">Notes (admin only)</Label>
              <Textarea
                id="notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
