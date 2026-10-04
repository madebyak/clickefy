/**
 * Single source of truth for the admin sidebar and the page-level route
 * guard. Every entry binds a route to its `AdminPageKey`, so the sidebar
 * filter and the deep-link guard read the same map — what is shown is
 * exactly what is allowed. The API enforces the same keys server-side
 * via `withAdmin({ page })`; this is the mirror, never the gate.
 *
 * The sidebar is organised in groups, each a question an admin comes
 * here to answer:
 *
 *   Dashboard     what is happening right now
 *   Templates     what the catalogue offers (templates, categories, home feed)
 *   Audience      who uses it and what they tell us (users, reports, push)
 *   Finance       what it costs and earns (credits & pricing, billing, cost & profit)
 *   Operations    is it running (jobs, monitoring)
 *   System        who may do what (settings, team)
 *
 * An item may carry `children`: sub-pages that live under its route and
 * show as an indented list when the item is open (Credits does this).
 */

import {
  Activity,
  BarChart3,
  Bell,
  Briefcase,
  Coins,
  CreditCard,
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

export interface AdminNavChild {
  title: string;
  href: string;
  /** Match the pathname exactly (the parent's own route) instead of by prefix. */
  exact?: boolean;
}

export interface AdminNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  page: AdminPageKey;
  /** Reserved for superadmins; rendered only when the role has the page. */
  superadmin?: boolean;
  children?: AdminNavChild[];
}

export interface AdminNavGroup {
  id: string;
  /** Omitted for the top group, which renders without a heading. */
  title?: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: 'overview',
    items: [{ title: 'Dashboard', href: '/admin', icon: LayoutDashboard, page: 'dashboard' }],
  },
  {
    id: 'templates',
    title: 'Templates',
    items: [
      { title: 'All templates', href: '/admin/templates', icon: FileText, page: 'templates' },
      { title: 'Categories', href: '/admin/categories', icon: FolderTree, page: 'categories' },
      { title: 'Home feed', href: '/admin/home', icon: Home, page: 'home' },
    ],
  },
  {
    id: 'audience',
    title: 'Audience',
    items: [
      { title: 'Users', href: '/admin/users', icon: Users, page: 'users' },
      { title: 'Reports', href: '/admin/reports', icon: Flag, page: 'reports' },
      { title: 'Push notifications', href: '/admin/push', icon: Bell, page: 'push' },
    ],
  },
  {
    id: 'finance',
    title: 'Finance',
    items: [
      {
        title: 'Credits & pricing',
        href: '/admin/credits',
        icon: Coins,
        page: 'credits',
        children: [
          { title: 'Overview', href: '/admin/credits', exact: true },
          { title: 'Model pricing', href: '/admin/credits/models' },
          { title: 'Top-up packs', href: '/admin/credits/packs' },
          { title: 'Subscriptions', href: '/admin/credits/subscriptions' },
          { title: 'Free grants', href: '/admin/credits/grants' },
        ],
      },
      // Gated on the same page permission as Credits: the two answer the
      // same question from different ends, and a separate key would mean a
      // permissions migration for no change in who may look.
      { title: 'Billing', href: '/admin/billing', icon: CreditCard, page: 'credits' },
      { title: 'Cost & profit', href: '/admin/analytics', icon: BarChart3, page: 'analytics' },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    items: [
      { title: 'Jobs', href: '/admin/jobs', icon: Briefcase, page: 'jobs' },
      { title: 'Monitoring', href: '/admin/monitoring', icon: Activity, page: 'monitoring', superadmin: true },
    ],
  },
  {
    id: 'system',
    title: 'System',
    items: [
      { title: 'Settings', href: '/admin/settings', icon: Settings, page: 'settings' },
      { title: 'Team & roles', href: '/admin/team', icon: ShieldCheck, page: 'team', superadmin: true },
    ],
  },
];

const ALL_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV_GROUPS.flatMap((g) => g.items);

/**
 * Human-readable label for a page key (permission editors / filters).
 * The first item carrying a key names it, so `credits` reads "Credits &
 * pricing" rather than "Billing".
 */
export const PAGE_TITLES: Record<AdminPageKey, string> = ALL_NAV_ITEMS.reduce(
  (acc, item) => {
    acc[item.page] ??= item.title;
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

/** Is `href` the section the pathname is in? Root matches exactly, everything else by prefix. */
export function isNavActive(pathname: string, href: string, exact = false): boolean {
  if (exact || href === '/admin') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
