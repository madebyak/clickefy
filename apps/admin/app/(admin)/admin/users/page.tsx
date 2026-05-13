'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import {
  Ban,
  Coins,
  Loader2,
  MoreVertical,
  ShieldCheck,
  Trash2,
  Users as UsersIcon,
  UserX,
} from 'lucide-react';

import type { AdminUserListItem } from '@clickfy/types';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useUsersStore, type UsersFilters as Filters } from '@/lib/stores/users-store';
import { AdjustCreditsDialog } from '@/components/users/adjust-credits-dialog';
import { EntitlementDialog } from '@/components/users/entitlement-dialog';
import { UsersFilters } from '@/components/users/users-filters';
import { UserDetailDrawer } from '@/components/users/user-detail-drawer';

const ENTITLEMENT_VARIANT: Record<
  AdminUserListItem['entitlement'],
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  free: 'outline',
  pro: 'secondary',
  pro_max: 'default',
  admin: 'destructive',
};

const ENTITLEMENT_LABEL: Record<AdminUserListItem['entitlement'], string> = {
  free: 'Free',
  pro: 'Pro',
  pro_max: 'Pro Max',
  admin: 'Admin',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function initials(name: string | null, email: string) {
  const source = (name ?? email).trim();
  if (!source) return '?';
  const parts = source.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function UsersPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);

  const users = useUsersStore((s) => s.users);
  const total = useUsersStore((s) => s.total);
  const loading = useUsersStore((s) => s.loading);
  const error = useUsersStore((s) => s.error);
  const filters = useUsersStore((s) => s.filters);
  const setFilters = useUsersStore((s) => s.setFilters);
  const fetchUsers = useUsersStore((s) => s.fetchUsers);
  const softDeleteUser = useUsersStore((s) => s.softDeleteUser);
  const hardDeleteUser = useUsersStore((s) => s.hardDeleteUser);

  // Dialog/drawer state — kept local; the store owns the data, the
  // page owns "which row is the user currently acting on".
  const [creditsTarget, setCreditsTarget] = useState<AdminUserListItem | null>(null);
  const [entitlementTarget, setEntitlementTarget] = useState<AdminUserListItem | null>(null);
  const [softDeleteTarget, setSoftDeleteTarget] = useState<AdminUserListItem | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<AdminUserListItem | null>(null);
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Initial fetch.
  useEffect(() => {
    void fetchUsers(tokenGetter);
  }, [fetchUsers, tokenGetter]);

  // Debounced re-fetch when any filter changes. Keeps the table snappy
  // while the admin types in the search box without hammering the API.
  useEffect(() => {
    const t = setTimeout(() => {
      void fetchUsers(tokenGetter);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.creditsMin, filters.creditsMax]);

  function openDrawer(id: string) {
    setDrawerUserId(id);
    setDrawerOpen(true);
  }

  async function handleSoftDelete() {
    if (!softDeleteTarget) return;
    setDeleting(true);
    try {
      await softDeleteUser(softDeleteTarget.id, tokenGetter);
      toast.success('User soft-deleted (assets purge in 60 days)');
      setSoftDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to soft-delete');
    } finally {
      setDeleting(false);
    }
  }

  async function handleHardDelete() {
    if (!hardDeleteTarget) return;
    setDeleting(true);
    try {
      await hardDeleteUser(hardDeleteTarget.id, tokenGetter);
      toast.success('User permanently deleted');
      setHardDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to hard-delete');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground mt-1">
            Manage end users — credits, entitlement, sessions and more.
          </p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          {total !== null && (
            <>
              <span className="text-foreground font-semibold">{total.toLocaleString()}</span>{' '}
              total
            </>
          )}
        </div>
      </div>

      <UsersFilters
        search={filters.search}
        creditsMin={filters.creditsMin}
        creditsMax={filters.creditsMax}
        onSearchChange={(v) => setFilters({ search: v } satisfies Partial<Filters>)}
        onCreditsMinChange={(v) => setFilters({ creditsMin: v })}
        onCreditsMaxChange={(v) => setFilters({ creditsMax: v })}
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        {loading && users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground mt-4 text-sm">Loading users…</p>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <UsersIcon className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">
              {filters.search || filters.creditsMin || filters.creditsMax
                ? 'No users match your filters'
                : 'No users yet'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Spent</TableHead>
                <TableHead className="text-right">Jobs</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer"
                  onClick={() => openDrawer(u.id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar size="sm">
                        {u.avatarUrl ? (
                          <AvatarImage src={u.avatarUrl} alt={u.name ?? u.email} />
                        ) : null}
                        <AvatarFallback>{initials(u.name, u.email)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {u.name ?? <span className="text-muted-foreground">(no name)</span>}
                          {u.isDeleted && (
                            <Badge variant="destructive" className="ml-2">
                              Deleted
                            </Badge>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {u.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={ENTITLEMENT_VARIANT[u.entitlement]}>
                      {ENTITLEMENT_LABEL[u.entitlement]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {u.creditsBalance.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {u.creditsSpent.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {u.jobsCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.subscriptionRenewsAt
                      ? `Renews ${formatDate(u.subscriptionRenewsAt)}`
                      : u.subscriptionExpiresAt
                        ? `Expires ${formatDate(u.subscriptionExpiresAt)}`
                        : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(u.lastSeenAt)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(u.createdAt)}
                  </TableCell>
                  <TableCell
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon-xs" />}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setCreditsTarget(u)}>
                          <Coins className="h-4 w-4 mr-2" />
                          Adjust credits
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEntitlementTarget(u)}>
                          <ShieldCheck className="h-4 w-4 mr-2" />
                          Change entitlement
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => openDrawer(u.id)}>
                          <Ban className="h-4 w-4 mr-2" />
                          Ban / Unban (in details)
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setSoftDeleteTarget(u)}
                        >
                          <UserX className="h-4 w-4 mr-2" />
                          Soft delete
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setHardDeleteTarget(u)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Hard delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ── Dialogs ───────────────────────────────────────────────── */}
      {/* `key` triggers a remount whenever the targeted user changes, so
          the dialog's local form state initialises from fresh props
          instead of needing a setState-in-effect (banned in React 19). */}
      <AdjustCreditsDialog
        key={`credits-${creditsTarget?.id ?? 'none'}`}
        user={creditsTarget}
        open={creditsTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCreditsTarget(null);
        }}
      />
      <EntitlementDialog
        key={`entitlement-${entitlementTarget?.id ?? 'none'}`}
        user={entitlementTarget}
        open={entitlementTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEntitlementTarget(null);
        }}
      />

      <Dialog
        open={softDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSoftDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Soft-delete user</DialogTitle>
            <DialogDescription>
              Mark <strong>{softDeleteTarget?.email}</strong> as deleted. The
              user&apos;s assets will be purged from R2 / Stream in 60 days. Their
              Clerk account is left intact and they can still sign in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSoftDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleSoftDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Soft delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={hardDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setHardDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hard-delete user</DialogTitle>
            <DialogDescription>
              Permanently delete <strong>{hardDeleteTarget?.email}</strong> from
              both Clerk and our database. Jobs and credit ledger entries will
              cascade and be removed. <strong>This cannot be undone.</strong>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHardDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleHardDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Yes, delete forever'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail drawer ─────────────────────────────────────────── */}
      <UserDetailDrawer
        userId={drawerUserId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
