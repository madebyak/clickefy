'use client';

/**
 * Reports — moderation queue.
 *
 * Lists user-submitted content flags. Default view shows open
 * reports newest-first; admins can filter by status (open /
 * reviewing / resolved / dismissed / all).
 *
 * Triage flow: click a row → detail dialog → set status + add
 * internal notes. Every PATCH hits `/v1/admin/reports/:id`, which
 * is automatically logged in `admin_audit_log` by the `withAdmin()`
 * middleware (see api/src/middleware/with-auth.ts).
 *
 * No Zustand store — the dataset is small and we mostly read it,
 * so a local `useState` + `useEffect` is enough. If volume ever
 * grows we can swap in the same pattern the users page uses.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import { AlertTriangle, Flag, Loader2 } from 'lucide-react';

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
import { Label } from '@/components/ui/label';
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
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, ApiError } from '@/lib/api';

type ReportReason =
  | 'csam'
  | 'sexual_content'
  | 'violence_or_threats'
  | 'hate_speech'
  | 'harassment'
  | 'spam'
  | 'copyright'
  | 'other';

type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

interface ReportListItem {
  id: string;
  targetType: 'job_output' | 'template' | 'user';
  targetId: string;
  reason: ReportReason;
  notes: string | null;
  status: ReportStatus;
  adminNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  reporterUserId: string | null;
  reporterEmail: string | null;
}

const REASON_LABEL: Record<ReportReason, string> = {
  csam: 'CSAM',
  sexual_content: 'Sexual content',
  violence_or_threats: 'Violence / threats',
  hate_speech: 'Hate speech',
  harassment: 'Harassment',
  spam: 'Spam',
  copyright: 'Copyright',
  other: 'Other',
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  open: 'Open',
  reviewing: 'Reviewing',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

const STATUS_VARIANT: Record<ReportStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  open: 'destructive',
  reviewing: 'default',
  resolved: 'outline',
  dismissed: 'secondary',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function ReportsPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);

  const [items, setItems] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ReportStatus | 'all'>('open');
  const [active, setActive] = useState<ReportListItem | null>(null);

  async function load(filter: ReportStatus | 'all') {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ReportListItem[]>(
        `/v1/admin/reports?status=${filter}&limit=100`,
        { getToken: tokenGetter },
      );
      setItems(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load reports';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // CSAM count is shown front-and-centre so an admin can't miss it
  // even if they're scanning a long queue.
  const csamCount = items.filter((r) => r.reason === 'csam' && r.status === 'open').length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground mt-1">
            User-submitted content flags. Triage CSAM immediately; everything else by SLA.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {csamCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-1.5 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {csamCount} open CSAM report{csamCount === 1 ? '' : 's'}
            </div>
          )}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ReportStatus | 'all')}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="reviewing">Reviewing</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        {loading && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground mt-4 text-sm">Loading reports…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Flag className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">No reports match this filter.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reported</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Reporter</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => setActive(r)}
                >
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDate(r.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.reason === 'csam' ? 'destructive' : 'secondary'}>
                      {REASON_LABEL[r.reason]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-xs uppercase text-muted-foreground">
                        {r.targetType}
                      </span>
                      <span className="font-mono text-xs truncate max-w-[200px]">
                        {r.targetId}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {r.reporterEmail ?? '(deleted user)'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>
                      {STATUS_LABEL[r.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground truncate max-w-[280px]">
                    {r.notes ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ReportDetailDialog
        key={active?.id ?? 'none'}
        report={active}
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) {
            setActive(null);
            void load(statusFilter);
          }
        }}
        tokenGetter={tokenGetter}
      />
    </div>
  );
}

function ReportDetailDialog({
  report,
  open,
  onOpenChange,
  tokenGetter,
}: {
  report: ReportListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokenGetter: () => Promise<string | null>;
}) {
  const [status, setStatus] = useState<ReportStatus>(report?.status ?? 'open');
  const [adminNotes, setAdminNotes] = useState(report?.adminNotes ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(report?.status ?? 'open');
    setAdminNotes(report?.adminNotes ?? '');
  }, [report]);

  async function handleSave() {
    if (!report) return;
    setSaving(true);
    try {
      await apiFetch(`/v1/admin/reports/${report.id}`, {
        method: 'PATCH',
        getToken: tokenGetter,
        json: { status, adminNotes: adminNotes || null },
      });
      toast.success('Report updated');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update report');
    } finally {
      setSaving(false);
    }
  }

  if (!report) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5" />
            Report · {REASON_LABEL[report.reason]}
          </DialogTitle>
          <DialogDescription>
            Filed {formatDate(report.createdAt)} by{' '}
            <span className="font-medium">
              {report.reporterEmail ?? '(deleted user)'}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Target type</Label>
              <p className="font-mono text-sm uppercase">{report.targetType}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Target id</Label>
              <p className="font-mono text-sm break-all">{report.targetId}</p>
            </div>
          </div>

          {report.notes && (
            <div>
              <Label className="text-xs text-muted-foreground">Reporter context</Label>
              <div className="mt-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">
                {report.notes}
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ReportStatus)}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="reviewing">Reviewing</SelectItem>
                <SelectItem value="resolved">Resolved (action taken)</SelectItem>
                <SelectItem value="dismissed">Dismissed (no action)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="admin-notes" className="text-xs text-muted-foreground">
              Internal notes (admin only)
            </Label>
            <Textarea
              id="admin-notes"
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="What action did you take and why?"
              rows={4}
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
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
