'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import {
  ADMIN_NAV_ITEMS,
  ADMIN_SUPERADMIN_NAV_ITEMS,
  type AdminNavItem,
} from '@/lib/admin-nav';
import { useCan, usePermissionsStore } from '@/lib/stores/permissions-store';

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  creator: 'Creator',
};

export function AppSidebar() {
  const pathname = usePathname();
  const can = useCan();
  const me = usePermissionsStore((s) => s.me);

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  };

  // Filter by the effective page set resolved from `/v1/admin/me`. The
  // API enforces the same keys, so this is purely about not showing a
  // door the user can't open.
  const mainItems = ADMIN_NAV_ITEMS.filter((item) => can(item.page));
  const superadminItems = ADMIN_SUPERADMIN_NAV_ITEMS.filter((item) => can(item.page));

  const renderItem = (item: AdminNavItem) => (
    <SidebarMenuItem key={item.href}>
      <SidebarMenuButton
        render={<Link href={item.href} />}
        isActive={isActive(item.href)}
        tooltip={item.title}
      >
        <item.icon />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  const initial = (me?.name ?? me?.email ?? 'A').trim().charAt(0).toUpperCase();
  const roleLabel = me ? (ROLE_LABELS[me.role] ?? me.role) : '';

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/admin" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold tracking-tight">Clickefy</span>
        </Link>
      </SidebarHeader>

      <Separator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{mainItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {superadminItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Superadmin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{superadminItems.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-purple/20 text-sm font-medium text-primary-purple">
            {initial}
          </div>
          <div className="flex min-w-0 flex-col text-sm">
            <span className="truncate font-medium">{me?.name ?? me?.email ?? 'Admin'}</span>
            <span className="text-xs text-muted-foreground">
              {roleLabel}
              {me?.name && me?.email ? ` · ${me.email}` : ''}
            </span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
