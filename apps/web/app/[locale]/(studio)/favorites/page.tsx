"use client";

/**
 * Favorites — every hearted asset, across every project, newest favorite
 * first.
 *
 * Deliberately NOT a composer surface: generating needs a project to
 * file the output into, and this view spans all of them. The tile
 * actions that do make sense here (add as reference, re-use) hand off to
 * the create page, where the composer lives. Un-hearting removes the
 * tile in place — the optimistic write in `setAssetsFavorite` drops it
 * from this list before the request lands.
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Heart } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { getSDK } from "@/lib/api";
import { useStudio, type Asset } from "@/components/studio/studio-context";
import { Masonry } from "@/components/studio/masonry";
import { AssetInfoPanel } from "@/components/studio/asset-info-panel";

/** Matches the tile's `duration-200` fade in the masonry. */
const EXIT_MS = 200;

function downloadAsset(a: Asset) {
  const el = document.createElement("a");
  el.href = a.src;
  el.download = a.src.split("/").pop() ?? "asset";
  document.body.appendChild(el);
  el.click();
  el.remove();
}

export default function FavoritesPage() {
  const t = useTranslations("studio");
  const router = useRouter();
  const { favorites, favoritesLoading, setAssetsFavorite, addAttachment, reuseSetup, deleteAssets } =
    useStudio();

  const [infoAsset, setInfoAsset] = useState<Asset | null>(null);
  const [reusingAssetId, setReusingAssetId] = useState<string | null>(null);
  // Tiles mid-fade. The optimistic write in `setAssetsFavorite` drops the
  // asset from `favorites` the instant it is called, so the fade has to
  // run BEFORE the mutation rather than after it.
  const [exitingIds, setExitingIds] = useState<string[]>([]);

  /** Where a restored setup should land — the composer is mode-specific. */
  const composerPath = (kind: Asset["type"]) => (kind === "video" ? "/create-video" : "/create");

  const handleReuse = useCallback(
    async (a: Asset) => {
      if (reusingAssetId) return;
      setReusingAssetId(a.id);
      try {
        const detail = await getSDK().projects.getAsset(a.projectId, a.id);
        if (!detail.generation?.prompt) {
          toast.error(t("reuseNothingToRestore"));
          return;
        }
        reuseSetup(detail);
        router.push(composerPath(a.type));
      } catch {
        toast.error(t("detailsUnavailable"));
      } finally {
        setReusingAssetId(null);
      }
    },
    [reusingAssetId, reuseSetup, router, t],
  );

  // Attaching from here is only useful next to a prompt box, so follow
  // the attachment to the composer rather than leaving the user on a
  // page where nothing visibly happened. Videos can't be references —
  // `addAttachment` drops them — so don't navigate for those either.
  const handleAttach = useCallback(
    (a: Asset) => {
      if (a.type !== "image") return;
      addAttachment(a);
      router.push(composerPath("image"));
    },
    [addAttachment, router],
  );

  // The panel holds a snapshot rather than a live cache entry: un-hearting
  // from inside it removes the asset from `favorites`, and looking it up
  // there would make the open panel go blank mid-interaction. Mirror the
  // flip locally so the button still reads correctly.
  const toggleInfoFavorite = useCallback(() => {
    if (!infoAsset) return;
    const next = !infoAsset.favorited;
    setAssetsFavorite([infoAsset.id], next);
    setInfoAsset({ ...infoAsset, favorited: next });
  }, [infoAsset, setAssetsFavorite]);

  const handleToggleFavorite = useCallback(
    (a: Asset) => {
      if (!a.favorited) {
        setAssetsFavorite([a.id], true);
        return;
      }
      setExitingIds((prev) => (prev.includes(a.id) ? prev : [...prev, a.id]));
      window.setTimeout(() => {
        setAssetsFavorite([a.id], false);
        setExitingIds((prev) => prev.filter((id) => id !== a.id));
      }, EXIT_MS);
    },
    [setAssetsFavorite],
  );

  const isEmpty = !favoritesLoading && favorites.length === 0;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-site">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("favorites")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("favoritesSub")}</p>
          </div>
        </div>

        {favoritesLoading && (
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        )}

        {isEmpty ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-surface-3">
              <Heart className="size-6 text-status-red" />
            </div>
            <h2 className="mt-5 text-lg font-semibold">{t("favoritesEmptyTitle")}</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              {t("favoritesEmptyBody")}
            </p>
          </div>
        ) : (
          <div className="mt-8">
            <Masonry
              assets={favorites}
              showProjectName
              onAssetClick={handleAttach}
              onAssetInfo={setInfoAsset}
              onAssetReuse={handleReuse}
              reusingAssetId={reusingAssetId}
              onToggleFavorite={handleToggleFavorite}
              onAssetDelete={(a) => deleteAssets(a.projectId, [a.id])}
              exitingIds={exitingIds}
            />
          </div>
        )}
      </div>

      {infoAsset && (
        <AssetInfoPanel
          projectId={infoAsset.projectId}
          assetId={infoAsset.id}
          onClose={() => setInfoAsset(null)}
          onDownload={() => downloadAsset(infoAsset)}
          favorited={infoAsset.favorited}
          onToggleFavorite={toggleInfoFavorite}
          onReuse={(detail) => {
            reuseSetup(detail);
            setInfoAsset(null);
            router.push(composerPath(detail.kind));
          }}
        />
      )}
    </main>
  );
}
