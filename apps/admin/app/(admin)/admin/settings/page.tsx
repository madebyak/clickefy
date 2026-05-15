'use client';

/**
 * Settings — platform-wide configuration.
 *
 * MOCK DATA today; nothing actually persists. The shapes match what
 * a future `GET /v1/admin/settings` + `PATCH /v1/admin/settings`
 * endpoint pair would return. Best place for the source of truth is
 * a `platform_settings` singleton row in Postgres (Drizzle), so the
 * Worker can read it once per request and cache via `withDb`.
 *
 *   const { data } = useQuery({
 *     queryKey: ['admin', 'settings'],
 *     queryFn:  () => apiFetch<PlatformSettings>('/v1/admin/settings', { tokenGetter }),
 *   });
 */

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Bell,
  Coins,
  Database,
  Lock,
  Save,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

type PlatformSettings = {
  signupBonusCredits: number;
  freeUserMonthlyCap: number;
  defaultJobTimeoutSec: number;
  jobRetentionDays: number;
  idempotencyWindowMin: number;
};

type ProviderSettings = {
  gemini: { enabled: boolean; defaultImageModel: string; timeoutSec: number };
  kling: { enabled: boolean; defaultVideoModel: string; pollIntervalSec: number };
};

type PushSettings = {
  enabled: boolean;
  senderName: string;
  defaultJobCompletedTitle: string;
  defaultJobFailedTitle: string;
};

// MOCK DATA — replace with real GET /v1/admin/settings
const initialPlatform: PlatformSettings = {
  signupBonusCredits: 30,
  freeUserMonthlyCap: 10,
  defaultJobTimeoutSec: 300,
  jobRetentionDays: 90,
  idempotencyWindowMin: 30,
};

const initialProviders: ProviderSettings = {
  gemini: {
    enabled: true,
    defaultImageModel: 'gemini-2.5-flash-image',
    timeoutSec: 30,
  },
  kling: {
    enabled: true,
    defaultVideoModel: 'kling-v1-6',
    pollIntervalSec: 5,
  },
};

