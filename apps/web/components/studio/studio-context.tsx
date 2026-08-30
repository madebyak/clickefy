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
 *   ['favorites']                   → hearted assets across every project
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
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type {
  AssetDetail,
  CreateGenerationInput,
  FavoriteAsset,
  GenerationProgress,
  ProjectsListResponse,
  StudioAsset,
  StudioFolder,
  StudioProject,
} from "@clickfy/sdk";
import type { JobInputValue } from "@clickfy/types";
import { getSDK } from "@/lib/api";
import { rebaseAssetUrl } from "@/lib/rebase-url";
import { ME_QUERY_KEY } from "@/lib/use-session";

/**
 * Upper bound on paged fetches for one collection. The API caps `limit`
 * at 50, so this covers 500 projects / 500 assets — well beyond any real
 * studio — while guaranteeing the cursor loop can never spin forever.
 */
const MAX_PAGES = 10;
const PAGE_SIZE = 50;

/** Stable empty arrays so the memoized context value doesn't churn while
 *  server state is still loading (a fresh `[]` each render would break the
 *  memo and re-render every `useStudio()` consumer). */
const EMPTY_ASSETS: Asset[] = [];
const EMPTY_FOLDERS: StudioFolder[] = [];
const EMPTY_PROJECTS: StudioProject[] = [];

/* ------------------------------------------------------------------ model */

export type AssetType = "image" | "video";
/** The masonry's render unit — mapped from `StudioAsset`. */
export type Asset = {
  id: string;
  /** Owning project — needed to fetch provenance from a cross-project grid. */
  projectId: string;
  type: AssetType;
  src: string;
  poster?: string;
  favorited: boolean;
  /**
   * Placed from "My Assets" rather than generated — so there is no prompt
   * behind it, and Re-use has nothing to restore.
   */
  fromLibrary: boolean;
  /**
   * Which project the asset lives in. Only set on the Favorites grid,
   * which is cross-project and has to label each tile; inside a project
   * it would be the same string on every tile, so it is left off.
   */
  projectName?: string;
};

/**
 * What `addAttachment` actually needs: the media itself. Kept narrower
 * than `Asset` so callers that synthesise one from a bare URL (the
 * re-use restore, which has references but no asset rows) don't have to
 * invent favorite state they know nothing about.
 */
export type AttachableAsset = Pick<Asset, "id" | "type" | "src">;

/**
 * DataTransfer MIME type for a canvas tile dragged toward the composer.
 * The payload is a JSON-encoded `AttachableAsset`. A custom type (rather
 * than text/plain) means random text drags can never masquerade as an
 * asset, and the composer can advertise itself as a drop target only
 * for drags that actually carry one.
 */
export const ASSET_DRAG_TYPE = "application/x-clickfy-asset";

/**
 * What the currently-selected model accepts as prompt attachments.
 *
 * Registered by the composer (which owns the model selection) and
 * consumed by every attach entry point the composer does NOT own — the
 * tile's "Add as reference", drag-and-drop from the canvas. Centralising
 * the rule here means a video dropped on an image-only model gets ONE
 * consistent, explicit refusal everywhere, instead of the silent no-op
 * each call site used to improvise.
 *
 * `acceptsVideos` is structurally ready but currently always false: no
 * create-eligible model takes a video attachment yet (Seedance's
 * reference-video input is the candidate — pending its API wiring). When
 * that lands, the composer flips this per model and every entry point
 * follows.
 */
export type AttachmentPolicy = {
  /** Commercial model name, for error copy ("Kling 2.6 doesn't…"). */
  modelName: string | null;
  acceptsImages: boolean;
  acceptsVideos: boolean;
  acceptsAudio: boolean;
  /** Max attachments the current model+mode combination takes. */
  ceiling: number;
  /** Per-kind clip caps (Seedance reference budgets); 0 = none. */
  maxVideos: number;
  maxAudio: number;
};

