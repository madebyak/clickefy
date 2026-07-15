// Root layout is a passthrough — the real document (<html>/<body>, fonts, dir,
// and the next-intl provider) lives in app/[locale]/layout.tsx so it can react
// to the active locale. This is the standard next-intl App Router setup.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