const initialPush: PushSettings = {
  enabled: true,
  senderName: 'Clickefy',
  defaultJobCompletedTitle: 'Your generation is ready',
  defaultJobFailedTitle: "Something went wrong — we've refunded your credits",
};

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
        value
          ? 'border-primary bg-primary'
          : 'border-border bg-muted'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
          value ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
  footer,
}: {
  icon: typeof SettingsIcon;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3 space-y-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold leading-none">{title}</h3>
          <CardDescription className="mt-1.5">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
      {footer && (
        <>
          <Separator />
          <div className="flex justify-end px-6 py-4">{footer}</div>
        </>
      )}
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const [platform, setPlatform] = useState<PlatformSettings>(initialPlatform);
  const [providers, setProviders] = useState<ProviderSettings>(initialProviders);
  const [push, setPush] = useState<PushSettings>(initialPush);

  function notImplemented(section: string) {
    toast.info(`${section} save coming soon`, {
      description:
        'Settings persistence is mocked — values reset on reload until the API endpoint is wired.',
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Platform-wide defaults, provider toggles, and push notification copy.
        </p>
      </div>

      <SectionCard
        icon={Coins}
        title="Credits & quotas"
        description="Default credit grants, free-tier limits and idempotency policy."
        footer={
          <Button onClick={() => notImplemented('Credits & quotas')}>
            <Save className="h-4 w-4 mr-2" />
            Save changes
          </Button>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Signup bonus credits"
            hint="Granted on first sign-up via the Clerk webhook."
          >
            <Input
              type="number"
              min={0}
              value={platform.signupBonusCredits}
              onChange={(e) =>
                setPlatform({
                  ...platform,
                  signupBonusCredits: Number(e.target.value),
                })
              }
            />
          </Field>
          <Field
            label="Free-tier monthly generations"
            hint="Cap before paywall is shown to free users."
          >
            <Input
              type="number"
              min={0}
              value={platform.freeUserMonthlyCap}
              onChange={(e) =>
                setPlatform({
                  ...platform,
                  freeUserMonthlyCap: Number(e.target.value),
                })
              }
            />
          </Field>
          <Field
            label="Default job timeout (seconds)"
            hint="Stuck-job cron force-fails jobs over this threshold."
          >
            <Input
              type="number"
              min={30}
              value={platform.defaultJobTimeoutSec}
              onChange={(e) =>
                setPlatform({
                  ...platform,
                  defaultJobTimeoutSec: Number(e.target.value),
                })
              }
            />
          </Field>
          <Field
            label="Idempotency window (minutes)"
            hint="POST /v1/jobs uses Idempotency-Key for this window."
          >
            <Input
              type="number"
              min={1}
              value={platform.idempotencyWindowMin}
              onChange={(e) =>
                setPlatform({
                  ...platform,
                  idempotencyWindowMin: Number(e.target.value),
                })
              }
            />
          </Field>
          <Field
            label="Job retention (days)"
            hint="`purge_at` is set this many days after `createdAt`."
          >
            <Input
              type="number"
              min={1}
              value={platform.jobRetentionDays}
              onChange={(e) =>
                setPlatform({
                  ...platform,
                  jobRetentionDays: Number(e.target.value),
                })
              }
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        icon={Sparkles}
        title="Providers"
        description="Toggle providers off to halt new dispatches without breaking in-flight jobs."
        footer={
          <Button onClick={() => notImplemented('Providers')}>
            <Save className="h-4 w-4 mr-2" />
            Save changes
          </Button>
        }
      >
        {/* Gemini */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">Gemini / Imagen</h4>
                {providers.gemini.enabled ? (
                  <Badge variant="default">Active</Badge>
                ) : (
                  <Badge variant="outline">Disabled</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Image generation, fast iterations, low credit cost.
              </p>
            </div>
            <Toggle
              label="Toggle Gemini"
              value={providers.gemini.enabled}
              onChange={(v) =>
                setProviders({
                  ...providers,
                  gemini: { ...providers.gemini, enabled: v },
                })
              }
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Default image model">
              <Input
                value={providers.gemini.defaultImageModel}
                onChange={(e) =>
                  setProviders({
                    ...providers,
                    gemini: {
                      ...providers.gemini,
                      defaultImageModel: e.target.value,
                    },
                  })
                }
              />
            </Field>
            <Field label="Timeout (seconds)">
              <Input
                type="number"
                min={5}
                value={providers.gemini.timeoutSec}
                onChange={(e) =>
                  setProviders({
                    ...providers,
                    gemini: {
                      ...providers.gemini,
                      timeoutSec: Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
          </div>
        </div>

        <Separator />

        {/* Kling */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">Kling</h4>
                {providers.kling.enabled ? (
                  <Badge variant="default">Active</Badge>
                ) : (
                  <Badge variant="outline">Disabled</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Video generation, longer runtimes, higher credit cost.
              </p>
            </div>
            <Toggle
              label="Toggle Kling"
              value={providers.kling.enabled}
              onChange={(v) =>
                setProviders({
                  ...providers,
                  kling: { ...providers.kling, enabled: v },
                })
              }
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Default video model">
              <Input
                value={providers.kling.defaultVideoModel}
                onChange={(e) =>
                  setProviders({
                    ...providers,
                    kling: {
                      ...providers.kling,
                      defaultVideoModel: e.target.value,
                    },
                  })
                }
              />
            </Field>
            <Field label="Poll interval (seconds)">
              <Input
                type="number"
                min={1}
                value={providers.kling.pollIntervalSec}
                onChange={(e) =>
                  setProviders({
                    ...providers,
                    kling: {
                      ...providers.kling,
                      pollIntervalSec: Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        icon={Bell}
        title="Push notifications"
        description="Default copy used by the jobs-worker when it pings users via Expo."
        footer={
          <Button onClick={() => notImplemented('Push notifications')}>
            <Save className="h-4 w-4 mr-2" />
            Save changes
          </Button>
        }
      >
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold">Push enabled</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Disable to silence all outbound pushes (admin broadcasts and job
              completion notifications).
            </p>
          </div>
          <Toggle
            label="Toggle push"
            value={push.enabled}
            onChange={(v) => setPush({ ...push, enabled: v })}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Sender name">
            <Input
              value={push.senderName}
              onChange={(e) => setPush({ ...push, senderName: e.target.value })}
            />
          </Field>
          <Field label="Job completed — title">
            <Input
              value={push.defaultJobCompletedTitle}
              onChange={(e) =>
                setPush({ ...push, defaultJobCompletedTitle: e.target.value })
              }
            />
          </Field>
          <Field label="Job failed — title" hint="Shown when refundForJob runs.">
            <Input
              value={push.defaultJobFailedTitle}
              onChange={(e) =>
                setPush({ ...push, defaultJobFailedTitle: e.target.value })
              }
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        icon={Lock}
        title="Secrets & integrations"
        description="Read-only — values live in Cloudflare Workers secrets and your Trigger.dev project."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          {[
            { name: 'CLERK_JWT_KEY', ok: true, source: 'Workers secret' },
            { name: 'DATABASE_URL', ok: true, source: 'Workers secret' },
            { name: 'TRIGGER_SECRET_KEY', ok: true, source: 'Workers secret' },
            { name: 'INTERNAL_API_SECRET', ok: true, source: 'Workers + jobs-worker' },
            { name: 'GEMINI_API_KEY', ok: true, source: 'jobs-worker env' },
            { name: 'KLING_ACCESS_KEY / SECRET', ok: true, source: 'jobs-worker env' },
            { name: 'CLERK_WEBHOOK_SECRET', ok: true, source: 'Workers secret' },
            { name: 'REVENUECAT_WEBHOOK_SECRET', ok: false, source: 'Pending' },
          ].map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
            >
              <div>
                <div className="font-mono text-xs">{s.name}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {s.source}
                </div>
              </div>
              {s.ok ? (
                <Badge variant="default">Set</Badge>
              ) : (
                <Badge variant="outline">Missing</Badge>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <Database className="h-3 w-3" />
          Status is mocked. Wire to a server-side check that probes each secret
          without exposing values.
        </p>
      </SectionCard>

      <SectionCard
        icon={AlertTriangle}
        title="Danger zone"
        description="Destructive operations. Logged to admin_audit_log."
      >
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold text-destructive">
              Purge soft-deleted users now
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Forces the 60-day retention sweep early. Runs the same code path
              the scheduled cron uses.
            </p>
          </div>
          <Button
            variant="destructive"
            onClick={() => notImplemented('Purge sweep')}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Run purge sweep
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
