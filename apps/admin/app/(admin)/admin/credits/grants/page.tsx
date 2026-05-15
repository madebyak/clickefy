'use client';

/**
 * Free credit grant policies — welcome bonus + periodic free refresh.
 *
 * Two rows expected: `kind = 'welcome'` (one-shot on signup, no period
 * needed) and `kind = 'periodic_free_refresh'` (recurring, requires
 * periodUnit/periodCount). The migration seeded both with sensible
 * defaults; this page just edits them.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ApiError } from '@/lib/api';
import {
  fetchGrants,
  updateGrant,
  type GrantPolicyKind,
  type GrantPolicyRow,
} from '@/lib/api/credits';

export default function GrantsPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'credits', 'grants'],
    queryFn: () => fetchGrants(tokenGetter),
  });

  const welcome = data?.find((r) => r.kind === 'welcome');
  const refresh = data?.find((r) => r.kind === 'periodic_free_refresh');

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <GrantCard
        title="Welcome bonus"
        description="One-time grant to every new user when they sign up. Deposited into the promo bucket (never expires)."
        kind="welcome"
        row={welcome ?? null}
        showPeriod={false}
        loading={isLoading}
        tokenGetter={tokenGetter}
      />
      <GrantCard
        title="Periodic free refresh"
        description="Recurring grant to free users on every period. Tops the promo bucket up to the configured amount."
        kind="periodic_free_refresh"
        row={refresh ?? null}
        showPeriod={true}
        loading={isLoading}
        tokenGetter={tokenGetter}
      />
    </div>
  );
}

function GrantCard(props: {
  title: string;
  description: string;
  kind: GrantPolicyKind;
  row: GrantPolicyRow | null;
  showPeriod: boolean;
  loading: boolean;
  tokenGetter: () => Promise<string | null>;
}) {
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState<boolean>(props.row?.isActive ?? true);
  const [amount, setAmount] = useState<string>(
    props.row ? String(props.row.amount) : '',
  );
  const [periodUnit, setPeriodUnit] = useState<'day' | 'week' | 'month'>(
    (props.row?.periodUnit as 'day' | 'week' | 'month' | null) ?? 'week',
  );
  const [periodCount, setPeriodCount] = useState<string>(
    props.row?.periodCount ? String(props.row.periodCount) : '1',
  );

  // Sync local state when the row arrives from the server. We use
  // useEffect (not useMemo) because we're mutating state — `useMemo`
  // would risk an infinite render loop.
  useEffect(() => {
    if (!props.row) return;
    setEnabled(props.row.isActive);
    setAmount(String(props.row.amount));
    if (props.row.periodUnit) setPeriodUnit(props.row.periodUnit);
    if (props.row.periodCount) setPeriodCount(String(props.row.periodCount));
  }, [props.row]);

  const mut = useMutation({
    mutationFn: () => {
      const amt = Number.parseInt(amount, 10);
      if (!Number.isFinite(amt) || amt < 0) {
        throw new Error('Amount must be a non-negative number');
      }
      const periodCountNum = Number.parseInt(periodCount, 10);
      return updateGrant(
        props.kind,
        {
          isActive: enabled,
          amount: amt,
          ...(props.showPeriod
            ? {
                periodUnit,
                periodCount: Number.isFinite(periodCountNum)
                  ? Math.max(1, periodCountNum)
                  : 1,
              }
            : {}),
        },
        props.tokenGetter,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'credits'] });
      toast.success(`${props.title} updated`);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{props.description}</p>
      </CardHeader>
      <CardContent>
        {props.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-1/2" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Enabled</div>
                <div className="text-xs text-muted-foreground">
                  Toggle off to pause this grant without losing the
                  configuration.
                </div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <div className="h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-primary-purple peer-checked:after:translate-x-full" />
              </label>
            </div>

            <div className={props.showPeriod ? '' : 'col-span-2'}>
              <Label htmlFor={`amount-${props.kind}`}>Credits granted</Label>
              <Input
                id={`amount-${props.kind}`}
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            {props.showPeriod ? (
              <>
                <div>
                  <Label htmlFor={`unit-${props.kind}`}>Period unit</Label>
                  <Select
                    value={periodUnit}
                    onValueChange={(v) =>
                      setPeriodUnit(v as 'day' | 'week' | 'month')
                    }
                  >
                    <SelectTrigger id={`unit-${props.kind}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Day</SelectItem>
                      <SelectItem value="week">Week</SelectItem>
                      <SelectItem value="month">Month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label htmlFor={`count-${props.kind}`}>Period count</Label>
                  <Input
                    id={`count-${props.kind}`}
                    type="number"
                    min={1}
                    value={periodCount}
                    onChange={(e) => setPeriodCount(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    e.g. <span className="font-mono">1 week</span> means free
                    users get a top-up every 7 days.
                  </p>
                </div>
              </>
            ) : null}

            <div className="col-span-2 flex justify-end">
              <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
                {mut.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1 h-4 w-4" />
                )}
                Save
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
