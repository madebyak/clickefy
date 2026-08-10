"use client";

/**
 * Studio state — Phase 1C: folders/projects/assets are SERVER state
 * (react-query over `/v1/projects`), no longer an in-memory mock.
 * Client-only state that remains here: the active project selection,
 * asset selection, prompt attachments, and in-flight generation tiles.
 *
 * Query keys:
 *   ['projects']                    → folders + project summaries
 *   ['projects', id, 'assets']      → a project's assets (newest first)
 * Every mutation invalidates what it touches; job completion
 * invalidates both so new outputs appear via refetch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateGenerationInput,
  GenerationProgress,
  ProjectsListResponse,
  StudioAsset,
  StudioFolder,
  StudioProject,
} from "@clickfy/sdk";
import { getSDK } from "@/lib/api";
import { config } from "@/lib/config";
import { ME_QUERY_KEY } from "@/lib/use-session";
import { CREDITS_QUERY_KEY } from "@/lib/use-credits";

/* ------------------------------------------------------------------ model */

export type AssetType = "image" | "video";
/** The masonry's render unit — mapped from `StudioAsset`. */
export type Asset = { id: string; type: AssetType; src: string; poster?: string };
export type { StudioAsset, StudioFolder, StudioProject };

/**
 * A reference/frame image sitting in the prompt bar. Uploads to R2
 * immediately on attach; `media` is populated once the Worker
 * finalizes the object and is what flows into the generation request.
 */
export type PromptAttachment = {
  id: string;
  /** Local object URL (or asset URL) for the thumbnail. */
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  /** 0–1 upload progress. */
  progress: number;
  media?: { r2Key: string; mimeType: string; sizeBytes: number };
};

/** One in-flight generation job rendered as a placeholder tile. */
export type PendingGeneration = {
  jobId: string;
  projectId: string;
  kind: AssetType;
  status: "queued" | "processing" | "failed";
  stageLabel?: string;
  /** 0–1 within the current stage. */
  stageProgress?: number;
  error?: string;
};

/**
 * The API mints asset URLs from its request origin — but under
 * `wrangler dev` the Worker sees the production route host
 * (api.clickefy.ai) even though it serves on localhost, so local URLs
 * point at prod and 404. Rebase any own-API host onto the origin this
 * app is configured to call. In production both match → no-op.
 */
const OWN_API_HOSTS = ["api.clickefy.ai"];
function rebaseAssetUrl(url: string): string {
  try {
    const u = new URL(url);
    const api = new URL(config.apiUrl);
    if (
      u.origin !== api.origin &&
      (OWN_API_HOSTS.includes(u.hostname) || u.hostname.endsWith(".workers.dev"))
    ) {
      return `${api.origin}${u.pathname}${u.search}`;
    }
  } catch {
    // Not an absolute URL — leave untouched.
  }
  return url;
}

const toAsset = (a: StudioAsset): Asset => ({
  id: a.id,
  type: a.kind,
  src: rebaseAssetUrl(a.url),
  poster: a.posterUrl && a.kind === "video" ? undefined : (a.posterUrl ?? undefined),
});

/* ---------------------------------------------------------------- context */

export type StartGenerationOptions = {
  /** Everything except idempotencyKey/projectId, which are set here. */
  input: Omit<CreateGenerationInput, "idempotencyKey" | "projectId">;
  /** Parallel jobs to submit (the prompt bar's output counter). */
  count: number;
  kind: AssetType;
};

