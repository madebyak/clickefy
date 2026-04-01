import { Sidebar } from '@/components/layout/sidebar';

/**
 * Admin layout wrapper
 * Provides sidebar navigation for all admin pages
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="ml-64 p-8">
        {children}
      </main>
    </div>
  );
}
