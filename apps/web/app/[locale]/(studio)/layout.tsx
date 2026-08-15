import { auth } from "@clerk/nextjs/server";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { StudioShell } from "@/components/studio/studio-shell";
import { makeQueryClient } from "@/lib/query-client";
import { fetchMe } from "@/lib/server/me";
import { ME_QUERY_KEY } from "@/lib/use-session";

/**
 * Studio shell — auth-gated, and the app's data entry point.
 *
 * Auth: the check lives here (resource level) rather than in proxy.ts —
 * it runs after Next resolves `/create` and `/ar/create` to the same
 * layout, so it's locale-agnostic for free, and it follows Clerk's
 * current guidance (matcher-based protection in middleware is
 * deprecated).
 *
 * Data: we also prefetch `/v1/users/me` here and ship it inside the HTML
 * via `<HydrationBoundary>`. Without this, the topbar's profile and
 * credit widgets could not begin loading until FIVE sequential network
 * legs had completed — document, clerk-js download, session resolution,
 * token mint, then finally the API call — because every `useQuery` in
 * the tree is gated on `useAuth().isLoaded`. That chain is why both
 * widgets sat on skeletons for a second or more after sign-in.
 *
 * The prefetch is awaited, which does add its own latency to this
 * layout's render. That trade is deliberate and favourable:
 *   - the layout ALREADY blocks on `await auth()`, so blocking is not
 *     new — we are adding one call to an existing blocking path;
 *   - it is a server-to-server call (Vercel → Worker → Neon) rather
 *     than four chained legs from whatever network the user is on;
 *   - `fetchMe` never throws, so a slow or failing API degrades to
 *     today's client-fetch behavior instead of breaking the page.
 *
 * Note a `loading.tsx` at this segment would NOT cover the awaits above:
 * per the Next.js docs, "a layout that accesses uncached or runtime data
 * does not fall back to a same route segment loading.js — it blocks
 * navigation until the layout finishes rendering."
 */
export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, redirectToSignIn, getToken } = await auth();
  if (!isAuthenticated) return redirectToSignIn();

  // A per-render client: never share one across requests (see
  // `makeQueryClient`). It exists only to be serialized below.
  const queryClient = makeQueryClient();
  const me = await fetchMe(await getToken());

  // Seed ONLY on success. `prefetchQuery` would have been the obvious
  // call here, but it stores whatever the query function resolves to —
  // including the `null` that `fetchMe` returns on failure. The client
  // would then hydrate a successful-looking `null`, treat it as fresh
  // for the full staleTime, and render a signed-in user with no profile
  // for 30 seconds. Seeding conditionally means a failed prefetch leaves
  // the cache untouched and the client fetches on mount exactly as it
  // does today.
  if (me) queryClient.setQueryData(ME_QUERY_KEY, me);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <StudioShell>{children}</StudioShell>
    </HydrationBoundary>
  );
}