type StudioValue = {
  folders: StudioFolder[];
  projects: StudioProject[];
  projectsLoading: boolean;
  activeProjectId: string | null;
  activeProject: StudioProject | null;
  /** Assets of the active project (server state, newest first). */
  activeAssets: Asset[];
  activeAssetsLoading: boolean;

  // projects & folders (all persisted server-side)
  setActiveProject: (id: string | null) => void;
  createProject: (folderId?: string | null) => Promise<string>;
  createFolder: (name: string) => Promise<void>;
  moveProjectToFolder: (projectId: string, folderId: string | null) => void;
  renameProject: (projectId: string, name: string) => void;

  // assets
  copyAssets: (assetIds: string[], targetProjectId: string) => void;
  moveAssets: (assetIds: string[], fromProjectId: string, targetProjectId: string) => void;
  deleteAssets: (projectId: string, assetIds: string[]) => void;

  // selection (in the active project)
  selectedAssetIds: string[];
  toggleAssetSelection: (id: string) => void;
  clearSelection: () => void;

  // attachments (for the prompt)
  attachments: PromptAttachment[];
  /** Attach a local file: uploads to R2 immediately, tracking progress. */
  attachFile: (file: File) => void;
  /** Attach an existing canvas asset as a reference (fetch → re-upload). */
  addAttachment: (asset: Asset) => void;
  removeAttachment: (attachmentId: string) => void;
  clearAttachments: () => void;

  // generation
  pending: PendingGeneration[];
  /**
   * Submit `count` create jobs filed into the active project (creating
   * one server-side if none is active). Throws the first submission
   * error (`JobSubmissionError` / `RateLimitedError`) so the prompt bar
   * can surface precise copy; successfully submitted jobs keep polling.
   */
  startGeneration: (opts: StartGenerationOptions) => Promise<void>;
  dismissPending: (jobId: string) => void;
};

const StudioContext = createContext<StudioValue | null>(null);

type ProjectsCache = ProjectsListResponse | undefined;

const PROJECTS_KEY = ["projects"] as const;
const assetsKey = (projectId: string) => ["projects", projectId, "assets"] as const;

