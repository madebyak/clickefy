"use client";

/**
 * Client-side app providers: react-query + the Clerk→SDK token bridge.
 * Rendered inside <ClerkProvider> (see `app/[locale]/layout.tsx`).
 *
 * `ClerkSdkBridge` is the web equivalent of mobile's `SdkBridge`: a
 * UI-less effect that hands Clerk's `getToken` (and the active locale)
 * to the SDK singleton. Clerk caches and silently refreshes the JWT,
 * so reading it lazily per request is the correct pattern.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useLocale } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { attachLocaleGetter, attachTokenGetter } from "@/lib/api";

function ClerkSdkBridge() {
  const { getToken } = useAuth();
  const locale = useLocale();

  useEffect(() => {
    attachTokenGetter(async () => (await getToken()) ?? null);
  }, [getToken]);

  useEffect(() => {
    attachLocaleGetter(() => locale);
  }, [locale]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The Worker sets its own cache headers; keep client cache modest.
            staleTime: 15_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ClerkSdkBridge />
      {children}
    </QueryClientProvider>
  );
}
