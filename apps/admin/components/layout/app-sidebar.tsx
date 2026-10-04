'use client';

/**
 * The admin sidebar: grouped, collapsible, and icon-collapsible.
 *
 *   - Groups come from `ADMIN_NAV_GROUPS`; each heading toggles its
 *     group, and the choice is remembered per browser. A group that
 *     holds the current page is always shown open, so the active item
 *     is never hidden.
 *   - An item with `children` (Credits & pricing) shows its sub-pages
 *     indented while the admin is anywhere inside it, or when the
 *     chevron is clicked.
 *   - The whole bar collapses to icons (the header trigger or the rail
 *     on its edge); items then show their title as a tooltip.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { ADMIN_NAV_GROUPS, isNavActive, type AdminNavGroup, type AdminNavItem } from '@/lib/admin-nav';
import { useCan, usePermissionsStore } from '@/lib/stores/permissions-store';
import { cn } from '@/lib/utils';

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  creator: 'Creator',
};

const STORAGE_KEY = 'clickefy.admin.sidebar.groups';

/** Which groups the admin has folded; everything is open until they say otherwise. */
function useFoldedGroups(): [Set<string>, (id: string) => void] {
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setFolded(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* private mode or blocked storage: stay open */
    }
  }, []);
  const toggle = useCallback((id: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [folded, toggle];
}

export function AppSidebar() {
  const pathname = usePathname();
  const can = useCan();
  const me = usePermissionsStore((s) => s.me);
  const { state } = useSidebar();
  const iconMode = state === 'collapsed';
  const [folded, toggleGroup] = useFoldedGroups();

  // Only the doors this admin may open. The API enforces the same keys;
  // this is about not showing what cannot be used.
  const groups = ADMIN_NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((item) => can(item.page)) })).filter(
    (g) => g.items.length > 0,
  );

  const initial = (me?.name ?? me?.email ?? 'A').trim().charAt(0).toUpperCase();
  const roleLabel = me ? (ROLE_LABELS[me.role] ?? me.role) : '';

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 group-data-[collapsible=icon]:p-2">
        <Link href="/admin" className="flex items-center gap-2 overflow-hidden">
          <Image src="/brand/logo-mark.svg" alt="" width={28} height={32} className="shrink-0" />
          <span className="truncate text-lg font-bold tracking-tight group-data-[collapsible=icon]:hidden">Clickefy</span>
        </Link>
      </SidebarHeader>

      <Separator />

      <SidebarContent>
        {groups.map((group) => (
          <NavGroup
            key={group.id}
            group={group}
            pathname={pathname}
            iconMode={iconMode}
            folded={folded.has(group.id)}
            onToggle={() => toggleGroup(group.id)}
          />
        ))}
      </SidebarContent>

      <SidebarFooter className="p-4 group-data-[collapsible=icon]:p-2">
        <div className="flex items-center gap-3 overflow-hidden">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-purple/20 text-sm font-medium text-primary-purple"
            title={me?.email ?? undefined}
          >
            {initial}
          </div>
          <div className="flex min-w-0 flex-col text-sm group-data-[collapsible=icon]:hidden">
            <span className="truncate font-medium">{me?.name ?? me?.email ?? 'Admin'}</span>
            <span className="truncate text-xs text-muted-foreground">
              {roleLabel}
              {me?.name && me?.email ? ` · ${me.email}` : ''}
            </span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function NavGroup({
  group,
  pathname,
  iconMode,
  folded,
  onToggle,
}: {
  group: AdminNavGroup;
  pathname: string;
  iconMode: boolean;
  folded: boolean;
  onToggle: () => void;
}) {
  const containsActive = group.items.some((item) => isNavActive(pathname, item.href));
  // A folded group still shows when the admin is inside it, and every
  // group shows its icons when the bar is collapsed.
  const open = !folded || containsActive || iconMode;
  const menu = (
    <SidebarMenu>
      {group.items.map((item) => (
        <NavItem key={item.href} item={item} pathname={pathname} />
      ))}
    </SidebarMenu>
  );

  if (!group.title) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>{menu}</SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={() => onToggle()}>
      <SidebarGroup>
        <SidebarGroupLabel
          render={
            <CollapsibleTrigger
              className={cn(
                'w-full cursor-pointer justify-between hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                containsActive && 'text-sidebar-foreground',
              )}
              disabled={containsActive}
              title={containsActive ? 'Holds the current page' : open ? 'Collapse group' : 'Expand group'}
            />
          }
        >
          <span className="uppercase tracking-wider">{group.title}</span>
          <ChevronRight className={cn('transition-transform', open && 'rotate-90', containsActive && 'opacity-40')} />
        </SidebarGroupLabel>
        <CollapsiblePanel>
          <SidebarGroupContent>{menu}</SidebarGroupContent>
        </CollapsiblePanel>
      </SidebarGroup>
    </Collapsible>
  );
}

function NavItem({ item, pathname }: { item: AdminNavItem; pathname: string }) {
  const active = isNavActive(pathname, item.href);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const showChildren = Boolean(item.children?.length) && (active || pinnedOpen);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton render={<Link href={item.href} />} isActive={active} tooltip={item.title}>
        <item.icon />
        <span>{item.title}</span>
      </SidebarMenuButton>
      {item.children && item.children.length > 0 && (
        <>
          <SidebarMenuAction
            onClick={(e) => {
              e.preventDefault();
              setPinnedOpen((v) => !v);
            }}
            aria-expanded={showChildren}
            aria-label={showChildren ? `Hide ${item.title} pages` : `Show ${item.title} pages`}
            className={cn('transition-transform', showChildren && 'rotate-90', active && 'pointer-events-none opacity-40')}
          >
            <ChevronRight />
          </SidebarMenuAction>
          {showChildren && (
            <SidebarMenuSub>
              {item.children.map((child) => (
                <SidebarMenuSubItem key={child.href}>
                  <SidebarMenuSubButton render={<Link href={child.href} />} isActive={isNavActive(pathname, child.href, child.exact)}>
                    <span>{child.title}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          )}
        </>
      )}
    </SidebarMenuItem>
  );
}
