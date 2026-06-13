'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Loader2, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import {
  ADMIN_ROLES,
  ADMIN_PAGE_KEYS,
  ROLE_DEFAULT_PAGES,
  SUPERADMIN_ONLY_PAGES,
  type AdminPageKey,
  type AdminRole,
  type AdminTeamMember,
  type AdminUserListItem,
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
import { PAGE_TITLES } from '@/lib/admin-nav';
import { useTeamStore } from '@/lib/stores/team-store';
import { usePermissionsStore } from '@/lib/stores/permissions-store';
import { ApiError } from '@/lib/api';

const ROLE_OPTIONS = ADMIN_ROLES;
const ROLE_LABELS: Record<AdminRole, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  creator: 'Creator',
};
const ASSIGNABLE_PAGES = ADMIN_PAGE_KEYS.filter((p) => !SUPERADMIN_ONLY_PAGES.includes(p));

export default function TeamPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);

  const { members, loading, error, fetchTeam, setRole, demote } = useTeamStore();
  const myId = usePermissionsStore((s) => s.me?.userId);

  const [pagesTarget, setPagesTarget] = useState<AdminTeamMember | null>(null);
  const [demoteTarget, setDemoteTarget] = useState<AdminTeamMember | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    void fetchTeam(tokenGetter);
  }, [fetchTeam, tokenGetter]);

  const handleRole = async (member: AdminTeamMember, role: AdminRole) => {
    if (role === member.role) return;
    try {
      await setRole(member.id, role, tokenGetter);
      toast.success(`${member.email} is now ${ROLE_LABELS[role]}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to change role');
    }
  };

  const handleDemote = async () => {
    if (!demoteTarget) return;
    try {
      await demote(demoteTarget.id, tokenGetter);
      toast.success(`Removed staff access from ${demoteTarget.email}`);
      setDemoteTarget(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove access');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Team &amp; Roles
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage who has admin access, their role, and which sections they can see.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add member
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Staff ({members.length})</CardTitle>
          <CardDescription>
            Superadmins can see every section including Team &amp; Monitoring. The last
            superadmin can&apos;t be demoted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-destructive">{error}</p>
          ) : members.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No staff yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="w-[160px]">Role</TableHead>
                  <TableHead>Pages</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isSelf = member.id === myId;
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                            {(member.name ?? member.email).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {member.name ?? '—'}
                              {isSelf && (
                                <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {member.email}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={member.role}
                          onValueChange={(val) => handleRole(member, val as AdminRole)}
                        >
                          <SelectTrigger size="sm" className="w-[140px]">
                            <SelectValue>
                              {(val) => ROLE_LABELS[val as AdminRole] ?? 'Role'}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((r) => (
                              <SelectItem key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {member.role === 'superadmin' ? (
                          <span className="text-xs text-muted-foreground">All sections</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            {member.pages.slice(0, 4).map((p) => (
                              <Badge key={p} variant="secondary">
                                {PAGE_TITLES[p] ?? p}
                              </Badge>
                            ))}
                            {member.pages.length > 4 && (
                              <Badge variant="outline">+{member.pages.length - 4}</Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setPagesTarget(member)}
                            >
                              Edit
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Remove staff access"
                          onClick={() => setDemoteTarget(member)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {pagesTarget && (
        <PagesDialog
          member={pagesTarget}
          onClose={() => setPagesTarget(null)}
          tokenGetter={tokenGetter}
        />
      )}

      <Dialog open={demoteTarget !== null} onOpenChange={(o) => !o && setDemoteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove staff access</DialogTitle>
            <DialogDescription>
              Remove admin access from <strong>{demoteTarget?.email}</strong>. They keep their
              normal account but can no longer reach the dashboard. You can re-add them later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDemoteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDemote}>
              Remove access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddMemberDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        tokenGetter={tokenGetter}
      />
    </div>
  );
}

// ─── Page overrides editor ──────────────────────────────────────────

function PagesDialog({
  member,
  onClose,
  tokenGetter,
}: {
  member: AdminTeamMember;
  onClose: () => void;
  tokenGetter: () => Promise<string | null>;
}) {
  const setPages = useTeamStore((s) => s.setPages);
  const [checked, setChecked] = useState<Set<AdminPageKey>>(
    () => new Set(member.pages.filter((p) => ASSIGNABLE_PAGES.includes(p))),
  );
  const [saving, setSaving] = useState(false);

  const toggle = (page: AdminPageKey) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  const handleSave = async () => {
    const defaults = new Set(ROLE_DEFAULT_PAGES[member.role]);
    const grant = ASSIGNABLE_PAGES.filter((p) => checked.has(p) && !defaults.has(p));
    const revoke = ASSIGNABLE_PAGES.filter((p) => !checked.has(p) && defaults.has(p));
    setSaving(true);
    try {
      await setPages(member.id, grant, revoke, tokenGetter);
      toast.success('Page access updated');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update pages');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Page access — {member.name ?? member.email}</DialogTitle>
          <DialogDescription>
            Toggle the sections this {ROLE_LABELS[member.role].toLowerCase()} can see. Changes
            are stored as overrides on top of the role default.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto">
          {ASSIGNABLE_PAGES.map((page) => {
            const isDefault = ROLE_DEFAULT_PAGES[member.role].includes(page);
            return (
              <label
                key={page}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2.5 text-sm hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={checked.has(page)}
                  onChange={() => toggle(page)}
                />
                <span className="flex-1">{PAGE_TITLES[page] ?? page}</span>
                {isDefault && <span className="text-[10px] text-muted-foreground">default</span>}
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add (promote) a normal user to staff ───────────────────────────

function AddMemberDialog({
  open,
  onClose,
  tokenGetter,
}: {
  open: boolean;
  onClose: () => void;
  tokenGetter: () => Promise<string | null>;
}) {
  const { searchUsers, promote } = useTeamStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminUserListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [role, setRole] = useState<AdminRole>('creator');
  const [promotingId, setPromotingId] = useState<string | null>(null);

  const handleSearch = async () => {
    setSearching(true);
    try {
      const list = await searchUsers(query, tokenGetter);
      setResults(list);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handlePromote = async (user: AdminUserListItem) => {
    setPromotingId(user.id);
    try {
      await promote(user.id, role, tokenGetter);
      toast.success(`${user.email} is now ${ROLE_LABELS[role]}`);
      setResults((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add member');
    } finally {
      setPromotingId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setQuery('');
          setResults([]);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add team member</DialogTitle>
          <DialogDescription>
            Search an existing user by email or name and grant them a role.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Select value={role} onValueChange={(val) => setRole(val as AdminRole)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue>{(val) => ROLE_LABELS[val as AdminRole] ?? 'Role'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Search by email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearch();
              }}
            />
            <Button variant="outline" onClick={handleSearch} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
            </Button>
          </div>

          <div className="max-h-[40vh] space-y-1 overflow-y-auto">
            {results.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {searching ? 'Searching…' : 'No results yet — search above.'}
              </p>
            ) : (
              results.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{user.name ?? '—'}</div>
                    <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handlePromote(user)}
                    disabled={promotingId === user.id}
                  >
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    {promotingId === user.id ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
