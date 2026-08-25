"use client";

/**
 * "My Assets" — the user's uploaded media, and everything that changes it.
 *
 * ONE QUERY holds the whole library: the folder tree, every file, and
 * current usage. A media library is browsed by hopping between folders
 * constantly, and a request per hop makes that feel like a website rather
 * than a file manager. The payload carries keys and dimensions, never
 * bytes, so "everything" stays small.
 *
 * UPLOADS ARE TWO STEPS, deliberately. The bytes go through the SAME
 * `uploads.uploadUserAsset` a prompt attachment uses, then the resulting
 * object is REGISTERED into the library. One upload path means one place
 * enforces MIME allowlists, size caps and content sniffing.
 */

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import type { MediaAsset, MediaFolder } from "@clickfy/sdk";
import { describeUsage, fitsInQuota, formatBytes } from "@clickfy/types";
import { getSDK } from "@/lib/api";
import { rebaseAssetUrl } from "@/lib/rebase-url";

export const MEDIA_KEY = ["media-library"] as const;

/** What the browser accepts. Audio is absent — nothing can consume it. */
export const MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime";

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime"]);

/** Matches the server's `USER_MAX_BYTES`. Rejected here to save the trip. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface UploadingFile {
  id: string;
  name: string;
  /** 0–1. */
  progress: number;
  status: "uploading" | "error";
}

function kindOf(mime: string): "image" | "video" | null {
  if (IMAGE_MIME.has(mime)) return "image";
  if (VIDEO_MIME.has(mime)) return "video";
  return null;
}

export function useMediaLibrary() {
  const { isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const t = useTranslations("media");
  const [uploading, setUploading] = useState<UploadingFile[]>([]);

  const query = useQuery({
    queryKey: MEDIA_KEY,
    queryFn: async () => {
      const data = await getSDK().media.list();
      return {
        ...data,
        // Same rebase every other asset URL gets, so a library image and a
        // generated one resolve through the same host.
        assets: data.assets.map((a) => ({ ...a, url: rebaseAssetUrl(a.url) })),
      };
    },
    enabled: isLoaded && !!isSignedIn,
    staleTime: 30_000,
  });

  const folders = useMemo<MediaFolder[]>(() => query.data?.folders ?? [], [query.data]);
  const assets = useMemo<MediaAsset[]>(() => query.data?.assets ?? [], [query.data]);

  const usage = useMemo(
    () => describeUsage(query.data?.usage.usedBytes ?? 0, query.data?.usage.quotaBytes ?? 0),
    [query.data],
  );

  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: MEDIA_KEY }),
    [queryClient],
  );

  /* ------------------------------------------------------------ folders */

  const createFolder = useMutation({
    mutationFn: (input: { name: string; parentId?: string | null }) =>
      getSDK().media.createFolder(input),
    onSuccess: invalidate,
    onError: () => toast.error(t("folderCreateFailed")),
  });

  const renameFolder = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      getSDK().media.renameFolder(id, name),
    onSuccess: invalidate,
    onError: () => toast.error(t("folderRenameFailed")),
  });

  const deleteFolder = useMutation({
    mutationFn: (id: string) => getSDK().media.deleteFolder(id),
    onSuccess: invalidate,
    onError: () => toast.error(t("folderDeleteFailed")),
  });

  /* ------------------------------------------------------------- files */

  const deleteAssets = useMutation({
    mutationFn: (ids: string[]) => getSDK().media.deleteAssets(ids),
    onSuccess: invalidate,
    onError: () => toast.error(t("deleteFailed")),
  });

  const moveAsset = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      getSDK().media.updateAsset(id, { folderId }),
    onSuccess: invalidate,
    onError: () => toast.error(t("moveFailed")),
  });

  /**
   * Upload files into a folder.
   *
   * Checks the quota BEFORE sending a byte. The server checks again —
   * only it sees concurrent uploads — but telling someone their 200MB
   * batch will not fit after they have waited for it is the worst possible
   * moment to say so.
   */
  const uploadFiles = useCallback(
    async (files: File[], folderId: string | null) => {
      const accepted: File[] = [];
      let projected = usage.usedBytes;

      for (const file of files) {
        if (!kindOf(file.type)) {
          toast.error(t("unsupportedType", { name: file.name }));
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          toast.error(t("fileTooLarge", { name: file.name, max: formatBytes(MAX_FILE_BYTES) }));
          continue;
        }
        // Counts the batch cumulatively, so ten files that individually fit
        // but collectively do not are caught here rather than half-way
        // through the upload.
        if (!fitsInQuota(projected, usage.quotaBytes, file.size)) {
          toast.error(t("quotaExceeded", { remaining: formatBytes(usage.remainingBytes) }));
          break;
        }
        projected += file.size;
        accepted.push(file);
      }
      if (accepted.length === 0) return;

      const sdk = getSDK();
      await Promise.all(
        accepted.map(async (file) => {
          const localId = `${file.name}-${file.size}-${file.lastModified}`;
          setUploading((prev) => [
            ...prev,
            { id: localId, name: file.name, progress: 0, status: "uploading" },
          ]);
          try {
            const ref = await sdk.uploads.uploadUserAsset(
              { file, name: file.name, type: file.type, sizeBytes: file.size },
              {
                onProgress: (fraction) =>
                  setUploading((prev) =>
                    prev.map((u) => (u.id === localId ? { ...u, progress: fraction } : u)),
                  ),
              },
            );
            await sdk.media.register({
              r2Key: ref.key,
              name: file.name,
              kind: kindOf(file.type)!,
              mimeType: ref.contentType,
              sizeBytes: ref.sizeBytes,
              folderId,
            });
          } catch {
            toast.error(t("uploadFailed", { name: file.name }));
          } finally {
            setUploading((prev) => prev.filter((u) => u.id !== localId));
          }
        }),
      );
      invalidate();
    },
    [usage, invalidate, t],
  );

  return {
    folders,
    assets,
    usage,
    isLoading: query.isLoading,
    uploading,
    uploadFiles,
    createFolder: createFolder.mutateAsync,
    renameFolder: renameFolder.mutate,
    deleteFolder: deleteFolder.mutate,
    deleteAssets: deleteAssets.mutate,
    moveAsset: moveAsset.mutate,
  };
}