export function StudioProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn } = useAuth();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [pending, setPending] = useState<PendingGeneration[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const seq = useRef(1);
  // Live poll subscriptions, cancelled on unmount so timers don't leak.
  const unsubs = useRef(new Map<string, () => void>());

  useEffect(() => {
    const map = unsubs.current;
    return () => {
      for (const stop of map.values()) stop();
      map.clear();
    };
  }, []);

  /* --------------------------------------------------- server state */

  const projectsQuery = useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: async () => {
      const data = await getSDK().projects.list({ limit: 100 });
      return {
        ...data,
        projects: data.projects.map((p) => ({
          ...p,
          cover: p.cover
            ? {
                ...p.cover,
                url: rebaseAssetUrl(p.cover.url),
                posterUrl: p.cover.posterUrl ? rebaseAssetUrl(p.cover.posterUrl) : null,
              }
            : null,
        })),
      };
    },
    enabled: isLoaded && !!isSignedIn,
    staleTime: 15_000,
  });

  const folders = projectsQuery.data?.folders ?? [];
  const projects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const assetsQuery = useQuery({
    queryKey: assetsKey(activeProjectId ?? "none"),
    queryFn: async () => {
      const data = await getSDK().projects.listAssets(activeProjectId!, { limit: 100 });
      return data.items.map(toAsset);
    },
    enabled: isLoaded && !!isSignedIn && !!activeProjectId,
    staleTime: 5_000,
  });

  const invalidateProjects = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY }),
    [queryClient],
  );
  const invalidateAssets = useCallback(
    (projectId: string) =>
      void queryClient.invalidateQueries({ queryKey: assetsKey(projectId) }),
    [queryClient],
  );

  /* ------------------------------------------------------ selection */

  const setActiveProject = useCallback((id: string | null) => {
    setActiveProjectId(id);
    setSelectedAssetIds([]);
  }, []);

  const toggleAssetSelection = useCallback(
    (id: string) =>
      setSelectedAssetIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      ),
    [],
  );
  const clearSelection = useCallback(() => setSelectedAssetIds([]), []);

  /* ------------------------------------------- projects & folders */

  const createProject = useCallback(
    async (folderId: string | null = null) => {
      const project = await getSDK().projects.create({ folderId });
      // Seed the cache so the new project is selectable immediately.
      queryClient.setQueryData(
        PROJECTS_KEY,
        (prev: ProjectsCache) =>
          prev
            ? { ...prev, projects: [project, ...prev.projects] }
            : { folders: [], projects: [project], nextCursor: null },
      );
      setActiveProjectId(project.id);
      setSelectedAssetIds([]);
      invalidateProjects();
      return project.id;
    },
    [queryClient, invalidateProjects],
  );

  const createFolder = useCallback(
    async (name: string) => {
      await getSDK().projects.createFolder(name);
      invalidateProjects();
    },
    [invalidateProjects],
  );

  const moveProjectToFolder = useCallback(
    (projectId: string, folderId: string | null) => {
      // Optimistic: reflect the move instantly, reconcile on settle.
      queryClient.setQueryData(PROJECTS_KEY, (prev: ProjectsCache) =>
        prev
          ? {
              ...prev,
              projects: prev.projects.map((p) => (p.id === projectId ? { ...p, folderId } : p)),
            }
          : prev,
      );
      getSDK()
        .projects.update(projectId, { folderId })
        .catch(() => undefined)
        .finally(invalidateProjects);
    },
    [queryClient, invalidateProjects],
  );

  const renameProject = useCallback(
    (projectId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      queryClient.setQueryData(PROJECTS_KEY, (prev: ProjectsCache) =>
        prev
          ? {
              ...prev,
              projects: prev.projects.map((p) =>
                p.id === projectId ? { ...p, name: trimmed } : p,
              ),
            }
          : prev,
      );
      getSDK()
        .projects.update(projectId, { name: trimmed })
        .catch(() => undefined)
        .finally(invalidateProjects);
    },
    [queryClient, invalidateProjects],
  );

  /* ---------------------------------------------------------- assets */

  const copyAssets = useCallback(
    (assetIds: string[], targetProjectId: string) => {
      getSDK()
        .projects.copyAssets(targetProjectId, assetIds)
        .catch(() => undefined)
        .finally(() => {
          invalidateAssets(targetProjectId);
          invalidateProjects();
        });
      setSelectedAssetIds([]);
    },
    [invalidateAssets, invalidateProjects],
  );

  const moveAssets = useCallback(
    (assetIds: string[], fromProjectId: string, targetProjectId: string) => {
      if (fromProjectId === targetProjectId) return;
      getSDK()
        .projects.moveAssets(assetIds, targetProjectId)
        .catch(() => undefined)
        .finally(() => {
          invalidateAssets(fromProjectId);
          invalidateAssets(targetProjectId);
          invalidateProjects();
        });
      setSelectedAssetIds([]);
    },
    [invalidateAssets, invalidateProjects],
  );

  const deleteAssets = useCallback(
    (projectId: string, assetIds: string[]) => {
      // Optimistic removal from the visible grid.
      queryClient.setQueryData(assetsKey(projectId), (prev: Asset[] | undefined) =>
        prev ? prev.filter((a) => !assetIds.includes(a.id)) : prev,
      );
      getSDK()
        .projects.deleteAssets(assetIds)
        .catch(() => undefined)
        .finally(() => {
          invalidateAssets(projectId);
          invalidateProjects();
        });
      setSelectedAssetIds([]);
    },
    [queryClient, invalidateAssets, invalidateProjects],
  );

  /* ------------------------------------------------------- attachments */

  const uploadAttachment = useCallback((id: string, file: File | Blob, name: string) => {
    const type = file.type || "image/jpeg";
    getSDK()
      .uploads.uploadUserAsset(
        { file, name, type, sizeBytes: file.size },
        {
          onProgress: (fraction) =>
            setAttachments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, progress: fraction } : a)),
            ),
        },
      )
      .then((ref) =>
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: "ready",
                  progress: 1,
                  media: { r2Key: ref.key, mimeType: ref.contentType, sizeBytes: ref.sizeBytes },
                }
              : a,
          ),
        ),
      )
      .catch(() =>
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: "error" } : a)),
        ),
      );
  }, []);

  const attachFile = useCallback(
    (file: File) => {
      const id = `att-${seq.current++}`;
      setAttachments((prev) => [
        ...prev,
        { id, previewUrl: URL.createObjectURL(file), status: "uploading", progress: 0 },
      ]);
      uploadAttachment(id, file, file.name);
    },
    [uploadAttachment],
  );

  const addAttachment = useCallback(
    (asset: Asset) => {
      if (asset.type !== "image") return; // only images can be references/frames
      const id = `att-${seq.current++}`;
      setAttachments((prev) =>
        prev.some((a) => a.previewUrl === asset.src)
          ? prev
          : [...prev, { id, previewUrl: asset.src, status: "uploading", progress: 0 }],
      );
      // Canvas assets are URLs (generated outputs served by the Worker
      // with permissive CORS) — fetch the bytes and re-upload so the
      // generation request gets a real r2Key.
      fetch(asset.src)
        .then((res) => {
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          const name = asset.src.split("/").pop() ?? "reference.jpg";
          uploadAttachment(id, blob, name);
        })
        .catch(() =>
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: "error" } : a)),
          ),
        );
    },
    [uploadAttachment],
  );

  const removeAttachment = useCallback(
    (attachmentId: string) =>
      setAttachments((prev) => {
        const target = prev.find((a) => a.id === attachmentId);
        if (target?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((a) => a.id !== attachmentId);
      }),
    [],
  );
  const clearAttachments = useCallback(
    () =>
      setAttachments((prev) => {
        for (const a of prev)
          if (a.previewUrl.startsWith("blob:")) URL.revokeObjectURL(a.previewUrl);
        return [];
      }),
    [],
  );

  /* -------------------------------------------------------- generation */

  const invalidateBalances = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: CREDITS_QUERY_KEY });
  }, [queryClient]);

  const trackJob = useCallback(
    (jobId: string, projectId: string, kind: AssetType) => {
      setPending((prev) => [...prev, { jobId, projectId, kind, status: "queued" }]);
      const stop = getSDK().generation.subscribe(jobId, (update: GenerationProgress) => {
        if (update.status === "completed") {
          unsubs.current.get(jobId)?.();
          unsubs.current.delete(jobId);
          setPending((prev) => prev.filter((p) => p.jobId !== jobId));
          // Outputs were materialized server-side (worker) — refetch.
          invalidateAssets(projectId);
          invalidateProjects();
          invalidateBalances();
        } else if (update.status === "failed") {
          unsubs.current.get(jobId)?.();
          unsubs.current.delete(jobId);
          setPending((prev) =>
            prev.map((p) =>
              p.jobId === jobId ? { ...p, status: "failed", error: update.error } : p,
            ),
          );
          invalidateBalances(); // infra failures refund
        } else {
          setPending((prev) =>
            prev.map((p) =>
              p.jobId === jobId
                ? {
                    ...p,
                    status: update.status === "processing" ? "processing" : "queued",
                    stageLabel: update.stageLabel,
                    stageProgress: update.stageProgress,
                  }
                : p,
            ),
          );
        }
      });
      unsubs.current.set(jobId, stop);
    },
    [invalidateAssets, invalidateProjects, invalidateBalances],
  );

  const startGeneration = useCallback(
    async ({ input, count, kind }: StartGenerationOptions) => {
      const projectId = activeProjectId ?? (await createProject(null));
      const sdk = getSDK();
      let firstError: unknown = null;
      for (let i = 0; i < count; i++) {
        try {
          const res = await sdk.generation.createGenerate({
            ...input,
            projectId,
            idempotencyKey: crypto.randomUUID(),
          });
          trackJob(res.jobId, projectId, kind);
        } catch (err) {
          // Keep earlier jobs polling; report the first failure (usually
          // insufficient_credits on job N after N-1 debits).
          firstError = firstError ?? err;
          break;
        }
      }
      invalidateBalances();
      if (firstError) throw firstError;
    },
    [activeProjectId, createProject, trackJob, invalidateBalances],
  );

  const dismissPending = useCallback(
    (jobId: string) => setPending((prev) => prev.filter((p) => p.jobId !== jobId)),
    [],
  );

  const value: StudioValue = {
    folders,
    projects,
    projectsLoading: projectsQuery.isLoading,
    activeProjectId,
    activeProject,
    activeAssets: assetsQuery.data ?? [],
    activeAssetsLoading: assetsQuery.isLoading,
    setActiveProject,
    createProject,
    createFolder,
    moveProjectToFolder,
    renameProject,
    copyAssets,
    moveAssets,
    deleteAssets,
    selectedAssetIds,
    toggleAssetSelection,
    clearSelection,
    attachments,
    attachFile,
    addAttachment,
    removeAttachment,
    clearAttachments,
    pending,
    startGeneration,
    dismissPending,
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used within <StudioProvider>");
  return ctx;
}

/**
 * Nullable variant for components that render both inside the studio
 * and on the marketing site (the hero PromptBar). Outside the provider
 * they degrade to a CTA into the studio instead of crashing.
 */
export function useStudioMaybe() {
  return useContext(StudioContext);
}
