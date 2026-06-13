'use client';

import { useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Loader2, ShieldAlert } from 'lucide-react';

import { usePermissionsStore } from '@/lib/stores/permissions-store';
import { pageForPathname } from '@/lib/admin-nav';
import { AccessDenied } from '@/components/access-denied';

/**
 * Loads `GET /v1/admin/me` once on boot and gates the whole admin shell:
 *
 *   - while loading → a centered spinner (no flash of forbidden nav);
 *   - on 403 (not staff) → a hard "no access" wall;
 *   - on any other error → an error state with retry;
 *   - on success → renders children (sidebar + content can now read the
 *     permission context safely).
 *
 * It deliberately does NOT enforce per-page access itself — that's the
 * `PageGuard` below, so the sidebar (which lives outside the guard) stays
 * visible while the content area swaps to Access Denied.
 */
export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);

  const status = usePermissionsStore((s) => s.status);
  const errorStatus = usePermissionsStore((s) => s.errorStatus);
  const error = usePermissionsStore((s) => s.error);
  const fetchMe = usePermissionsStore((s) => s.fetchMe);
  const reset = usePermissionsStore((s) => s.reset);

  useEffect(() => {
    void fetchMe(tokenGetter);
  }, [fetchMe, tokenGetter]);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === 'error') {
    const isForbidden = errorStatus === 403;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert className="h-6 w-6 text-destructive" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">
            {isForbidden ? 'No admin access' : 'Could not load your access'}
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            {isForbidden
              ? 'This account is not a member of the admin team. Ask a superadmin to grant you access.'
              : (error ?? 'Something went wrong while loading your permissions.')}
          </p>
        </div>
        {!isForbidden && (
          <button
            type="button"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => {
              reset();
              void fetchMe(tokenGetter);
            }}
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Per-page access guard for the content area. Resolves the current
 * pathname to a page key and renders Access Denied when the signed-in
 * user's effective pages don't include it. Unknown routes (no page
 * mapping) fall through so non-gated/utility pages still render.
 */
export function PageGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = usePermissionsStore((s) => s.me);

  const page = pageForPathname(pathname);
  const allowed = !page || (me?.pages.includes(page) ?? false);

  if (!allowed) return <AccessDenied />;
  return <>{children}</>;
}
