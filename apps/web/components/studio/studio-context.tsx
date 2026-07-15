"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/* ------------------------------------------------------------------ model */

export type AssetType = "image" | "video";
export type Asset = { id: string; type: AssetType; src: string; poster?: string };
export type Project = {
  id: string;
  name: string;
  folderId: string | null;
  time: string;
  assets: Asset[];
};
export type Folder = { id: string; name: string };

/* -------------------------------------------------------------- seed data */

const IMG = [
  "/assets/9c80f14bd51b051bb029053c71e3bbb3.jpg",
  "/assets/21a4d7e76d86558a6c1b63db2982edbd.jpg",
  "/assets/0f8dad5a57467f8788f0e6be98924c2e.jpg",
  "/assets/16654be06b68b715118b40c4a9c2f7ff.jpg",
  "/assets/987ac62f95b7292782498f28bea6e2e5.jpg",
  "/assets/1853e30e65039bdaca0f3b5d5a927a31.jpg",
  "/assets/19d64ae180f986f329e0427901e0a3b6.jpg",
  "/assets/44f6c9193c5fbad553a39365e643d325.jpg",
  "/assets/4a3759d212ca16933c5a0ef7d424b46e.jpg",
  "/assets/66c2bc99b2707c10686fdeaf0af29a0b.jpg",
  "/assets/9679583672ad21cc7486dbf5bf221444.jpg",
  "/assets/1ded17351c618f995413d16f71061a4e.jpg",
  "/assets/16ea40729954d9f7955c0aa18b5311a7.jpg",
  "/assets/425321aaa07c0244454cdab421f9dcf2-2.jpg",
  "/assets/9dc49668408f711f0a052b89dcdba229.jpg",
  "/assets/1772177693429-b8d6ddbe-824f-4e3e-a953-eebd2e05df47.png",
  "/assets/1772188591187-52f24a65-074f-4e7e-90b4-edd0ea0f6756.png",
  "/assets/1770284669759-acdd530e-27e4-41f5-9495-c992286a2783.png",
];

const VID: { src: string; poster: string }[] = [
  { src: "/assets/129a6607-51c0-4231-9cd9-1c4d05a400d2.mp4", poster: IMG[3] },
  { src: "/assets/975be97a-9951-4b13-8164-7669d9e62c62.mp4", poster: IMG[4] },
  { src: "/assets/8a479299-2b06-40df-8b58-ca62fff20480.mp4", poster: IMG[9] },
  { src: "/assets/522455bf-ff1f-41c5-a048-a9f40b06763c.mp4", poster: IMG[11] },
];

let assetSeq = 0;
const imgAsset = (src: string): Asset => ({ id: `a${assetSeq++}`, type: "image", src });
const vidAsset = (v: { src: string; poster: string }): Asset => ({
  id: `a${assetSeq++}`,
  type: "video",
  src: v.src,
  poster: v.poster,
});

const SEED_FOLDERS: Folder[] = [
  { id: "campaigns", name: "Moonwhale Campaigns" },
  { id: "experiments", name: "Experiments" },
];

const SEED_PROJECTS: Project[] = [
  {
    id: "lavender",
    name: "Lavender skincare campaign",
    folderId: "campaigns",
    time: "Just now",
    assets: [...IMG.slice(0, 12).map(imgAsset), vidAsset(VID[0]), vidAsset(VID[1])],
  },
  {
    id: "summer",
    name: "Summer fashion concepts",
    folderId: "campaigns",
    time: "Yesterday",
    assets: [...IMG.slice(1, 8).map(imgAsset), vidAsset(VID[2])],
  },
  {
    id: "coffee",
    name: "Coffee launch imagery",
    folderId: "experiments",
    time: "Yesterday",
    assets: IMG.slice(4, 12).map(imgAsset),
  },
  {
    id: "portrait",
    name: "Portrait lighting tests",
    folderId: null,
    time: "Yesterday",
    assets: [...IMG.slice(2, 9).map(imgAsset), vidAsset(VID[3])],
  },
];

/* ---------------------------------------------------------------- context */

type StudioValue = {
  folders: Folder[];
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;

  // projects & folders
  setActiveProject: (id: string | null) => void;
  createProject: (folderId?: string | null) => string;
  createFolder: (name: string) => string;
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
  attachments: Asset[];
  addAttachment: (asset: Asset) => void;
  removeAttachment: (assetId: string) => void;
  clearAttachments: () => void;
};

const StudioContext = createContext<StudioValue | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [folders, setFolders] = useState<Folder[]>(SEED_FOLDERS);
  const [projects, setProjects] = useState<Project[]>(SEED_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState<string | null>("lavender");
  const [attachments, setAttachments] = useState<Asset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const seq = useRef(1);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const setActiveProject = useCallback((id: string | null) => {
    setActiveProjectId(id);
    setSelectedAssetIds([]);
  }, []);

  const createProject = useCallback((folderId: string | null = null) => {
    const id = `untitled-${seq.current++}`;
    setProjects((prev) => [
      { id, name: "Untitled project", folderId, time: "Just now", assets: [] },
      ...prev,
    ]);
    setActiveProjectId(id);
    return id;
  }, []);

  const createFolder = useCallback((name: string) => {
    const id = `folder-${seq.current++}`;
    setFolders((prev) => [...prev, { id, name: name.trim() || "New folder" }]);
    return id;
  }, []);

  const moveProjectToFolder = useCallback((projectId: string, folderId: string | null) => {
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, folderId } : p)));
  }, []);

  const renameProject = useCallback((projectId: string, name: string) => {
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, name } : p)));
  }, []);

  const copyAssets = useCallback((assetIds: string[], targetProjectId: string) => {
    setProjects((prev) => {
      const source = prev.flatMap((p) => p.assets).filter((a) => assetIds.includes(a.id));
      const clones = source.map((a) => ({ ...a, id: `a-copy-${seq.current++}` }));
      return prev.map((p) =>
        p.id === targetProjectId ? { ...p, assets: [...clones, ...p.assets] } : p,
      );
    });
    setSelectedAssetIds([]);
  }, []);

  const moveAssets = useCallback(
    (assetIds: string[], fromProjectId: string, targetProjectId: string) => {
      if (fromProjectId === targetProjectId) return;
      setProjects((prev) => {
        const moving = prev
          .find((p) => p.id === fromProjectId)
          ?.assets.filter((a) => assetIds.includes(a.id));
        if (!moving?.length) return prev;
        return prev.map((p) => {
          if (p.id === fromProjectId)
            return { ...p, assets: p.assets.filter((a) => !assetIds.includes(a.id)) };
          if (p.id === targetProjectId) return { ...p, assets: [...moving, ...p.assets] };
          return p;
        });
      });
      setSelectedAssetIds([]);
    },
    [],
  );

  const deleteAssets = useCallback((projectId: string, assetIds: string[]) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId ? { ...p, assets: p.assets.filter((a) => !assetIds.includes(a.id)) } : p,
      ),
    );
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

  const addAttachment = useCallback((asset: Asset) => {
    setAttachments((prev) => (prev.some((a) => a.id === asset.id) ? prev : [...prev, asset]));
  }, []);
  const removeAttachment = useCallback(
    (assetId: string) => setAttachments((prev) => prev.filter((a) => a.id !== assetId)),
    [],
  );
  const clearAttachments = useCallback(() => setAttachments([]), []);

  const value: StudioValue = {
    folders,
    projects,
    activeProjectId,
    activeProject,
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
    addAttachment,
    removeAttachment,
    clearAttachments,
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used within <StudioProvider>");
  return ctx;
}
