'use client';

import { Lock } from 'lucide-react';

/**
 * Shown when a staff member deep-links (or is left on) a page their role
 * doesn't grant. Defense-in-depth only — the API independently rejects
 * the underlying requests, so this is the friendly face of a 403.
 */
export function AccessDenied({
  title = 'No access to this page',
  description = "Your role doesn't include this section. If you think this is a mistake, ask a superadmin to grant you access.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Lock className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
