"use client";

// Global styles must be imported here explicitly: when this boundary
// renders, the [locale] layout (which normally imports them) has crashed.
import "./globals.css";

/**
 * Last-resort error boundary — catches errors thrown by [locale]/layout.tsx
 * itself (per Next's error.md, a segment's error.tsx does not wrap its own
 * layout). Must supply its own <html>/<body> since no layout survives.
 * English-only: no intl context exists when the locale layout is down.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground antialiased">
        <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            An unexpected error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-2 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
