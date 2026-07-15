"use client";

import { useState } from "react";
import { StudioProvider } from "@/components/studio/studio-context";
import { StudioTopbar } from "@/components/studio/studio-topbar";
import { StudioSidebar } from "@/components/studio/studio-sidebar";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <StudioProvider>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <StudioTopbar onMenu={() => setSidebarOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <StudioSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          {children}
        </div>
      </div>
    </StudioProvider>
  );
}