/** A past generation's settings, handed to the composer to restore. */
export type ReuseSetup = {
  /**
   * Image or video. Carried because the composer filters its model list
   * by the CURRENT mode: without switching mode first, a video modelKey
   * is simply absent from the roster and the restore silently lands on
   * whatever image model happened to be selected.
   */
  kind: "image" | "video";
  prompt: string;
  modelKey: string | null;
  aspectRatio: string | null;
  quality: string | null;
  /** Video length in seconds; null for image generations. */
  duration: number | null;
  /** Native-audio toggle; null when the model has none. */
  sound: boolean | null;
  referenceUrls: string[];
};
export type { StudioAsset, StudioFolder, StudioProject };

/**
 * A reference/frame image sitting in the prompt bar. Uploads to R2
 * immediately on attach; `media` is populated once the Worker
 * finalizes the object and is what flows into the generation request.
 */
export type PromptAttachment = {
  id: string;
  /** What the attachment IS — routes it to the right reference role. */
  kind: "image" | "video" | "audio";
  /** Local object URL (or asset URL) for the thumbnail. */
  previewUrl: string;
  /** Original filename — the audio chip's only visual identity. */
  name?: string;
  /**
   * Clip length, probed client-side from the file's metadata. Feeds the
   * price preview (video input is billed); the server re-derives it
   * from the actual bytes, so this is display-only.
   */
  durationSec?: number;
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

const toAsset = (a: StudioAsset): Asset => ({
  id: a.id,
  projectId: a.projectId,
  type: a.kind,
  src: rebaseAssetUrl(a.url),
  poster: a.posterUrl && a.kind === "video" ? undefined : (a.posterUrl ?? undefined),
  favorited: a.isFavorited,
  fromLibrary: a.fromLibrary ?? false,
});

const toFavoriteAsset = (a: FavoriteAsset): Asset => ({
  ...toAsset(a),
  projectName: a.projectName,
});

/* ---------------------------------------------------------------- context */

export type StartGenerationOptions = {
  /** Everything except idempotencyKey/projectId, which are set here. */
  input: Omit<CreateGenerationInput, "idempotencyKey" | "projectId">;
  /** Parallel jobs to submit (the prompt bar's output counter). */
  count: number;
  kind: AssetType;
};

export type StartTemplateJobOptions = {
  templateId: string;
  inputs: Record<string, JobInputValue>;
  aspectRatio?: string;
  /** Drives the pending-tile icon; 'set' templates render as image. */
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
  /** Resolves to the new folder id, or null if the create failed. */
  createFolder: (name: string, parentId?: string | null) => Promise<string | null>;
  renameFolder: (folderId: string, name: string) => void;
  deleteFolder: (folderId: string) => Promise<void>;
  moveProjectToFolder: (projectId: string, folderId: string | null) => void;
  renameProject: (projectId: string, name: string) => void;
  /** Pin an asset as the project cover; `null` reverts to newest-asset. */
  setProjectCover: (projectId: string, assetId: string | null) => void;
  deleteProject: (projectId: string) => Promise<void>;

  // favorites (global, across every project)
  /** Hearted assets, newest favorite first. */
  favorites: Asset[];
  favoritesLoading: boolean;
  /** Heart or un-heart in bulk; the tile button passes a single id. */
  setAssetsFavorite: (assetIds: string[], favorited: boolean) => void;

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
  addAttachment: (asset: AttachableAsset) => void;
  /**
   * The selected model's attachment rules — registered by the composer,
   * enforced in `addAttachment`. Null when no composer is mounted.
   */
  setAttachmentPolicy: (policy: AttachmentPolicy | null) => void;
  /**
   * Restore a past generation's setup into the composer — prompt, model,
   * tier, aspect ratio and its reference images — WITHOUT generating.
   * The prompt bar consumes `pendingSetup` and clears it once applied.
   */
  reuseSetup: (detail: AssetDetail) => void;
  pendingSetup: ReuseSetup | null;
  clearPendingSetup: () => void;
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
  /** Run a template job filed into the active project (same tile flow). */
  startTemplateJob: (opts: StartTemplateJobOptions) => Promise<void>;
  dismissPending: (jobId: string) => void;
};

const StudioContext = createContext<StudioValue | null>(null);

type ProjectsCache = ProjectsListResponse | undefined;

const PROJECTS_KEY = ["projects"] as const;
const FAVORITES_KEY = ["favorites"] as const;
const assetsKey = (projectId: string) => ["projects", projectId, "assets"] as const;

export function StudioProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn } = useAuth();
  const t = useTranslations("projects");
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
      const sdk = getSDK();
      // Page through the cursor so studios with >50 projects aren't
      // silently truncated. Folders arrive whole on the first page.
      const first = await sdk.projects.list({ limit: PAGE_SIZE });
      const projects = [...first.projects];
      let cursor = first.nextCursor;
      for (let page = 1; cursor && page < MAX_PAGES; page++) {
        const next = await sdk.projects.list({ limit: PAGE_SIZE, cursor });
        projects.push(...next.projects);
        cursor = next.nextCursor;
      }
      return {
        ...first,
        nextCursor: cursor,
        projects: projects.map((p) => ({
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

  const folders = useMemo(() => projectsQuery.data?.folders ?? EMPTY_FOLDERS, [projectsQuery.data]);
  const projects = useMemo(() => projectsQuery.data?.projects ?? EMPTY_PROJECTS, [projectsQuery.data]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const assetsQuery = useQuery({
    queryKey: assetsKey(activeProjectId ?? "none"),
    queryFn: async () => {
      const sdk = getSDK();
      const projectId = activeProjectId!;
      // Page through so large projects show every asset, not the first 50.
      const first = await sdk.projects.listAssets(projectId, { limit: PAGE_SIZE });
      const items = [...first.items];
      let cursor = first.nextCursor;
      for (let page = 1; cursor && page < MAX_PAGES; page++) {
        const next = await sdk.projects.listAssets(projectId, { limit: PAGE_SIZE, cursor });
        items.push(...next.items);
        cursor = next.nextCursor;
      }
      return items.map(toAsset);
    },
    enabled: isLoaded && !!isSignedIn && !!activeProjectId,
    staleTime: 5_000,
  });

  // Favorites are global, so unlike assets this query is not keyed on a
  // project and stays warm while the user moves between them.
  const favoritesQuery = useQuery({
    queryKey: FAVORITES_KEY,
    queryFn: async () => {
      const sdk = getSDK();
      const first = await sdk.projects.listFavorites({ limit: PAGE_SIZE });
      const items = [...first.items];
      let cursor = first.nextCursor;
      for (let page = 1; cursor && page < MAX_PAGES; page++) {
        const next = await sdk.projects.listFavorites({ limit: PAGE_SIZE, cursor });
        items.push(...next.items);
        cursor = next.nextCursor;
      }
      return items.map(toFavoriteAsset);
    },
    enabled: isLoaded && !!isSignedIn,
    staleTime: 15_000,
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
      let project;
      try {
        project = await getSDK().projects.create({ folderId });
      } catch (err) {
        toast.error(t("toastCreateProjectFailed"));
        throw err;
      }
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
    [queryClient, invalidateProjects, t],
  );

  /**
   * Returns the new folder's id so the caller can act on it — the sidebar
   * drops a freshly created folder straight into rename mode, which it
   * cannot do without knowing which row is new. `null` on failure; the
   * toast has already fired by then.
   */
  const createFolder = useCallback(
    async (name: string, parentId?: string | null): Promise<string | null> => {
      let created: string | null = null;
      try {
        created = (await getSDK().projects.createFolder(name, parentId ?? null)).id;
      } catch {
        // Includes `max_depth` — the fourth level the database refuses.
        toast.error(t("toastCreateFolderFailed"));
        return null;
      }
      invalidateProjects();
      return created;
    },
    [invalidateProjects, t],
  );

  // Cancel any in-flight projects refetch so its (stale) response can't
  // land after an optimistic write and revert/resurrect what we changed.
  const cancelProjects = useCallback(
    () => void queryClient.cancelQueries({ queryKey: PROJECTS_KEY }),
    [queryClient],
  );

  const renameFolder = useCallback(
    (folderId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      cancelProjects();
      // Optimistic: reflect the new name instantly, reconcile on settle.
      queryClient.setQueryData(PROJECTS_KEY, (prev: ProjectsCache) =>
        prev
          ? {
              ...prev,
              folders: prev.folders.map((f) =>
                f.id === folderId ? { ...f, name: trimmed } : f,
              ),
            }
          : prev,
      );
      getSDK()
        .projects.renameFolder(folderId, trimmed)
        .catch(() => toast.error(t("toastRenameFailed")))
        .finally(invalidateProjects);
    },
    [queryClient, cancelProjects, invalidateProjects, t],
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      cancelProjects();
      // Optimistic: drop the folder and unfile its projects (server does
      // the same via ON DELETE SET NULL — no projects are lost).
      queryClient.setQueryData(PROJECTS_KEY, (prev: ProjectsCache) =>
        prev
          ? {
              ...prev,
              folders: prev.folders.filter((f) => f.id !== folderId),
              projects: prev.projects.map((p) =>
                p.folderId === folderId ? { ...p, folderId: null } : p,
              ),
            }
          : prev,
      );
      try {
        await getSDK().projects.deleteFolder(folderId);
        toast.success(t("toastFolderDeleted"));
      } catch {
        toast.error(t("toastDeleteFolderFailed"));
      } finally {
        invalidateProjects();
      }
    },
    [queryClient, cancelProjects, invalidateProjects, t],
  );

  const moveProjectToFolder = useCallback(
    (projectId: string, folderId: string | null) => {
      cancelProjects();
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
        .catch(() => toast.error(t("toastMoveFailed")))
        .finally(invalidateProjects);
    },
    [queryClient, cancelProjects, invalidateProjects, t],
  );

  const renameProject = useCallback(
    (projectId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      cancelProjects();
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
        .catch(() => toast.error(t("toastRenameFailed")))
        .finally(invalidateProjects);
    },
    [queryClient, cancelProjects, invalidateProjects, t],
  );

  const setProjectCover = useCallback(
    (projectId: string, assetId: string | null) => {
      cancelProjects();
      getSDK()
        .projects.update(projectId, { coverAssetId: assetId })
        .catch(() => toast.error(t("toastCoverFailed")))
        // The cover URL is derived server-side, so refetch rather than
        // patching the cache with a guess at which asset won.
        .finally(invalidateProjects);
    },
    [cancelProjects, invalidateProjects, t],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      cancelProjects();
      // Optimistic removal; clear the active selection if it was open.
      queryClient.setQueryData(PROJECTS_KEY, (prev: ProjectsCache) =>
        prev ? { ...prev, projects: prev.projects.filter((p) => p.id !== projectId) } : prev,
      );
      setActiveProjectId((cur) => (cur === projectId ? null : cur));
      try {
        await getSDK().projects.delete(projectId);
        toast.success(t("toastProjectDeleted"));
      } catch {
        toast.error(t("toastDeleteProjectFailed"));
      } finally {
        invalidateProjects();
      }
    },
    [queryClient, cancelProjects, invalidateProjects, t],
  );

  /* ---------------------------------------------------------- assets */

  const copyAssets = useCallback(
    (assetIds: string[], targetProjectId: string) => {
      getSDK()
        .projects.copyAssets(targetProjectId, assetIds)
        .catch(() => toast.error(t("toastCopyFailed")))
        .finally(() => {
          invalidateAssets(targetProjectId);
          invalidateProjects();
        });
      setSelectedAssetIds([]);
    },
    [invalidateAssets, invalidateProjects, t],
  );

  const moveAssets = useCallback(
    (assetIds: string[], fromProjectId: string, targetProjectId: string) => {
      if (fromProjectId === targetProjectId) return;
      getSDK()
        .projects.moveAssets(assetIds, targetProjectId)
        .catch(() => toast.error(t("toastMoveAssetsFailed")))
        .finally(() => {
          invalidateAssets(fromProjectId);
          invalidateAssets(targetProjectId);
          invalidateProjects();
        });
      setSelectedAssetIds([]);
    },
    [invalidateAssets, invalidateProjects, t],
  );

  const deleteAssets = useCallback(
    (projectId: string, assetIds: string[]) => {
      // Cancel an in-flight assets refetch so it can't re-add the rows we
      // optimistically remove below.
      void queryClient.cancelQueries({ queryKey: assetsKey(projectId) });
      // Optimistic removal from the visible grid.
      queryClient.setQueryData(assetsKey(projectId), (prev: Asset[] | undefined) =>
        prev ? prev.filter((a) => !assetIds.includes(a.id)) : prev,
      );
      getSDK()
        .projects.deleteAssets(assetIds)
        .catch(() => toast.error(t("toastDeleteAssetsFailed")))
        .finally(() => {
          invalidateAssets(projectId);
          invalidateProjects();
        });
      setSelectedAssetIds([]);
    },
    [queryClient, invalidateAssets, invalidateProjects, t],
  );

  /* ------------------------------------------------------ favorites */

  /**
   * Heart / un-heart in bulk. One code path serves the tile button (a
   * one-element array), the info panel and the selection bar.
   *
   * The optimistic write touches two places: every cached project grid
   * (so the heart fills instantly wherever the asset is on screen) and
   * the global favorites list (so the Favorites page reflects it without
   * a round-trip). Newly favorited tiles are prepended because the
   * server orders by favorite time, not asset time.
   */
  const setAssetsFavorite = useCallback(
    (assetIds: string[], favorited: boolean) => {
      if (assetIds.length === 0) return;
      const ids = new Set(assetIds);
      void queryClient.cancelQueries({ queryKey: FAVORITES_KEY });

      // Collect the tiles being favorited before mutating, so they can be
      // spliced into the favorites list. Assets already in that list (a
      // re-favorite) are skipped by the dedupe below.
      const added: Asset[] = [];
      if (favorited) {
        for (const [, data] of queryClient.getQueriesData({ queryKey: ["projects"] })) {
          if (!Array.isArray(data)) continue;
          for (const a of data as Asset[]) {
            if (ids.has(a.id) && !added.some((x) => x.id === a.id)) added.push(a);
          }
        }
      }

      // Flip the heart in every project grid held in cache. The
      // `['projects']` root query holds a ProjectsListResponse rather
      // than an array, hence the guard.
      queryClient.setQueriesData({ queryKey: ["projects"] }, (prev: unknown) =>
        Array.isArray(prev)
          ? (prev as Asset[]).map((a) => (ids.has(a.id) ? { ...a, favorited } : a))
          : prev,
      );

      queryClient.setQueryData(FAVORITES_KEY, (prev: Asset[] | undefined) => {
        if (!prev) return prev;
        if (!favorited) return prev.filter((a) => !ids.has(a.id));
        const fresh = added
          .filter((a) => !prev.some((p) => p.id === a.id))
          .map((a) => ({ ...a, favorited: true }));
        return [...fresh, ...prev];
      });

      getSDK()
        .projects.setAssetsFavorite(assetIds, favorited)
        .catch(() => {
          toast.error(t("toastFavoriteFailed"));
          // Roll back by refetching rather than reversing by hand — the
          // failure could be partial and the server is the truth.
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
        })
        .finally(() => void queryClient.invalidateQueries({ queryKey: FAVORITES_KEY }));
    },
    [queryClient, t],
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
      const kind: PromptAttachment["kind"] = file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "image";
      const previewUrl = URL.createObjectURL(file);
      setAttachments((prev) => [
        ...prev,
        { id, kind, previewUrl, name: file.name, status: "uploading", progress: 0 },
      ]);
      // Clip length for the price preview (video input is billed) and
      // the audio chip label. Display-only — the server re-derives the
      // billing figure from the uploaded bytes.
      if (kind !== "image") {
        const el = document.createElement(kind === "video" ? "video" : "audio");
        el.preload = "metadata";
        el.onloadedmetadata = () => {
          const durationSec = Number.isFinite(el.duration) ? el.duration : undefined;
          if (durationSec) {
            setAttachments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, durationSec } : a)),
            );
          }
          el.src = "";
        };
        el.src = previewUrl;
      }
      uploadAttachment(id, file, file.name);
    },
    [uploadAttachment],
  );

  /**
   * Handed to the prompt bar rather than applied here: model, tier and
   * ratio are the composer's own state, and the studio has no business
   * reaching into it. This is a one-shot baton — set on re-use, cleared
   * by the consumer.
   */
  const [pendingSetup, setPendingSetup] = useState<ReuseSetup | null>(null);
  const clearPendingSetup = useCallback(() => setPendingSetup(null), []);

  const reuseSetup = useCallback(
    (detail: AssetDetail) => {
      const gen = detail.generation;
      if (!gen) return;
      // References first: the composer clears attachments when the model
      // changes, so they have to land after the model is applied. The
      // prompt bar owns that ordering; we only carry the payload.
      setPendingSetup({
        // The asset's own kind IS the model's kind — a video asset can
        // only have come from a video model.
        kind: detail.kind,
        prompt: gen.prompt ?? "",
        modelKey: gen.modelKey,
        aspectRatio: gen.aspectRatio,
        quality: gen.quality,
        duration: gen.duration,
        sound: gen.sound,
        // Ordered start frame → end frame → references by the API, which
        // is exactly the order a frames-mode model expects them in.
        referenceUrls: gen.references.map((r) => r.url),
      });
      toast.success(t("reuseApplied"));
    },
    [t],
  );

  // A ref, not state: the policy is read inside callbacks, never
  // rendered, and the composer re-registers it on every model change —
  // state would re-render every studio consumer for nothing.
  const attachmentPolicy = useRef<AttachmentPolicy | null>(null);
  const setAttachmentPolicy = useCallback((policy: AttachmentPolicy | null) => {
    attachmentPolicy.current = policy;
  }, []);

  const addAttachment = useCallback(
    (asset: AttachableAsset) => {
      const policy = attachmentPolicy.current;
      // Model-aware refusal with a reason. The old behavior was a bare
      // `return` on anything non-image — "Add as reference" on a video
      // tile looked like a button that simply did nothing.
      if (asset.type === "video" && !(policy?.acceptsVideos ?? false)) {
        toast.error(
          policy?.modelName
            ? t("attachVideoUnsupported", { model: policy.modelName })
            : t("attachVideoUnsupportedGeneric"),
        );
        return;
      }
      if (asset.type === "image" && policy && !policy.acceptsImages) {
        toast.error(t("attachImageUnsupported", { model: policy.modelName ?? "" }));
        return;
      }
      // Same ceilings the composer enforces on file picks — an asset
      // attached from a tile must not slip past them.
      if (policy && attachments.length >= policy.ceiling) {
        toast.error(t("attachLimitReached", { max: policy.ceiling }));
        return;
      }
      if (
        policy &&
        asset.type === "video" &&
        attachments.filter((a) => a.kind === "video").length >= policy.maxVideos
      ) {
        toast.error(t("attachVideoLimitReached", { max: policy.maxVideos }));
        return;
      }
      const id = `att-${seq.current++}`;
      setAttachments((prev) =>
        prev.some((a) => a.previewUrl === asset.src)
          ? prev
          : [
              ...prev,
              { id, kind: asset.type, previewUrl: asset.src, status: "uploading", progress: 0 },
            ],
      );
      // Clip length for the price preview — canvas videos are served
      // with permissive CORS, so metadata loads fine.
      if (asset.type === "video") {
        const el = document.createElement("video");
        el.preload = "metadata";
        el.onloadedmetadata = () => {
          const durationSec = Number.isFinite(el.duration) ? el.duration : undefined;
          if (durationSec) {
            setAttachments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, durationSec } : a)),
            );
          }
          el.src = "";
        };
        el.src = asset.src;
      }
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
    [uploadAttachment, attachments, t],
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

  // One key covers both the balance and the bucket breakdown: the credit
  // menu now derives from the `/me` row rather than holding its own query
  // (see `lib/use-credits.ts`).
  const invalidateBalances = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
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

  const startTemplateJob = useCallback(
    async ({ templateId, inputs, aspectRatio, kind }: StartTemplateJobOptions) => {
      const projectId = activeProjectId ?? (await createProject(null));
      const res = await getSDK().generation.submit({
        templateId,
        inputs,
        options: aspectRatio ? { aspectRatio } : {},
        idempotencyKey: crypto.randomUUID(),
        projectId,
      });
      trackJob(res.jobId, projectId, kind);
      invalidateBalances();
    },
    [activeProjectId, createProject, trackJob, invalidateBalances],
  );

  const dismissPending = useCallback(
    (jobId: string) => setPending((prev) => prev.filter((p) => p.jobId !== jobId)),
    [],
  );

  // ── Rehydrate in-flight tiles after a reload ─────────────────────
  //
  // `pending` is plain client state, so a refresh used to eat every
  // "generating…" tile while the jobs kept running server-side — the
  // outputs then popped into the grid with no warning. On sign-in, read
  // the newest jobs once and re-track anything still queued/processing
  // (in-flight work is by definition recent, so one page is enough).
  // `trackJob` restores both the tile and the poll subscription.
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || rehydratedRef.current) return;
    rehydratedRef.current = true;
    getSDK()
      .library.listProjects({ limit: 50 })
      .then(({ items }) => {
        for (const job of items) {
          if (job.status !== "queued" && job.status !== "processing") continue;
          // Mobile jobs have no studio project — nowhere to show a tile.
          if (!job.projectId) continue;
          if (unsubs.current.has(job.id)) continue;
          trackJob(job.id, job.projectId, job.templateKind === "video" ? "video" : "image");
        }
      })
      .catch(() => {
        // Purely cosmetic restore — the grid still updates on refetch,
        // so a failed rehydrate is not worth an error surface.
      });
  }, [isLoaded, isSignedIn, trackJob]);

  const activeAssets = assetsQuery.data ?? EMPTY_ASSETS;
  const favorites = favoritesQuery.data ?? EMPTY_ASSETS;

  // Memoized so `useStudio()` consumers only re-render when something they
  // read actually changes, not on every provider render.
  const value = useMemo<StudioValue>(
    () => ({
      folders,
      projects,
      projectsLoading: projectsQuery.isLoading,
      activeProjectId,
      activeProject,
      activeAssets,
      activeAssetsLoading: assetsQuery.isLoading,
      setActiveProject,
      createProject,
      createFolder,
      renameFolder,
      deleteFolder,
      moveProjectToFolder,
      renameProject,
      setProjectCover,
      deleteProject,
      favorites,
      favoritesLoading: favoritesQuery.isLoading,
      setAssetsFavorite,
      copyAssets,
      moveAssets,
      deleteAssets,
      selectedAssetIds,
      toggleAssetSelection,
      clearSelection,
      attachments,
      attachFile,
      addAttachment,
      setAttachmentPolicy,
      reuseSetup,
      pendingSetup,
      clearPendingSetup,
      removeAttachment,
      clearAttachments,
      pending,
      startGeneration,
      startTemplateJob,
      dismissPending,
    }),
    [
      folders,
      projects,
      projectsQuery.isLoading,
      activeProjectId,
      activeProject,
      activeAssets,
      assetsQuery.isLoading,
      setActiveProject,
      createProject,
      createFolder,
      renameFolder,
      deleteFolder,
      moveProjectToFolder,
      renameProject,
      setProjectCover,
      deleteProject,
      favorites,
      favoritesQuery.isLoading,
      setAssetsFavorite,
      copyAssets,
      moveAssets,
      deleteAssets,
      selectedAssetIds,
      toggleAssetSelection,
      clearSelection,
      attachments,
      attachFile,
      addAttachment,
      setAttachmentPolicy,
      reuseSetup,
      pendingSetup,
      clearPendingSetup,
      removeAttachment,
      clearAttachments,
      pending,
      startGeneration,
      startTemplateJob,
      dismissPending,
    ],
  );

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
