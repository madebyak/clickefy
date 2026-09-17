'use client';

/**
 * Billing — who pays us, from where, and how much.
 *
 * SPLIT BY SOURCE, DELIBERATELY. A web subscription lives in Stripe and we
 * can change it; an App Store one lives in Apple's world, reaches us
 * through RevenueCat, and can only be managed by the customer in iOS
 * Settings. A comped plan is neither — nobody paid, and counting it as
 * revenue would flatter every number on this page.
 *
 * Mobile is not live yet. The columns exist anyway: adding the split later
 * would mean re-checking which world every existing figure was counting.
 */

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import { Apple, CreditCard, Gift, Play, Users } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { fetchBillingActivity, fetchSubscribers, type SubscriberSource } from '@/lib/api/billing';

const SOURCE_LABEL: Record<SubscriberSource, string> = {
  stripe: 'Web',
  app_store: 'iOS',
  play_store: 'Android',
  comped: 'Comped',
};

const SOURCE_ICON: Record<SubscriberSource, typeof CreditCard> = {
  stripe: CreditCard,
  app_store: Apple,
  play_store: Play,
  comped: Gift,
};

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function AdminBillingPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'billing', 'subscribers'],
    queryFn: () => fetchSubscribers(tokenGetter),
    refetchInterval: 60_000,
  });
  const { data: activity } = useQuery({
    queryKey: ['admin', 'billing', 'activity'],
    queryFn: () => fetchBillingActivity(tokenGetter),
    refetchInterval: 60_000,
  });

  const summary = data?.summary;
  const sources: SubscriberSource[] = ['stripe', 'app_store', 'play_store', 'comped'];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Paying subscribers by source. Comped plans are shown but never counted as revenue.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Monthly revenue</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <p className="text-2xl font-semibold">{usd(summary?.mrrUsd ?? 0)}</p>
                <p className="text-xs text-muted-foreground">
                  Yearly plans counted as a twelfth of themselves
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {sources.map((s) => {
          const Icon = SOURCE_ICON[s];
          const cell = summary?.bySource?.[s];
          return (
            <Card key={s}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{SOURCE_LABEL[s]}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <>
                    <p className="text-2xl font-semibold">{cell?.count ?? 0}</p>
                    <p className="text-xs text-muted-foreground">
                      {s === 'comped' ? 'no revenue' : `${usd(cell?.mrrUsd ?? 0)} / mo`}
                      {s !== 'stripe' && s !== 'comped' && (cell?.count ?? 0) === 0 && ' · not live yet'}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Subscribers */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Subscribers
          </CardTitle>
          {summary && (
            <span className="text-sm text-muted-foreground">
              {Object.entries(summary.byTier)
                .map(([tier, n]) => `${n} ${tier}`)
                .join(' · ')}
            </span>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (data?.subscribers.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No subscribers yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr className="border-b">
                    <th className="pb-2 pr-3 font-medium">Customer</th>
                    <th className="pb-2 pr-3 font-medium">Plan</th>
                    <th className="pb-2 pr-3 font-medium">Source</th>
                    <th className="pb-2 pr-3 font-medium">Renews</th>
                    <th className="pb-2 pr-3 text-right font-medium">Credits</th>
                    <th className="pb-2 text-right font-medium">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.subscribers.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium">{s.name ?? s.email.split('@')[0]}</p>
                        <p className="text-xs text-muted-foreground">{s.email}</p>
                      </td>
                      <td className="py-2.5 pr-3 capitalize">{s.tier}</td>
                      <td className="py-2.5 pr-3">
                        <Badge variant={s.source === 'comped' ? 'outline' : 'secondary'}>
                          {SOURCE_LABEL[s.source]}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        {day(s.renewsAt ?? s.expiresAt)}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{s.credits}</td>
                      <td className="py-2.5 text-right tabular-nums">
                        {s.mrrUsd > 0 ? usd(s.mrrUsd) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Money movement — deliberately not the whole ledger. Job charges
          are the noisy majority and answer a different question. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent billing activity</CardTitle>
        </CardHeader>
        <CardContent>
          {!activity ? (
            <Skeleton className="h-24 w-full" />
          ) : activity.activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {activity.activity.slice(0, 25).map((row, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate">
                      <span className="font-medium">{row.email}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{row.reason}</span>
                    </p>
                    {row.note && <p className="truncate text-xs text-muted-foreground">{row.note}</p>}
                  </div>
                  <span
                    className={`shrink-0 tabular-nums ${row.delta > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}
                  >
                    {row.delta > 0 ? '+' : ''}
                    {row.delta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
