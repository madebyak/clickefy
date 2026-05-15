'use client';

/**
 * Layout for `/admin/credits/*` — shared header + sub-route nav.
 *
 * Sub-routes are independent Next.js pages (not Tabs within a single
 * page) so deep-linking and reloads keep working. The nav strip is
 * a row of `<Link>`s that highlight the active path.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Coins } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const tabs: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: '/admin/credits', label: 'Overview', exact: true },
  { href: '/admin/credits/models', label: 'Model pricing' },
  { href: '/admin/credits/packs', label: 'Top-up packs' },
  { href: '/admin/credits/subscriptions', label: 'Subscriptions' },
  { href: '/admin/credits/grants', label: 'Free grants' },
];

function isActive(pathname: string, t: (typeof tabs)[number]): boolean {
  if (t.exact) return pathname === t.href;
  return pathname.startsWith(t.href);
}

export default function CreditsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Coins className="h-6 w-6 text-primary-purple" />
          <h1 className="text-2xl font-semibold tracking-tight">Credits</h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Configure how Clickefy charges and rewards credits — per-model
          pricing, top-up packs, subscriptions, and free grants. Every
          change here is recorded in the admin audit log.
        </p>
      </header>

      <nav className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-1">
        {tabs.map((t) => {
          const active = isActive(pathname, t);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div>{children}</div>
    </div>
  );
}
