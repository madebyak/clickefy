/**
 * Clerk middleware for the admin dashboard.
 *
 * Next.js 16 renamed `middleware.ts` → `proxy.ts` (same execution semantics,
 * runs before requests reach pages or route handlers). Auth-status checks
 * happen here; per-row admin entitlement is enforced on the API side
 * against the Neon `users` table (see `apps/api/src/middleware/with-auth.ts`).
 */
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher([
  '/',
  '/admin(.*)',
  '/api/(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes.
    '/(api|trpc)(.*)',
    // Clerk frontend API routes.
    '/__clerk/(.*)',
  ],
};
