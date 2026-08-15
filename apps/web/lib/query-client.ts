/**
 * React Query client factory — shared by the browser provider and by
 * Server Components that prefetch.
 *
 * Why a factory and not a module-level singleton: on the server this
 * module is shared across concurrent requests from DIFFERENT users. A
 * shared client would leak one user's cached `/me` row into another
 * user's render. Every server render must build its own throwaway
 * client; the browser gets exactly one, held in `useState` by
 * `<Providers>`.
 *
 * The config lives here (rather than inline in the provider) so the
 * prefetching server and the hydrating client cannot drift apart —
 * notably `staleTime`, which decides whether the client immediately
 * refetches data the server just handed it.
 */

import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Must stay > 0. Server-prefetched data arrives with a
        // `dataUpdatedAt` of "just now"; a staleTime of 0 would make the
        // client refetch it on mount and undo the entire point of
        // prefetching. The Worker sets its own cache headers, so this
        // stays modest.
        staleTime: 15_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}
