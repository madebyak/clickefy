import Link from "next/link";

/**
 * Root 404 — renders for paths outside the [locale] tree, and for the
 * unknown-locale case where [locale]/layout.tsx calls notFound() before
 * the localized document is established. Because the root layout is a
 * passthrough (no <html>/<body>), this page supplies its own. Copy is
 * English-only by necessity: no locale/intl context exists here.
 */
export default function NotFound() {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground antialiased">
        <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-6xl font-semibold tracking-tight text-muted-foreground">404</p>
          <h1 className="text-xl font-semibold">Page not found</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
          </p>
          <Link
            href="/"
            className="mt-2 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Back to home
          </Link>
        </main>
      </body>
    </html>
  );
}
