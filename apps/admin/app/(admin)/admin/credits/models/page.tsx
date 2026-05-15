'use client';

/**
 * Per-model credit pricing.
 *
 * Each row corresponds to a registered `provider_models` entry. The
 * admin edits the credits column inline; on save we PATCH the model
 * and the API cascades the new price into every template whose
 * pipeline references it (so the auto-cost stays honest).
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2, Pencil, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import {
  fetchModels,
  updateModelCost,
  type ProviderModelRow,
} from '@/lib/api/credits';

export default function ModelsPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'credits', 'models'],
    queryFn: () => fetchModels(tokenGetter),
  });

  const [editing, setEditing] = useState<{ id: string; value: string } | null>(
    null,
  );

  const updateMutation = useMutation({
    mutationFn: ({ id, cost }: { id: string; cost: number }) =>
      updateModelCost(id, cost, tokenGetter),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'credits'] });
      toast.success(
        `Price updated · ${res.templatesRecomputed} template${
          res.templatesRecomputed === 1 ? '' : 's'
        } recomputed`,
      );
      setEditing(null);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update price');
    },
  });

  function startEdit(row: ProviderModelRow) {
    setEditing({ id: row.id, value: String(row.costCredits) });
  }

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
      <CardHeader>
        <CardTitle>Model pricing</CardTitle>
        <p className="text-sm text-muted-foreground">
          Per-model credit cost. A template&apos;s total cost is the sum of every
          stage&apos;s model cost — change a price here and every affected
          template is recomputed automatically.
        </p>
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
              <TableHead className="w-[80px]" />
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
                  No models registered. Seed `provider_models` first.
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
                      <Badge
                        variant={row.status === 'active' ? 'default' : 'secondary'}
                        className="capitalize"
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      ${row.costPerCallUsd}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          autoFocus
                          value={editing.value}
                          onChange={(e) =>
                            setEditing({ id: editing.id, value: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commit();
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          className="ml-auto h-8 w-24 text-right tabular-nums"
                        />
                      ) : (
                        <span
                          className={
                            unpriced
                              ? 'font-semibold text-amber-600'
                              : 'font-semibold tabular-nums'
                          }
                        >
                          {row.costCredits}
                          {unpriced ? ' · unpriced' : ''}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={updateMutation.isPending}
                            onClick={commit}
                          >
                            {updateMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Check className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={updateMutation.isPending}
                            onClick={() => setEditing(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="icon" variant="ghost" onClick={() => startEdit(row)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
