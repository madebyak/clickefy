import { auth } from "@clerk/nextjs/server";
import { StudioShell } from "@/components/studio/studio-shell";

/**
 * Studio shell — auth-gated. The check lives here (resource level)
 * rather than in proxy.ts: it runs after Next resolves `/create` and
 * `/ar/create` to the same layout, so it's locale-agnostic for free,
 * and it follows Clerk's current guidance (matcher-based protection
 * in middleware is deprecated).
 */
export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, redirectToSignIn } = await auth();
  if (!isAuthenticated) return redirectToSignIn();

  return <StudioShell>{children}</StudioShell>;
}
