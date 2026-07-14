import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Clickefy Web · scaffold
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          AI Creator Studio
        </h1>
        <p className="max-w-md text-muted-foreground">
          Front-end foundation is up. Design work starts on the design system.
        </p>
      </div>
      <Link
        href="/design-system"
        className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Open Design System →
      </Link>
    </main>
  );
}