/**
 * Everything at one level of the tree, filtered by a search term.
 *
 * SEARCH IS GLOBAL, not scoped to the open folder. Someone typing "logo"
 * is looking for a file, not asking what the current folder contains that
 * matches — and a search that only looks where you already are is the
 * least useful kind. When the term is empty this collapses back to plain
 * folder browsing.
 */
export function useMediaBrowse(
  folders: MediaFolder[],
  assets: MediaAsset[],
  currentFolderId: string | null,
  search: string,
) {
  return useMemo(() => {
    const term = search.trim().toLowerCase();

    if (term) {
      return {
        folders: folders.filter((f) => f.name.toLowerCase().includes(term)),
        assets: assets.filter((a) => a.name.toLowerCase().includes(term)),
        searching: true,
      };
    }

    return {
      folders: folders.filter((f) => (f.parentId ?? null) === currentFolderId),
      assets: assets.filter((a) => (a.folderId ?? null) === currentFolderId),
      searching: false,
    };
  }, [folders, assets, currentFolderId, search]);
}

/** Root → … → current, for the breadcrumb. */
export function useBreadcrumb(folders: MediaFolder[], currentFolderId: string | null) {
  return useMemo(() => {
    const trail: MediaFolder[] = [];
    let id = currentFolderId;
    // Bounded by the three-level limit, but guarded anyway: a malformed
    // tree must not spin the render loop.
    for (let i = 0; id && i < 8; i++) {
      const f = folders.find((x) => x.id === id);
      if (!f) break;
      trail.unshift(f);
      id = f.parentId;
    }
    return trail;
  }, [folders, currentFolderId]);
}
