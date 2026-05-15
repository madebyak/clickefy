'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Client-side providers for the admin app.
 *
 * Lives in its own client component so `app/layout.tsx` can stay a
 * server component (Next 16 best practice — keep client boundaries
 * narrow). Add new client-only providers (theme, command palette,
 * etc.) here rather than promoting the root layout to "use client".
 *
 * QueryClient defaults mirror `apps/mobile/_layout.tsx` so server-state
 * caching feels consistent across surfaces. Tweak per-query as needed
 * via `useQuery({ staleTime, refetchInterval, ... })`.
 */
export function Providers({ children }: { children: ReactNode }) {
  // useState ensures the QueryClient is created once per browser tab,
  // never shared across users on the server.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
