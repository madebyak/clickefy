'use client';

/**
 * /admin/home — manage the dynamic home-screen banner strip.
 *
 * Layout:
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │  Home  ·  banners shown above "Trending Now"       │
 *   │                                          [+ New]   │
 *   ├────────────────────────────────────────────────────┤
 *   │  ⠿  [thumb]  Title                Active   ⋯       │
 *   │  ⠿  [thumb]  Black Friday promo   Inactive ⋯       │
 *   │  …                                                 │
 *   └────────────────────────────────────────────────────┘
 *
 * Drag-handle reorder uses `@dnd-kit/sortable` (matches the
 * categories page). Drop persists optimistically, then PATCHes
 * `/v1/admin/banners/reorder`.
 *
 * Per-row action menu: Edit (opens dialog) · Toggle active ·
 * Delete (confirm).
 */

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '@clerk/nextjs';
import {
  CalendarClock,
  Film,
  GalleryHorizontal,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  MoreVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { BannerForm, type BannerFormValues } from '@/components/banners/banner-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBannersStore } from '@/lib/stores/banners-store';
import type { CreateBannerInput } from '@/lib/api/banners';
import type { HomeBanner } from '@/lib/api/banners';

export default function HomeBannersPage() {
  const { getToken } = useAuth();
  const {
    banners,
    loading,
    fetchBanners,
    createBanner,
    updateBanner,
    deleteBanner,
    reorderBanners,
  } = useBannersStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<HomeBanner | null>(null);
  const [deleting, setDeleting] = useState<HomeBanner | null>(null);

  useEffect(() => {
    void fetchBanners(getToken);
  }, [fetchBanners, getToken]);

  // ── DnD ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = banners.findIndex((b) => b.id === e.active.id);
    const newIdx = banners.findIndex((b) => b.id === e.over!.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(banners, oldIdx, newIdx);
    try {
      await reorderBanners(next, getToken);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reorder failed');
    }
  };

  // ── Mutations ────────────────────────────────────────────────────
  const valuesToCreatePayload = (v: BannerFormValues): CreateBannerInput => ({
    kind: v.kind,
    media: v.media.map(({ r2Key, width, height, blurhash, cdnUrl }) => ({
      r2Key,
      width,
      height,
      blurhash,
      cdnUrl,
    })),
    title: v.title.trim() || null,
    subtitle: v.subtitle.trim() || null,
    isActive: v.isActive,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
  });

  const handleCreate = async (values: BannerFormValues) => {
    try {
      await createBanner(valuesToCreatePayload(values), getToken);
      setCreateOpen(false);
      toast.success('Banner created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create banner');
    }
  };

  const handleUpdate = async (values: BannerFormValues) => {
    if (!editing) return;
    try {
      await updateBanner(editing.id, valuesToCreatePayload(values), getToken);
      setEditing(null);
      toast.success('Banner updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update banner');
    }
  };

  const handleToggleActive = async (banner: HomeBanner) => {
    try {
      await updateBanner(banner.id, { isActive: !banner.isActive }, getToken);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not toggle banner');
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteBanner(deleting.id, getToken);
      setDeleting(null);
      toast.success('Banner deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete banner');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Home</h1>
          <p className="text-muted-foreground mt-1">
            Banners rendered above the “Trending Now” rail. Drag to reorder.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New banner
        </Button>
      </div>

      <div className="bg-card rounded-lg border p-4">
        {loading && banners.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground mt-4">Loading banners…</p>
          </div>
        ) : banners.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No banners yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create one to start showing a hero strip on the home tab.
            </p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={banners.map((b) => b.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {banners.map((banner) => (
                  <SortableBannerRow
                    key={banner.id}
                    banner={banner}
                    onEdit={() => setEditing(banner)}
                    onToggleActive={() => handleToggleActive(banner)}
                    onDelete={() => setDeleting(banner)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New banner</DialogTitle>
            <DialogDescription>
              Renders above the “Trending Now” rail. 16:9 media recommended.
            </DialogDescription>
          </DialogHeader>
          <BannerForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit banner</DialogTitle>
            <DialogDescription>Changes apply on the next mobile fetch.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <BannerForm
              banner={editing}
              onSubmit={handleUpdate}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete banner?</DialogTitle>
            <DialogDescription>
              This permanently removes the banner. The uploaded media stays in R2 (clean up
              manually if needed).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sortable row ────────────────────────────────────────────────────

function SortableBannerRow({
  banner,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  banner: HomeBanner;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: banner.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const KindIcon = banner.kind === 'video' ? Film : banner.kind === 'image_slider' ? GalleryHorizontal : ImageIcon;
  const firstMedia = banner.media[0];
  const previewUrl = firstMedia?.cdnUrl ?? null;

  // Schedule label — small status hint per banner.
  const now = new Date();
  const starts = banner.startsAt ? new Date(banner.startsAt) : null;
  const ends = banner.endsAt ? new Date(banner.endsAt) : null;
  const liveNow = banner.isActive && (!starts || starts <= now) && (!ends || ends >= now);
  const scheduleLabel = liveNow
    ? 'Live now'
    : !banner.isActive
      ? 'Inactive'
      : starts && starts > now
        ? `Starts ${starts.toLocaleString()}`
        : ends && ends < now
          ? 'Ended'
          : 'Active';

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-md border bg-background p-3"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </button>

      <div className="h-12 w-20 overflow-hidden rounded bg-muted shrink-0">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <KindIcon className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <KindIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-sm font-medium truncate">{banner.title || 'Untitled banner'}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <CalendarClock className="h-3 w-3" />
          <span>{scheduleLabel}</span>
          <span>·</span>
          <span>{banner.media.length} media</span>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label="Banner actions"
        >
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleActive}>
            {banner.isActive ? 'Deactivate' : 'Activate'}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
