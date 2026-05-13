'use client';

import { useEffect, useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import {
  Ban,
  CheckCircle2,
  Coins,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import type { UserEntitlement } from '@clickfy/types';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useUsersStore } from '@/lib/stores/users-store';

interface UserDetailDrawerProps {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ENTITLEMENT_LABELS: Record<UserEntitlement, string> = {
  free: 'Free',
  pro: 'Pro',
  pro_max: 'Pro Max',
  admin: 'Admin',
};

const REASON_LABELS: Record<string, string> = {
  purchase: 'Purchase',
  subscription_grant: 'Subscription grant',
  job_charge: 'Job charge',
  refund: 'Refund',
  admin_adjust: 'Admin adjust',
  signup_bonus: 'Signup bonus',
  daily_free: 'Daily free',
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
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

export function UserDetailDrawer({
  userId,
  open,
  onOpenChange,
}: UserDetailDrawerProps) {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);

  const detail = useUsersStore((s) => s.detail);
  const detailLoading = useUsersStore((s) => s.detailLoading);
  const detailError = useUsersStore((s) => s.detailError);
  const fetchDetail = useUsersStore((s) => s.fetchDetail);
  const clearDetail = useUsersStore((s) => s.clearDetail);
  const banUser = useUsersStore((s) => s.banUser);
  const unbanUser = useUsersStore((s) => s.unbanUser);

  useEffect(() => {
    if (open && userId) {
      void fetchDetail(userId, tokenGetter);
    }
    if (!open) {
      // Defer so the close transition runs against the populated state.
      const t = setTimeout(() => clearDetail(), 200);
      return () => clearTimeout(t);
    }
  }, [open, userId, fetchDetail, clearDetail, tokenGetter]);

  const banned = detail?.clerk?.banned ?? false;

  async function handleBanToggle() {
    if (!detail) return;
    try {
      if (banned) {
        await unbanUser(detail.id, tokenGetter);
        toast.success('User unbanned');
      } else {
        await banUser(detail.id, tokenGetter);
        toast.success('User banned');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!max-w-2xl w-full overflow-y-auto"
      >
        {detailLoading && !detail ? (
          <div className="flex flex-1 items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : detailError ? (
          <div className="p-6 text-sm text-destructive">{detailError}</div>
        ) : detail ? (
          <>
            <SheetHeader className="px-6 pt-6 pb-2">
              <div className="flex items-start gap-4">
                <Avatar size="lg">
                  {detail.avatarUrl ? (
                    <AvatarImage src={detail.avatarUrl} alt={detail.name ?? detail.email} />
                  ) : null}
                  <AvatarFallback>{initials(detail.name, detail.email)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-lg">
                    {detail.name ?? '(no name)'}
                  </SheetTitle>
                  <SheetDescription className="truncate">{detail.email}</SheetDescription>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">
                      {ENTITLEMENT_LABELS[detail.entitlement]}
                    </Badge>
                    {banned && (
                      <Badge variant="destructive">
                        <Ban className="h-3 w-3 mr-1" />
                        Banned
                      </Badge>
                    )}
                    {detail.isDeleted && (
                      <Badge variant="destructive">Soft-deleted</Badge>
                    )}
                    {detail.clerk?.primaryEmailVerified ? (
                      <Badge variant="outline">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Verified
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <XCircle className="h-3 w-3 mr-1" /> Unverified
                      </Badge>
                    )}
                    {detail.clerk?.twoFactorEnabled && (
                      <Badge variant="outline">
                        <ShieldCheck className="h-3 w-3 mr-1" /> 2FA
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </SheetHeader>

            <div className="px-6 pb-6 space-y-6">
              {/* ── Stats grid ─────────────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Credits balance" value={detail.creditsBalance} highlight />
                <Stat label="Credits spent" value={detail.creditsSpent} />
                <Stat label="Lifetime jobs" value={detail.jobsCount} />
                <Stat label="Locale" value={detail.locale.toUpperCase()} />
              </div>

              <Separator />

              {/* ── Identity & subscription ────────────────────────────── */}
              <Section title="Identity">
                <KV k="Internal id" v={<code className="text-xs">{detail.id}</code>} />
                <KV k="Clerk id" v={<code className="text-xs">{detail.clerkUserId}</code>} />
                <KV k="Joined" v={formatDate(detail.createdAt)} />
                <KV k="Last seen (DB)" v={formatDate(detail.lastSeenAt)} />
                <KV k="Subscription renews" v={formatDate(detail.subscriptionRenewsAt)} />
                <KV k="Subscription expires" v={formatDate(detail.subscriptionExpiresAt)} />
                {detail.purgeAssetsAt && (
                  <KV
                    k="Asset purge at"
                    v={
                      <span className="text-warning">
                        <ShieldAlert className="inline h-3 w-3 mr-1" />
                        {formatDate(detail.purgeAssetsAt)}
                      </span>
                    }
                  />
                )}
              </Section>

              {/* ── Clerk live data ────────────────────────────────────── */}
              {detail.clerk ? (
                <>
                  <Separator />
                  <Section
                    title="Clerk"
                    action={
                      <Button
                        size="sm"
                        variant={banned ? 'outline' : 'destructive'}
                        onClick={handleBanToggle}
                      >
                        {banned ? 'Unban' : 'Ban'}
                      </Button>
                    }
                  >
                    <KV k="Primary email" v={detail.clerk.primaryEmail ?? '—'} />
                    <KV k="Phone" v={detail.clerk.primaryPhone ?? '—'} />
                    <KV k="Username" v={detail.clerk.username ?? '—'} />
                    <KV k="Last sign-in" v={formatDate(detail.clerk.lastSignInAt)} />
                    <KV k="Last active" v={formatDate(detail.clerk.lastActiveAt)} />
                    <KV
                      k="Password set"
                      v={detail.clerk.passwordEnabled ? 'Yes' : 'No'}
                    />
                    <KV
                      k="Locked"
                      v={detail.clerk.locked ? 'Yes' : 'No'}
                    />
                    {detail.clerk.externalAccounts.length > 0 && (
                      <KV
                        k="Connected"
                        v={
                          <div className="flex flex-wrap gap-1">
                            {detail.clerk.externalAccounts.map((ea, i) => (
                              <Badge key={`${ea.provider}-${i}`} variant="outline">
                                {ea.provider}
                              </Badge>
                            ))}
                          </div>
                        }
                      />
                    )}
                  </Section>
                </>
              ) : (
                <>
                  <Separator />
                  <p className="text-xs text-muted-foreground">
                    Clerk record could not be fetched. The user may have been
                    deleted upstream, or <code>CLERK_SECRET_KEY</code> is not
                    configured on the API worker.
                  </p>
                </>
              )}

              {/* ── Recent jobs ────────────────────────────────────────── */}
              <Separator />
              <Section title={`Recent jobs (${detail.recentJobs.length})`}>
                {detail.recentJobs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No jobs yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.recentJobs.map((j) => (
                      <div
                        key={j.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {j.templateTitle ?? '(unknown template)'}
                          </div>
                          <div className="text-muted-foreground">
                            {formatDate(j.createdAt)}
                          </div>
                        </div>
                        <Badge
                          variant={
                            j.status === 'completed'
                              ? 'default'
                              : j.status === 'failed'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {j.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ── Credit ledger ──────────────────────────────────────── */}
              <Separator />
              <Section title={`Credit ledger (${detail.recentLedger.length})`}>
                {detail.recentLedger.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No ledger entries.</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.recentLedger.map((l) => (
                      <div
                        key={l.id}
                        className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">
                            {REASON_LABELS[l.reason] ?? l.reason}
                          </div>
                          <div className="text-muted-foreground">
                            {formatDate(l.createdAt)}
                            {l.note ? ` — ${l.note}` : ''}
                          </div>
                        </div>
                        <div className="flex flex-col items-end shrink-0">
                          <span
                            className={`flex items-center gap-1 font-mono ${
                              l.delta >= 0 ? 'text-success' : 'text-destructive'
                            }`}
                          >
                            <Coins className="h-3 w-3" />
                            {l.delta > 0 ? '+' : ''}
                            {l.delta}
                          </span>
                          <span className="text-muted-foreground">
                            → {l.balanceAfter}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-border/60 px-3 py-2.5 ${
        highlight ? 'bg-primary/5' : ''
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
