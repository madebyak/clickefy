import { clerkMiddleware } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next 16 renamed `middleware` to `proxy`. Two jobs here:
//   1. clerkMiddleware establishes auth context for every request
//      (no route protection here — Clerk deprecated matcher-based
//      protection; the (studio) layout does the resource-level check).
//   2. next-intl handles locale detection, cookie persistence, and
//      prefixing per the routing config.
const intlMiddleware = createMiddleware(routing);

export default clerkMiddleware(async (_auth, req) => intlMiddleware(req));

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search
    // params. Unlike apps/admin, this app serves media from /public — the
    // video/audio extensions must be excluded here or the intl middleware
    // swallows them into locale routing and 404s.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|mov|m4v|mp3|wav|ogg)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
    // Clerk frontend API routes.
    "/__clerk/(.*)",
  ],
};
