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
import { QueryClientProvider } from "@tanstack/react-query";
import { attachLocaleGetter, attachTokenGetter } from "@/lib/api";
import { makeQueryClient } from "@/lib/query-client";

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
  // `useState` (not a module singleton) so the browser keeps ONE client
  // across re-renders while each server render gets its own — see
  // `makeQueryClient` for why that separation matters.
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ClerkSdkBridge />
      {children}
    </QueryClientProvider>
  );
}
