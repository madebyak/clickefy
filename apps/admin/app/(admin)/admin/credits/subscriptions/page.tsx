'use client';

/**
 * Subscription plans — auto-renewable IAPs that grant credits each
 * period AND an entitlement that unlocks top-up purchases.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Power, Star } from 'lucide-react';

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
  createSubscription,
  deleteSubscription,
  fetchSubscriptions,
  updateSubscription,
  type SubscriptionPlanInput,
  type SubscriptionPlanRow,
} from '@/lib/api/credits';

interface FormState {
  storeProductId: string;
  displayName: string;
  entitlement: 'pro' | 'pro_max';
  intervalUnit: 'week' | 'month' | 'year';
  intervalCount: string;
  creditsPerPeriod: string;
  displayOrder: string;
  isFeatured: boolean;
  isActive: boolean;
  notes: string;
}

function emptyForm(): FormState {
  return {
    storeProductId: '',
    displayName: '',
    entitlement: 'pro',
    intervalUnit: 'month',
    intervalCount: '1',
    creditsPerPeriod: '',
    displayOrder: '0',
    isFeatured: false,
    isActive: true,
    notes: '',
  };
}

function fromRow(row: SubscriptionPlanRow): FormState {
  return {
    storeProductId: row.storeProductId,
    displayName: row.displayName,
    entitlement: row.entitlement,
    intervalUnit: row.intervalUnit,
    intervalCount: String(row.intervalCount),
    creditsPerPeriod: String(row.creditsPerPeriod),
    displayOrder: String(row.displayOrder),
    isFeatured: row.isFeatured,
    isActive: row.isActive,
    notes: row.notes ?? '',
  };
}

function toInput(f: FormState): SubscriptionPlanInput | null {
  const credits = Number.parseInt(f.creditsPerPeriod, 10);
  const interval = Number.parseInt(f.intervalCount, 10);
  const order = Number.parseInt(f.displayOrder, 10);
  if (
    !f.storeProductId.trim() ||
    !f.displayName.trim() ||
    !Number.isFinite(credits) ||
    credits < 0 ||
    !Number.isFinite(interval) ||
    interval < 1
  ) {
    return null;
  }
  return {
    storeProductId: f.storeProductId.trim(),
    displayName: f.displayName.trim(),
    entitlement: f.entitlement,
    intervalUnit: f.intervalUnit,
    intervalCount: interval,
    creditsPerPeriod: credits,
    displayOrder: Number.isFinite(order) ? Math.max(0, order) : 0,
    isFeatured: f.isFeatured,
    isActive: f.isActive,
    notes: f.notes.trim() || undefined,
  };
}

export default function SubscriptionsPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'credits', 'subscriptions'],
    queryFn: () => fetchSubscriptions(tokenGetter),
  });

  const [editing, setEditing] = useState<SubscriptionPlanRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const isOpen = creating || editing !== null;

  function openCreate() {
    setForm(emptyForm());
    setEditing(null);
    setCreating(true);
  }
  function openEdit(row: SubscriptionPlanRow) {
    setForm(fromRow(row));
    setCreating(false);
    setEditing(row);
  }
  function close() {
    setCreating(false);
    setEditing(null);
  }

  const createMut = useMutation({
    mutationFn: (input: SubscriptionPlanInput) =>
      createSubscription(input, tokenGetter),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'credits'] });
      toast.success('Plan created');
      close();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Create failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Partial<SubscriptionPlanInput>;
    }) => updateSubscription(id, input, tokenGetter),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'credits'] });
      toast.success('Plan updated');
      close();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Update failed'),
  });

  const toggleMut = useMutation({
    mutationFn: async (row: SubscriptionPlanRow) => {
      if (row.isActive) {
        await deleteSubscription(row.id, tokenGetter);
      } else {
        await updateSubscription(row.id, { isActive: true }, tokenGetter);
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
      toast.error('Fill product id, name, valid interval and credit amount.');
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
            <CardTitle>Subscription plans</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Auto-renewable IAPs. Credits reset to the plan amount on every
              successful renewal; entitlement unlocks top-up purchases.
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" /> New plan
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Product id</TableHead>
                <TableHead>Entitlement</TableHead>
                <TableHead>Interval</TableHead>
                <TableHead className="text-right">Credits / period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[140px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (data?.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No subscription plans yet.
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
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.storeProductId}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {row.entitlement.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.intervalCount > 1 ? `${row.intervalCount} ` : ''}
                      {row.intervalUnit}
                      {row.intervalCount > 1 ? 's' : ''}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {row.creditsPerPeriod}
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
            <DialogTitle>{editing ? 'Edit plan' : 'New plan'}</DialogTitle>
            <DialogDescription>
              Product id must match RevenueCat; entitlement gates top-up
              purchases on mobile.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label htmlFor="store-id">Store product id</Label>
              <Input
                id="store-id"
                value={form.storeProductId}
                onChange={(e) => setForm((s) => ({ ...s, storeProductId: e.target.value }))}
                placeholder="com.clickefy.pro.monthly"
                disabled={!!editing}
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={form.displayName}
                onChange={(e) => setForm((s) => ({ ...s, displayName: e.target.value }))}
                placeholder="Pro Monthly"
              />
            </div>
            <div>
              <Label htmlFor="entitlement">Entitlement</Label>
              <Select
                value={form.entitlement}
                onValueChange={(v) =>
                  setForm((s) => ({ ...s, entitlement: v as 'pro' | 'pro_max' }))
                }
              >
                <SelectTrigger id="entitlement"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="pro_max">Pro Max</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="interval-unit">Interval</Label>
              <Select
                value={form.intervalUnit}
                onValueChange={(v) =>
                  setForm((s) => ({ ...s, intervalUnit: v as FormState['intervalUnit'] }))
                }
              >
                <SelectTrigger id="interval-unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="year">Year</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="interval-count">Interval count</Label>
              <Input
                id="interval-count"
                type="number"
                min={1}
                value={form.intervalCount}
                onChange={(e) => setForm((s) => ({ ...s, intervalCount: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="credits-period">Credits / period</Label>
              <Input
                id="credits-period"
                type="number"
                min={0}
                value={form.creditsPerPeriod}
                onChange={(e) =>
                  setForm((s) => ({ ...s, creditsPerPeriod: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="display-order">Display order</Label>
              <Input
                id="display-order"
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
