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

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { CameraAngleModal } from "@/components/tools/camera-angle-modal";
import { StoryboardModal } from "@/components/tools/storyboard-modal";
import { UpscaleModal, type ToolVideo } from "@/components/tools/upscale-modal";
import { AdModal } from "@/components/tools/ad-modal";

/** A photo handed to Camera Angle from an existing tile. */
export type ToolPhoto = { id: string; src: string };
export type { ToolVideo };

type ToolsValue = {
  /** Open Camera Angle — optionally pre-loaded with an existing image. */
  openCameraAngle: (photo?: ToolPhoto) => void;
  openStoryboard: () => void;
  /**
   * Open the Video Upscaler. With a clip it skips the upload step; empty
   * it asks for one. Both entry points the product has — the nav link
   * and a finished video's action — are the same modal.
   */
  openUpscale: (video?: ToolVideo) => void;
  /** Open the One-Click AI Ad. */
  openAd: () => void;
};

const ToolsContext = createContext<ToolsValue | null>(null);

export function ToolsProvider({ children }: { children: ReactNode }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraPhoto, setCameraPhoto] = useState<ToolPhoto | null>(null);
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const [upscaleOpen, setUpscaleOpen] = useState(false);
  const [upscaleVideo, setUpscaleVideo] = useState<ToolVideo | null>(null);
  const [adOpen, setAdOpen] = useState(false);

  const openCameraAngle = useCallback((photo?: ToolPhoto) => {
    setCameraPhoto(photo ?? null);
    setCameraOpen(true);
  }, []);
  const openStoryboard = useCallback(() => setStoryboardOpen(true), []);
  const openUpscale = useCallback((video?: ToolVideo) => {
    setUpscaleVideo(video ?? null);
    setUpscaleOpen(true);
  }, []);
  const openAd = useCallback(() => setAdOpen(true), []);

  const value = useMemo(
    () => ({ openCameraAngle, openStoryboard, openUpscale, openAd }),
    [openCameraAngle, openStoryboard, openUpscale, openAd],
  );

  return (
    <ToolsContext.Provider value={value}>
      <Suspense fallback={null}>
        <ToolDeepLink
          openCameraAngle={openCameraAngle}
          openStoryboard={openStoryboard}
          openUpscale={openUpscale}
          openAd={openAd}
        />
      </Suspense>
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
      {adOpen && <AdModal onClose={() => setAdOpen(false)} />}
      {upscaleOpen && (
        <UpscaleModal
          initialVideo={upscaleVideo}
          onClose={() => {
            setUpscaleOpen(false);
            setUpscaleVideo(null);
          }}
        />
      )}
    </ToolsContext.Provider>
  );
}

/**
 * Renders nothing. Opens a tool named by `?tool=camera|storyboard` — the
 * marketing navbar's entry point into the studio tools — then strips the
 * parameter so back/refresh doesn't reopen the modal. Isolated behind its
 * own Suspense boundary because `useSearchParams` suspends during
 * prerender (same shape as ResumeCheckout in pricing-section.tsx).
 */
function ToolDeepLink({
  openCameraAngle,
  openStoryboard,
  openUpscale,
  openAd,
}: {
  openCameraAngle: () => void;
  openStoryboard: () => void;
  openUpscale: () => void;
  openAd: () => void;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fired = useRef(false);

  useEffect(() => {
    const tool = params.get("tool");
    if (!tool || fired.current) return;
    fired.current = true;
    router.replace(pathname);
    if (tool === "camera") openCameraAngle();
    else if (tool === "storyboard") openStoryboard();
    else if (tool === "upscale") openUpscale();
    else if (tool === "ad") openAd();
  }, [params, router, pathname, openCameraAngle, openStoryboard, openUpscale, openAd]);

  return null;
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
