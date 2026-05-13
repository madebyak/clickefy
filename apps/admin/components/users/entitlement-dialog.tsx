'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import type { AdminUserListItem, UserEntitlement } from '@clickfy/types';

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
import { useUsersStore } from '@/lib/stores/users-store';

interface EntitlementDialogProps {
  user: AdminUserListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ENTITLEMENT_LABELS: Record<UserEntitlement, string> = {
  free: 'Free',
  pro: 'Pro',
  pro_max: 'Pro Max',
  admin: 'Admin',
};

export function EntitlementDialog({
  user,
  open,
  onOpenChange,
}: EntitlementDialogProps) {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);
  const setEntitlement = useUsersStore((s) => s.setEntitlement);

  // Initial value comes from props on mount; parent remounts this
  // dialog via `key={user?.id}` so a different user starts fresh.
  const [value, setValue] = useState<UserEntitlement>(user?.entitlement ?? 'free');
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const dirty = value !== user.entitlement;

  async function handleSubmit() {
    if (!dirty || !user) return;
    setSubmitting(true);
    try {
      await setEntitlement(user.id, value, tokenGetter);
      toast.success(`Entitlement set to ${ENTITLEMENT_LABELS[value]}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update entitlement');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change entitlement</DialogTitle>
          <DialogDescription>
            {user.name ?? user.email} is currently{' '}
            <strong>{ENTITLEMENT_LABELS[user.entitlement]}</strong>. Promoting
            to <code>admin</code> grants full dashboard access — use sparingly.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2">
          <Label htmlFor="entitlement-select">Entitlement</Label>
          <Select
            value={value}
            onValueChange={(v) => setValue(v as UserEntitlement)}
          >
            <SelectTrigger id="entitlement-select">
              <SelectValue>
                {(v) =>
                  ENTITLEMENT_LABELS[v as UserEntitlement] ??
                  ENTITLEMENT_LABELS.free
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ENTITLEMENT_LABELS) as UserEntitlement[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {ENTITLEMENT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!dirty || submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
