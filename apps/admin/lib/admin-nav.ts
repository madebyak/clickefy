/**
 * Single source of truth for the admin sidebar navigation and the
 * page-level route guard. Each entry binds a sidebar section to its
 * `AdminPageKey` capability, so the sidebar filter and the deep-link
 * guard read from the exact same map (no drift between "what's shown"
 * and "what's allowed"). The API enforces the same keys server-side via
 * `withAdmin({ page })` — this is the mirror, never the gate.
 */

import {
  Activity,
  BarChart3,
  Bell,
  Briefcase,
  Coins,
  FileText,
  Flag,
  FolderTree,
  Home,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { AdminPageKey } from '@clickfy/types';

export interface AdminNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  page: AdminPageKey;
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { title: 'Dashboard', href: '/admin', icon: LayoutDashboard, page: 'dashboard' },
  { title: 'Templates', href: '/admin/templates', icon: FileText, page: 'templates' },
  { title: 'Home', href: '/admin/home', icon: Home, page: 'home' },
  { title: 'Categories', href: '/admin/categories', icon: FolderTree, page: 'categories' },
  { title: 'Users', href: '/admin/users', icon: Users, page: 'users' },
  { title: 'Jobs & Runs', href: '/admin/jobs', icon: Briefcase, page: 'jobs' },
  { title: 'Reports', href: '/admin/reports', icon: Flag, page: 'reports' },
  { title: 'Push', href: '/admin/push', icon: Bell, page: 'push' },
  { title: 'Credits', href: '/admin/credits', icon: Coins, page: 'credits' },
  { title: 'Analytics', href: '/admin/analytics', icon: BarChart3, page: 'analytics' },
  { title: 'Settings', href: '/admin/settings', icon: Settings, page: 'settings' },
];

/**
 * Superadmin-only sections, rendered in their own sidebar group. Kept
 * separate so they can be visually grouped and never leak into the main
 * nav for lower roles.
 */
export const ADMIN_SUPERADMIN_NAV_ITEMS: AdminNavItem[] = [
  { title: 'Team & Roles', href: '/admin/team', icon: ShieldCheck, page: 'team' },
  { title: 'Monitoring', href: '/admin/monitoring', icon: Activity, page: 'monitoring' },
];

const ALL_NAV_ITEMS = [...ADMIN_NAV_ITEMS, ...ADMIN_SUPERADMIN_NAV_ITEMS];

/** Human-readable label for a page key (for permission editors / filters). */
export const PAGE_TITLES: Record<AdminPageKey, string> = ALL_NAV_ITEMS.reduce(
  (acc, item) => {
    acc[item.page] = item.title;
    return acc;
  },
  {} as Record<AdminPageKey, string>,
);

/**
 * Resolve which page a pathname belongs to via longest-prefix match, so
 * nested routes (`/admin/templates/abc/edit`) map to their section. The
 * root `/admin` is matched exactly to avoid swallowing everything.
 */
export function pageForPathname(pathname: string): AdminPageKey | null {
  let best: AdminNavItem | null = null;
  for (const item of ALL_NAV_ITEMS) {
    const matches =
      item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
    if (!matches) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best?.page ?? null;
}
