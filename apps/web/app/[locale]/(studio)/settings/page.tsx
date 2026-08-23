"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { ArrowSquareOut, Camera, Lightning, LockSimple, SignOut, Trash } from "@phosphor-icons/react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getSDK } from "@/lib/api";
import { useSession } from "@/lib/use-session";
import { useCredits } from "@/lib/use-credits";
import { useBillingActions } from "@/lib/use-billing-actions";
import { cn } from "@/lib/utils";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-surface-2 p-5">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const ta = useTranslations("account");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { user, plan, updateProfile, uploadAvatar, signOut } = useSession();
  const creditsQuery = useCredits();
  const { openPortal, portalPending } = useBillingActions();
  const tp = useTranslations("pricing");
  const fileInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (user?.name != null) setName(user.name);
  }, [user?.name]);

  const onDeleteAccount = async () => {
    setDeleting(true);
    try {
      // Server soft-deletes + anonymises immediately and schedules the
      // 30-day asset purge; Clerk-side deletion cascades from the API.
      await getSDK().user.deleteAccount();
      await signOut();
    } catch {
      toast.error(t("deleteFailed"));
      setDeleting(false);
    }
  };

  if (!user) {
    return (
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="h-8 w-40 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-48 animate-pulse rounded-2xl bg-surface-2" />
          <div className="h-32 animate-pulse rounded-2xl bg-surface-2" />
        </div>
      </main>
    );
  }

  const displayName = user.name?.trim() || user.email.split("@")[0];
  const initials =
    displayName
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  const buckets = creditsQuery.data?.buckets;
  const nameDirty = name.trim() !== (user.name ?? "").trim();

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast.error(t("avatarTooLarge"));
      return;
    }
    try {
      await uploadAvatar.mutateAsync(file);
      toast.success(t("avatarUpdated"));
    } catch {
      toast.error(t("avatarFailed"));
    }
  };

  const onSaveName = async () => {
    try {
      await updateProfile.mutateAsync({ name: name.trim() });
      toast.success(t("profileSaved"));
    } catch {
      toast.error(t("profileFailed"));
    }
  };

  const onLocaleChange = async (next: "en" | "ar") => {
    if (next === locale) return;
    // Persist the preference server-side (mobile reads it too), then
    // switch the route locale.
    updateProfile.mutate({ locale: next });
    router.replace(pathname, { locale: next });
  };

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-4 pb-16">
        <h1 className="text-xl font-semibold">{t("title")}</h1>

        {/* Profile */}
        <Section title={t("profile")}>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={t("changePhoto")}
            >
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt={displayName}
                  className="size-16 rounded-full object-cover"
                />
              ) : (
                <span className="grid size-16 place-items-center rounded-full bg-brand-purple text-lg font-semibold text-white">
                  {initials}
                </span>
              )}
              <span
                className={cn(
                  "absolute inset-0 grid place-items-center rounded-full bg-black/50 text-white transition-opacity",
                  uploadAvatar.isPending ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                <Camera className="size-5" />
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                void onPickAvatar(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <label htmlFor="name" className="text-xs text-muted-foreground">
                  {t("name")}
                </label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("namePlaceholder")}
                    maxLength={80}
                  />
                  <Button
                    size="sm"
                    className="h-9 shrink-0"
                    disabled={!nameDirty || !name.trim() || updateProfile.isPending}
                    onClick={onSaveName}
                  >
                    {updateProfile.isPending ? t("saving") : t("save")}
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("email")}</p>
                <p className="mt-1 truncate text-sm">{user.email}</p>
              </div>
            </div>
          </div>
        </Section>

        {/* Plan & credits */}
        <Section title={t("plan")}>
          <div className="flex items-center justify-between">
            <div>
              <span className="inline-flex rounded-md bg-primary/15 px-2 py-0.5 text-sm font-medium text-primary">
                {ta("planLabel", { plan: plan.tier })}
              </span>
              {user.subscriptionRenewsAt && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("renewsOn", {
                    date: new Date(user.subscriptionRenewsAt).toLocaleDateString(locale),
                  })}
                </p>
              )}
            </div>
            <p className="flex items-center gap-1.5 text-2xl font-semibold tabular-nums">
              <Lightning weight="fill" className="size-5 text-primary" />
              {creditsQuery.data?.total ?? user.creditsBalance}
            </p>
          </div>
          {buckets && (
            <div className="mt-4 space-y-1.5 rounded-lg bg-surface-1 p-3 text-sm">
              {buckets.promo > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{ta("promo")}</span>
                  <span className="tabular-nums">{buckets.promo}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">{ta("subscription")}</span>
                <span className="tabular-nums">{buckets.subscription}</span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  {ta("topup")}
                  {!creditsQuery.data?.topupSpendable && <LockSimple className="size-3.5" />}
                </span>
                <span className="tabular-nums">{buckets.topup}</span>
              </div>
            </div>
          )}

          {/* Self-service billing. Stripe's portal handles cancellation,
              plan changes, card updates and invoice history — all of which
              would otherwise mean reimplementing proration and dunning UI
              that Stripe already gets right.

              Shown only to people who actually subscribed HERE. A store
              subscriber cannot be managed from Stripe at all; sending them
              to a portal that does not know about their subscription would
              be worse than showing nothing. */}
          {user.subscriptionPlatform === "stripe" && (
            <button
              type="button"
              onClick={() => void openPortal()}
              disabled={portalPending}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "mt-4 w-full justify-between",
                portalPending && "pointer-events-none opacity-60",
              )}
            >
              {portalPending ? tp("starting") : tp("manageSubscription")}
              <ArrowSquareOut className="size-4 rtl:-scale-x-100" />
            </button>
          )}
        </Section>

        {/* Language */}
        <Section title={t("language")}>
          <div className="flex gap-2">
            {(["en", "ar"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => void onLocaleChange(l)}
                className={cn(
                  "rounded-lg border px-4 py-2 text-sm transition-colors",
                  locale === l
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
                )}
              >
                {l === "en" ? t("english") : t("arabic")}
              </button>
            ))}
          </div>
        </Section>

        {/* Sign out */}
        <Section title={t("session")}>
          <Button
            variant="ghost"
            className="text-status-red hover:bg-status-red/10 hover:text-status-red"
            onClick={() => void signOut()}
          >
            <SignOut className="size-4 rtl:-scale-x-100" /> {ta("signOut")}
          </Button>
        </Section>

        {/* Danger zone — account deletion (Apple 5.1.1(v) / Play parity) */}
        <Section title={t("dangerZone")}>
          <p className="text-sm text-muted-foreground">{t("dangerBody")}</p>
          <Button
            variant="ghost"
            disabled={deleting}
            className="mt-4 border border-status-red/40 text-status-red hover:bg-status-red/10 hover:text-status-red"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash className="size-4" /> {deleting ? t("deleting") : t("deleteAccount")}
          </Button>
        </Section>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title={t("confirmDeleteTitle")}
        body={t("confirmDeleteBody")}
        confirmLabel={t("confirmDeleteAction")}
        cancelLabel={t("cancel")}
        onConfirm={() => {
          setConfirmingDelete(false);
          void onDeleteAccount();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </main>
  );
}
