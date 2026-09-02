"use client";

/**
 * Studio tools — Camera Angle and Storyboard.
 *
 * One provider owns both modals so every entry point (the topbar links,
 * the tile's "Change camera angle" action) opens the same instance with
 * one hook, instead of each surface mounting its own copy. Sits inside
 * `StudioProvider` because generating goes through the studio's normal
 * `startGeneration` path — tool results are ordinary jobs that land in
 * the project grid with a pending tile.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CameraAngleModal } from "@/components/tools/camera-angle-modal";
import { StoryboardModal } from "@/components/tools/storyboard-modal";

/** A photo handed to Camera Angle from an existing tile. */
export type ToolPhoto = { id: string; src: string };

type ToolsValue = {
  /** Open Camera Angle — optionally pre-loaded with an existing image. */
  openCameraAngle: (photo?: ToolPhoto) => void;
  openStoryboard: () => void;
};

const ToolsContext = createContext<ToolsValue | null>(null);

export function ToolsProvider({ children }: { children: ReactNode }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraPhoto, setCameraPhoto] = useState<ToolPhoto | null>(null);
  const [storyboardOpen, setStoryboardOpen] = useState(false);

  const openCameraAngle = useCallback((photo?: ToolPhoto) => {
    setCameraPhoto(photo ?? null);
    setCameraOpen(true);
  }, []);
  const openStoryboard = useCallback(() => setStoryboardOpen(true), []);

  const value = useMemo(
    () => ({ openCameraAngle, openStoryboard }),
    [openCameraAngle, openStoryboard],
  );

  return (
    <ToolsContext.Provider value={value}>
      {children}
      {cameraOpen && (
        <CameraAngleModal
          initialPhoto={cameraPhoto}
          onClose={() => {
            setCameraOpen(false);
            setCameraPhoto(null);
          }}
        />
      )}
      {storyboardOpen && <StoryboardModal onClose={() => setStoryboardOpen(false)} />}
    </ToolsContext.Provider>
  );
}

export function useTools() {
  const ctx = useContext(ToolsContext);
  if (!ctx) throw new Error("useTools must be used within <ToolsProvider>");
  return ctx;
}

/** Nullable variant for surfaces that also render outside the studio. */
export function useToolsMaybe() {
  return useContext(ToolsContext);
}
