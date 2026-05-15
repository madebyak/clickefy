'use client';

/**
 * Push broadcasts.
 *
 * Compose a title + body, pick an audience (all / by entitlement / by
 * platform / by explicit user-id list), preview the recipient count,
 * then send. The backend resolves tokens, sends the first 100
 * synchronously, and `waitUntil`s the rest — so the admin sees a
 * "first batch" result immediately even on a large blast.
 *
 * Every send is recorded in `admin_audit_log` automatically by the
 * `withAdmin()` middleware on the API side.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import { AlertTriangle, Bell, Loader2, Send, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, ApiError } from '@/lib/api';

type AudienceType = 'all' | 'entitlement' | 'platform' | 'userIds';

interface PreviewData {
  recipientCount: number;
  distinctUsers: number;
}

interface BroadcastResult {
  recipientCount: number;
  firstBatch: { sent: number; failed: number; deactivated: number };
  queuedRemaining: number;
  warning?: 'no_active_devices';
}

interface PushStats {
  totalActive: number;
  ios: number;
  android: number;
  other: number;
}

interface TestPushResult {
  recipientCount: number;
  sent: number;
  failed: number;
  deactivated: number;
  firstError: { token: string; message?: string; errorType?: string } | null;
}

const ENTITLEMENT_OPTIONS = ['free', 'pro', 'pro_max'] as const;
const PLATFORM_OPTIONS = ['ios', 'android'] as const;

export default function PushBroadcastPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audienceType, setAudienceType] = useState<AudienceType>('all');
  const [entitlement, setEntitlement] = useState<(typeof ENTITLEMENT_OPTIONS)[number]>('free');
  const [platform, setPlatform] = useState<(typeof PLATFORM_OPTIONS)[number]>('ios');
  const [userIdsRaw, setUserIdsRaw] = useState('');

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<BroadcastResult | null>(null);
  const [stats, setStats] = useState<PushStats | null>(null);
  const [testing, setTesting] = useState(false);

  // Fetch device-token stats so we can render a "0 devices registered"
  // warning before the admin wastes a broadcast on an empty audience.
  useEffect(() => {
    let cancelled = false;
    void apiFetch<PushStats>('/v1/admin/push/stats', { getToken: tokenGetter })
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        /* non-critical; banner just won't appear */
      });
    return () => {
      cancelled = true;
    };
  }, [tokenGetter]);

  async function runTestPush() {
    setTesting(true);
    try {
      const data = await apiFetch<TestPushResult>('/v1/admin/push/test', {
        method: 'POST',
        getToken: tokenGetter,
        json: {},
      });
      if (data.sent > 0) {
        toast.success(`Test push sent to ${data.sent} device${data.sent === 1 ? '' : 's'}.`);
      } else if (data.firstError) {
        toast.error(
          `Send returned 0 successes. First error: ${data.firstError.errorType ?? data.firstError.message ?? 'unknown'}`,
        );
      } else {
        toast.warning('Push delivered to Expo but no successful ticket received.');
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'no_device_for_admin') {
        toast.warning(
          'No device registered for your account yet. Sign in to the mobile app on a physical device first.',
          { duration: 8000 },
        );
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Test push failed');
      }
    } finally {
      setTesting(false);
    }
  }

  const audience = useMemo(() => {
    if (audienceType === 'all') return { type: 'all' as const };
    if (audienceType === 'entitlement') {
      return { type: 'entitlement' as const, value: entitlement };
    }
    if (audienceType === 'platform') {
      return { type: 'platform' as const, value: platform };
    }
    const ids = userIdsRaw
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { type: 'userIds' as const, value: ids };
  }, [audienceType, entitlement, platform, userIdsRaw]);

  const audienceLooksValid =
    audience.type !== 'userIds' || audience.value.length > 0;

  async function runPreview() {
    if (!audienceLooksValid) {
      toast.error('Add at least one user id.');
      return;
    }
    setPreviewing(true);
    setPreview(null);
    try {
      const data = await apiFetch<PreviewData>('/v1/admin/push/preview', {
        method: 'POST',
        getToken: tokenGetter,
        json: {
          title: title.trim() || 'preview',
          body: body.trim() || 'preview',
          audience,
        },
      });
      setPreview(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Preview failed';
      toast.error(msg);
    } finally {
      setPreviewing(false);
    }
  }

  async function runSend() {
    if (!title.trim() || !body.trim()) {
      toast.error('Title and body are required.');
      return;
    }
    if (!audienceLooksValid) {
      toast.error('Add at least one user id.');
      return;
    }
    const audienceLabel =
      audience.type === 'all'
        ? 'every active device'
        : audience.type === 'entitlement'
          ? `all ${audience.value} users`
          : audience.type === 'platform'
            ? `all ${audience.value} devices`
            : `${audience.value.length} explicit users`;
    if (!confirm(`Send "${title.trim()}" to ${audienceLabel}?`)) return;

    setSending(true);
    setLastResult(null);
    try {
      const data = await apiFetch<BroadcastResult>('/v1/admin/push/broadcast', {
        method: 'POST',
        getToken: tokenGetter,
        json: { title: title.trim(), body: body.trim(), audience },
      });
      setLastResult(data);
      if (data.warning === 'no_active_devices') {
        toast.warning(
          'No devices are registered. The send succeeded but reached 0 users — check that the mobile app is installed and signed-in.',
          { duration: 8000 },
        );
      } else if (data.firstBatch.sent === 0) {
        toast.warning(
          `Sent to 0 of ${data.recipientCount} devices. ${data.firstBatch.deactivated} stale tokens deactivated.`,
        );
      } else {
        toast.success(
          `Sent to ${data.firstBatch.sent} devices (${data.queuedRemaining} more queued).`,
        );
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Broadcast failed';
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-primary-purple" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Push broadcasts</h1>
            <p className="text-sm text-muted-foreground">
              Send a notification to a segment of users. The first 100 devices fire
              synchronously; the rest are queued in the background.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={runTestPush} disabled={testing}>
          {testing ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-1 h-4 w-4" />
          )}
          Send test to me
        </Button>
      </div>

      {stats && stats.totalActive === 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
          <div className="flex-1 text-sm">
            <p className="font-medium">No devices are registered for push.</p>
            <p className="mt-1 text-muted-foreground">
              Until at least one user signs in to the mobile app on a physical device
              (or a development build), every broadcast will reach 0 recipients. iOS
              works in Expo Go; Android requires an EAS Build (SDK 53+).
            </p>
          </div>
        </div>
      ) : stats ? (
        <div className="rounded-lg border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          {stats.totalActive} active device{stats.totalActive === 1 ? '' : 's'} registered ·{' '}
          {stats.ios} iOS · {stats.android} Android
          {stats.other > 0 ? ` · ${stats.other} other` : ''}
        </div>
      ) : null}

      <div className="space-y-4 rounded-2xl border bg-card p-6">
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Your weekly free credits are ready"
            maxLength={80}
          />
          <p className="text-xs text-muted-foreground">{title.length}/80</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="body">Body</Label>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Tap to see what's new this week."
            rows={3}
            maxLength={240}
          />
          <p className="text-xs text-muted-foreground">{body.length}/240</p>
        </div>

        <div className="space-y-2">
          <Label>Audience</Label>
          <Select value={audienceType} onValueChange={(v) => setAudienceType(v as AudienceType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              <SelectItem value="entitlement">By entitlement (free / pro / pro_max)</SelectItem>
              <SelectItem value="platform">By platform (iOS / Android)</SelectItem>
              <SelectItem value="userIds">Specific user ids</SelectItem>
            </SelectContent>
          </Select>

          {audienceType === 'entitlement' ? (
            <Select value={entitlement} onValueChange={(v) => setEntitlement(v as typeof entitlement)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITLEMENT_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {audienceType === 'platform' ? (
            <Select value={platform} onValueChange={(v) => setPlatform(v as typeof platform)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORM_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {audienceType === 'userIds' ? (
            <Textarea
              value={userIdsRaw}
              onChange={(e) => setUserIdsRaw(e.target.value)}
              placeholder="Paste UUIDs separated by commas, spaces, or newlines (max 1000)."
              rows={4}
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={runPreview}
            disabled={previewing || !audienceLooksValid}
          >
            {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Preview recipient count
          </Button>

          <Button
            type="button"
            onClick={runSend}
            disabled={sending || !audienceLooksValid || !title.trim() || !body.trim()}
          >
            {sending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Send broadcast
          </Button>
        </div>

        {preview ? (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm">
            <p>
              This will reach <strong>{preview.recipientCount}</strong> active devices across{' '}
              <strong>{preview.distinctUsers}</strong> distinct users.
            </p>
          </div>
        ) : null}

        {lastResult ? (
          <div className="rounded-lg border border-emerald-300/40 bg-emerald-500/10 p-4 text-sm">
            <p className="font-medium">Broadcast queued.</p>
            <ul className="mt-2 list-inside list-disc text-muted-foreground">
              <li>Total recipients: {lastResult.recipientCount}</li>
              <li>First batch sent: {lastResult.firstBatch.sent}</li>
              <li>First batch failed: {lastResult.firstBatch.failed}</li>
              <li>Tokens deactivated (DeviceNotRegistered): {lastResult.firstBatch.deactivated}</li>
              <li>Queued in background: {lastResult.queuedRemaining}</li>
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
