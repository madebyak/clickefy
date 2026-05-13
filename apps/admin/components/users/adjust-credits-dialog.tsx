'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import type { AdminUserListItem } from '@clickfy/types';

import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { useUsersStore } from '@/lib/stores/users-store';

interface AdjustCreditsDialogProps {
  user: AdminUserListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AdjustCreditsDialog({
  user,
  open,
  onOpenChange,
}: AdjustCreditsDialogProps) {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);
  const adjustCredits = useUsersStore((s) => s.adjustCredits);

  // State is reset by parent remounting via `key={user?.id}` rather
  // than via a useEffect — this keeps us aligned with React 19 /
  // Compiler purity rules (no setState-in-effect).
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const parsedDelta = Number.parseInt(delta, 10);
  const isValid = Number.isFinite(parsedDelta) && parsedDelta !== 0;
  const projected =
    isValid ? user.creditsBalance + parsedDelta : user.creditsBalance;
  const wouldGoNegative = projected < 0;

  async function handleSubmit() {
    if (!isValid || wouldGoNegative || !user) return;
    setSubmitting(true);
    try {
      await adjustCredits(
        user.id,
        { delta: parsedDelta, note: note.trim() || undefined },
        tokenGetter,
      );
      toast.success(
        `${parsedDelta > 0 ? 'Granted' : 'Deducted'} ${Math.abs(parsedDelta)} credits`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to adjust credits');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust credits</DialogTitle>
          <DialogDescription>
            Update {user.name ?? user.email}&apos;s balance. Use a negative
            number to deduct. This is logged to the credit ledger as
            <code className="mx-1 px-1 py-0.5 rounded bg-muted text-xs">admin_adjust</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="credits-delta">Amount</Label>
            <Input
              id="credits-delta"
              type="number"
              inputMode="numeric"
              autoFocus
              placeholder="e.g. 50 or -10"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Current: <strong>{user.creditsBalance}</strong>
              {isValid && (
                <>
                  {' → After: '}
                  <strong className={wouldGoNegative ? 'text-destructive' : ''}>
                    {projected}
                  </strong>
                </>
              )}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="credits-note">Note (optional)</Label>
            <Textarea
              id="credits-note"
              rows={2}
              placeholder="e.g. Goodwill credit for failed generation"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || wouldGoNegative || submitting}
          >
            {submitting ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
