'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Activity, Loader2, Trophy } from 'lucide-react';
import { toast } from 'sonner';

import type {
  AdminRole,
  MonitoringPublishedTemplate,
} from '@clickfy/types';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMonitoringStore, type PublishedSort } from '@/lib/stores/monitoring-store';
import { useTeamStore } from '@/lib/stores/team-store';
import { ApiError } from '@/lib/api';

const KIND_LABELS: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  image_set: 'Image set',
};
const ROLE_LABELS: Record<AdminRole, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  creator: 'Creator',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MonitoringPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);
  const [tab, setTab] = useState('published');

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Activity className="h-6 w-6 text-primary" />
          Monitoring
        </h1>
        <p className="text-sm text-muted-foreground">
          Track every published template, who published it, and recent admin activity.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="published">Published templates</TabsTrigger>
          <TabsTrigger value="leaderboard">Publisher leaderboard</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="published">
          <PublishedTab tokenGetter={tokenGetter} active={tab === 'published'} />
        </TabsContent>
        <TabsContent value="leaderboard">
          <LeaderboardTab tokenGetter={tokenGetter} active={tab === 'leaderboard'} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab tokenGetter={tokenGetter} active={tab === 'activity'} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Published templates tab ────────────────────────────────────────

function PublishedTab({
  tokenGetter,
  active,
}: {
  tokenGetter: () => Promise<string | null>;
  active: boolean;
}) {
  const {
    published,
    publishedTotal,
    publishedHasMore,
    publishedLoading,
    publishedLoadingMore,
    publishedQuery,
    publishedSort,
    setPublishedQuery,
    setPublishedSort,
    fetchPublished,
    loadMorePublished,
  } = useMonitoringStore();

  const [searchInput, setSearchInput] = useState(publishedQuery);
  const [ownerTarget, setOwnerTarget] = useState<MonitoringPublishedTemplate | null>(null);

  // Debounce search → store query.
  useEffect(() => {
    const t = setTimeout(() => setPublishedQuery(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput, setPublishedQuery]);

  useEffect(() => {
    if (active) void fetchPublished(tokenGetter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, publishedQuery, publishedSort]);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Published templates ({publishedTotal})</CardTitle>
        <CardDescription>
          Each template&apos;s current publisher comes from its latest version.
        </CardDescription>
        <div className="flex flex-col gap-2 pt-2 sm:flex-row">
          <Input
            placeholder="Search by title…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="sm:max-w-xs"
          />
          <Select
            value={publishedSort}
            onValueChange={(val) => setPublishedSort(val as PublishedSort)}
          >
            <SelectTrigger className="w-full sm:w-[170px]">
              <SelectValue>
                {(val) =>
                  ({ newest: 'Newest first', oldest: 'Oldest first', title_asc: 'Name (A–Z)' }[
                    val as PublishedSort
                  ] ?? 'Newest first')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="title_asc">Name (A–Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {publishedLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : published.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No published templates.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead className="w-[100px]">Kind</TableHead>
                  <TableHead>Publisher</TableHead>
                  <TableHead className="w-[90px]">Versions</TableHead>
                  <TableHead className="w-[180px]">Published</TableHead>
                  <TableHead className="w-[110px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {published.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{KIND_LABELS[t.kind] ?? t.kind}</Badge>
                    </TableCell>
                    <TableCell>
                      {t.publisherId ? (
                        <div className="min-w-0">
                          <div className="truncate text-sm">{t.publisherName ?? '—'}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {t.publisherEmail}
                          </div>
                        </div>
                      ) : (
                        <Badge variant="destructive">Unattributed</Badge>
                      )}
                    </TableCell>
                    <TableCell>{t.versionCount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(t.publishedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="xs" onClick={() => setOwnerTarget(t)}>
                        Set owner
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Showing {published.length} of {publishedTotal}
              </span>
              {publishedHasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadMorePublished(tokenGetter)}
                  disabled={publishedLoadingMore}
                >
                  {publishedLoadingMore ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>

      {ownerTarget && (
        <SetOwnerDialog
          target={ownerTarget}
          onClose={() => setOwnerTarget(null)}
          tokenGetter={tokenGetter}
        />
      )}
    </Card>
  );
}

function SetOwnerDialog({
  target,
  onClose,
  tokenGetter,
}: {
  target: MonitoringPublishedTemplate;
  onClose: () => void;
  tokenGetter: () => Promise<string | null>;
}) {
  const setOwner = useMonitoringStore((s) => s.setOwner);
  const { members, fetchTeam } = useTeamStore();
  const [ownerId, setOwnerId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (members.length === 0) void fetchTeam(tokenGetter);
  }, [members.length, fetchTeam, tokenGetter]);

  const handleSave = async () => {
    if (!ownerId) return;
    setSaving(true);
    try {
      await setOwner(target.id, ownerId, tokenGetter);
      toast.success('Owner updated');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to set owner');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set publisher</DialogTitle>
          <DialogDescription>
            Attribute <strong>{target.title}</strong> to a staff member. This stamps the
            template&apos;s latest version — useful when the original publisher was removed.
          </DialogDescription>
        </DialogHeader>
        <Select value={ownerId} onValueChange={(val) => setOwnerId(val ?? '')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a staff member">
              {(val) => {
                const m = members.find((x) => x.id === val);
                return m ? (m.name ?? m.email) : 'Choose a staff member';
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name ?? m.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !ownerId}>
            {saving ? 'Saving…' : 'Set owner'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Leaderboard tab ────────────────────────────────────────────────

function LeaderboardTab({
  tokenGetter,
  active,
}: {
  tokenGetter: () => Promise<string | null>;
  active: boolean;
}) {
  const { metrics, metricsLoading, fetchMetrics } = useMonitoringStore();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const hasCustom = Boolean(from || to);

  useEffect(() => {
    if (active) void fetchMetrics(tokenGetter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const applyRange = () => {
    void fetchMetrics(tokenGetter, {
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
    });
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          Publisher leaderboard
        </CardTitle>
        <CardDescription>Publish counts per admin. Each version counts.</CardDescription>
        <div className="flex flex-wrap items-end gap-2 pt-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={applyRange}>
            Apply
          </Button>
          {hasCustom && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom('');
                setTo('');
                void fetchMetrics(tokenGetter);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {metricsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : metrics.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No publishes yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">#</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead className="w-[90px] text-right">Total</TableHead>
                <TableHead className="w-[90px] text-right">7 days</TableHead>
                <TableHead className="w-[90px] text-right">30 days</TableHead>
                {hasCustom && <TableHead className="w-[90px] text-right">Custom</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((m, i) => (
                <TableRow key={m.adminId ?? `unattributed-${i}`}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    {m.adminId ? (
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{m.name ?? '—'}</div>
                          <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                        </div>
                        {m.role && <Badge variant="secondary">{ROLE_LABELS[m.role]}</Badge>}
                      </div>
                    ) : (
                      <Badge variant="destructive">Unattributed</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">{m.total}</TableCell>
                  <TableCell className="text-right">{m.last7d}</TableCell>
                  <TableCell className="text-right">{m.last30d}</TableCell>
                  {hasCustom && <TableCell className="text-right">{m.custom ?? 0}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Activity tab ───────────────────────────────────────────────────

function ActivityTab({
  tokenGetter,
  active,
}: {
  tokenGetter: () => Promise<string | null>;
  active: boolean;
}) {
  const {
    activity,
    activityTotal,
    activityHasMore,
    activityLoading,
    activityLoadingMore,
    fetchActivity,
    loadMoreActivity,
  } = useMonitoringStore();

  useEffect(() => {
    if (active) void fetchActivity(tokenGetter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Recent activity ({activityTotal})</CardTitle>
        <CardDescription>Every admin mutation, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {activityLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : activity.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm">{entry.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.adminName ?? entry.adminEmail ?? 'Unknown'} · {entry.method}{' '}
                      {entry.path}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Showing {activity.length} of {activityTotal}
              </span>
              {activityHasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadMoreActivity(tokenGetter)}
                  disabled={activityLoadingMore}
                >
                  {activityLoadingMore ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
