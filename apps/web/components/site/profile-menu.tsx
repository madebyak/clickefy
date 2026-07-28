"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { GearSix, Images, CreditCard, Question, SignOut } from "@phosphor-icons/react";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { useSession } from "@/lib/use-session";
import { cn } from "@/lib/utils";

function Avatar({
  name,
  avatarUrl,
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        className={cn("size-8 shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-foreground",
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}

export function ProfileMenu() {
  const t = useTranslations("account");
  const router = useRouter();
  const { user, plan, meQuery, signOut } = useSession();

  // Skeleton while the /me bootstrap is in flight (studio is auth-gated,
  // so this is a brief flash, not a signed-out state).
  if (!user) {
    return (
      <span
        aria-hidden
        className={cn(
          "size-8 shrink-0 rounded-full bg-surface-3",
          meQuery.isLoading && "animate-pulse",
        )}
      />
    );
  }

  const name = user.name?.trim() || user.email.split("@")[0];

  return (
    <Menu
      align="end"
      panelClassName="w-64"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={t("accountMenu")}
          className="rounded-full outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar name={name} avatarUrl={user.avatarUrl} />
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar name={name} avatarUrl={user.avatarUrl} className="size-9" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="px-2 pb-1">
            <span className="inline-flex rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
              {t("planLabel", { plan: plan.tier })}
            </span>
          </div>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              close();
              router.push("/projects");
            }}
          >
            <Images className="size-4 text-muted-foreground" /> {t("myProjects")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              close();
              router.push("/settings");
            }}
          >
            <CreditCard className="size-4 text-muted-foreground" /> {t("billing")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              close();
              router.push("/settings");
            }}
          >
            <GearSix className="size-4 text-muted-foreground" /> {t("settings")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              close();
              window.location.href = "mailto:support@clickefy.ai";
            }}
          >
            <Question className="size-4 text-muted-foreground" /> {t("help")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              close();
              void signOut();
            }}
            className="text-status-red hover:bg-status-red/10"
          >
            <SignOut className="size-4 rtl:-scale-x-100" /> {t("signOut")}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
