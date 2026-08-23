'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { Template, Category, TemplateKind, MediaRef } from '@clickfy/types';
import { ChevronDownIcon, Film, GalleryHorizontal, ImageIcon, ImagePlus, Languages, Loader2, Video as VideoIcon, X, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { setTemplateField } from '@/lib/i18n-content';
import { toast } from 'sonner';

import {
  uploadImageAsset,
  uploadVideoAsset,
  ACCEPTED_IMAGE_MIME,
  ACCEPTED_VIDEO_MIME,
  VIDEO_COMPRESS_HINT_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  ApiError,
} from '@/lib/api/uploads';
import { apiFetch, type TokenGetter } from '@/lib/api';

interface BasicInfoTabProps {
  template: Partial<Template>;
  categories: Category[];
  onChange: (data: Partial<Template>) => void;
  /**
   * Clerk token getter — required for cover / gallery uploads to
   * `/v1/admin/uploads`. The page wires this from `useAuth()`.
   */
  getToken: TokenGetter;
}

/**
 * What the user gets from this template — drives the mobile card label
 * ("Image", "Video", "Set"). For the pipeline shape (e.g. "render an
 * image then animate it"), see the Generation tab.
 */
const templateKinds: { value: TemplateKind; label: string; description: string; icon: typeof ImageIcon }[] = [
  { value: 'image', label: 'Image', description: 'Single still output', icon: ImageIcon },
  { value: 'video', label: 'Video', description: 'Short video clip output', icon: Film },
  { value: 'image_set', label: 'Image set', description: 'Coordinated lookbook (4–6 images)', icon: GalleryHorizontal },
  { value: 'video_image', label: 'Video + Image', description: 'A still plus its animated clip (image → video pipeline)', icon: VideoIcon },
];

/**
 * Display URL for a `MediaRef`. Prefer a foreign CDN URL if one is
 * set (e.g. a Cloudflare Images variant); otherwise rebuild the
 * Worker-proxy URL from `r2Key` against the *current* API base. We
 * deliberately reject `cdnUrl` values that point at one of our own
 * historical hosts — those go stale after a Worker hostname change
 * and would otherwise break every old row until a backfill runs.
 */
function mediaPreviewUrl(media: MediaRef | null | undefined): string {
  if (!media) return '';
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
  if (media.cdnUrl) {
    try {
      const host = new URL(media.cdnUrl).host;
      const apiHost = apiBase ? new URL(apiBase).host : '';
      const isOwnHost =
        host === apiHost ||
        host === 'api.clickefy.ai' ||
        host === 'clickfy-api.clickefy-ai.workers.dev';
      if (!isOwnHost) return media.cdnUrl;
    } catch {
      // fall through to r2Key path
    }
  }
  if (media.r2Key) return `${apiBase}/v1/uploads/${media.r2Key}`;
  return '';
}

const MAX_GALLERY_IMAGES = 12;

/**
 * Build a parent-first grouping of the categories list:
 *   [{ root, children: [...] }, ...]
 *
 * `categories` already arrives sorted by sortOrder + name from the
 * API, so the natural order of roots and their children is preserved
 * here. Children orphaned from a deleted parent (shouldn't happen in
 * practice — DELETE blocks parents with kids) fall back to their own
 * top-level entry to stay visible.
 */
function groupCategoriesByParent(
  categories: Category[],
): { root: Category; children: Category[] }[] {
  const roots = categories.filter((c) => !c.parentId);
  const byParent = new Map<string, Category[]>();
  for (const c of categories) {
    if (!c.parentId) continue;
    const arr = byParent.get(c.parentId) ?? [];
    arr.push(c);
    byParent.set(c.parentId, arr);
  }
  const groups = roots.map((root) => ({
    root,
    children: byParent.get(root.id) ?? [],
  }));
  // Surface any orphans (children whose parent is missing from the
  // list — defensive only; deletes are blocked server-side when kids
  // exist) so the admin can still pick them rather than silently
  // hiding rows.
  const seenIds = new Set<string>();
  for (const g of groups) {
    seenIds.add(g.root.id);
    for (const c of g.children) seenIds.add(c.id);
  }
  for (const c of categories) {
    if (!seenIds.has(c.id)) groups.push({ root: c, children: [] });
  }
  return groups;
}

const COVER_ACCEPT_ATTR = [...ACCEPTED_IMAGE_MIME, ...ACCEPTED_VIDEO_MIME].join(',');
const COVER_ACCEPTED_MIME = new Set<string>([
  ...ACCEPTED_IMAGE_MIME,
  ...ACCEPTED_VIDEO_MIME,
]);

const GALLERY_ACCEPT_ATTR = ACCEPTED_IMAGE_MIME.join(',');
const GALLERY_ACCEPTED_MIME = new Set<string>(ACCEPTED_IMAGE_MIME);

/**
 * Filter a DataTransfer.files list down to the image MIME types we
 * accept (mirrors the `accept` attribute on the hidden inputs).
 * Keeps the surface area for surprises tiny — drag-drop has historically
 * been the source of "user dragged a .HEIC and our server choked".
 */
function pickImagesFromDataTransfer(dt: DataTransfer): File[] {
  return Array.from(dt.files).filter((file) => GALLERY_ACCEPTED_MIME.has(file.type));
}

/**
 * Filter for the cover dropzone — accepts both images and videos.
 * If the user drops a mix (which Finder allows), we take the first
 * file of whichever class showed up and drop the rest with a toast.
 */
function pickCoverFilesFromDataTransfer(dt: DataTransfer): File[] {
  return Array.from(dt.files).filter((file) => COVER_ACCEPTED_MIME.has(file.type));
}

function isVideoFile(file: File): boolean {
  return (ACCEPTED_VIDEO_MIME as readonly string[]).includes(file.type);
}

/**
 * Build a FileList-shaped object from an array of Files so we can
 * funnel drag-drop and `<input type=file>` through the same handler.
 * DataTransfer exists in all modern browsers; we use it as the
 * cross-browser FileList constructor.
 */
function filesToList(files: File[]): FileList {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return dt.files;
}

/**
 * Multi-select-as-chips for the 0..2 extra categories a template can
 * appear under in addition to its primary.
 *
 * Behaviour:
 *   - The currently-selected primary is rendered as disabled — you
 *     can't put it in both buckets (the API would reject it anyway).
 *   - Tapping a chip toggles membership. Hitting the cap of 2 disables
 *     all unselected chips with a hint.
 *   - Order is by `categories` (which is the admin's drag-drop sort);
 *     the join-table `sort_order` is server-assigned in selection
 *     order, so the *first chip you tap* becomes the first extra.
 */
/**
 * Extra category memberships allowed on top of the primary.
 * Mirrors `extraCategoryIds: z.array(...).max(2)` in the API's
 * template-schemas — exceeding it here would only earn a 422.
 */
const MAX_EXTRA_CATEGORIES = 2;

function ExtraCategoriesPicker({
  categories,
  primaryId,
  selected,
  onChange,
}: {
  categories: Category[];
  primaryId: string;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const atCap = selected.length >= MAX_EXTRA_CATEGORIES;
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const groups = useMemo(() => groupCategoriesByParent(categories), [categories]);

  function toggle(id: string, next: boolean) {
    if (!next) {
      onChange(selected.filter((x) => x !== id));
      return;
    }
    // Server caps this at 2 as well; refusing here keeps the request
    // from being rejected after the admin thinks it landed.
    if (atCap) return;
    onChange([...selected, id]);
  }

  /**
   * One row of the menu. `closeOnClick` defaults to false on base-ui's
   * CheckboxItem, so the menu stays open across several picks — which is
   * the whole point of a multi-select.
   */
  const renderItem = (cat: Category, isChild: boolean) => {
    const isPrimary = cat.id === primaryId;
    const isSelected = selected.includes(cat.id);
    // The primary is already a membership; offering it here would let
    // the admin create a duplicate the backend rejects.
    const disabled = isPrimary || (atCap && !isSelected);
    return (
      <DropdownMenuCheckboxItem
        key={cat.id}
        checked={isSelected}
        disabled={disabled}
        onCheckedChange={(next) => toggle(cat.id, next)}
        className={cn(isChild && 'pl-8')}
      >
        <span className="truncate">{cat.name}</span>
        {isPrimary ? (
          <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            primary
          </span>
        ) : null}
      </DropdownMenuCheckboxItem>
    );
  };

  return (
    <div className="space-y-2">
      {/* Same h-6 header row as the primary-category column beside it,
          so the two dropdowns sit on one baseline. */}
      <div className="flex h-6 items-center justify-between gap-3">
        <Label>Other categories</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {selected.length}/{MAX_EXTRA_CATEGORIES}
        </span>
      </div>

      <DropdownMenu>
        {/* Styled to match SelectTrigger beside it — base-ui's MenuTrigger
            already renders a native button, so className is enough. */}
        <DropdownMenuTrigger className="flex h-10 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50">
          <span
            className={cn(
              'truncate',
              selected.length === 0 && 'text-muted-foreground',
            )}
          >
            {selected.length === 0
              ? 'None — optional'
              : selected
                  .map((id) => byId.get(id)?.name ?? 'Unknown')
                  .join(', ')}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </DropdownMenuTrigger>

        {/* The popup already matches the trigger width and scrolls; the
            extra cap keeps ~40 categories from filling the viewport. */}
        <DropdownMenuContent className="max-h-72">
          {groups.map((group, idx) => {
            if (group.children.length === 0) {
              return renderItem(group.root, false);
            }
            return (
              <DropdownMenuGroup key={group.root.id}>
                {idx > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {group.root.name}
                </DropdownMenuLabel>
                {renderItem(group.root, false)}
                {group.children.map((child) => renderItem(child, true))}
              </DropdownMenuGroup>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Selected shown as removable chips so the current state is
          readable without opening the menu. */}
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-1 pl-2.5 pr-1 text-xs font-medium text-primary"
            >
              {byId.get(id)?.name ?? 'Unknown'}
              <button
                type="button"
                aria-label={`Remove ${byId.get(id)?.name ?? 'category'}`}
                onClick={() => onChange(selected.filter((x) => x !== id))}
                className="grid size-4 place-items-center rounded-full text-primary/70 transition-colors hover:bg-primary/20 hover:text-primary"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Up to {MAX_EXTRA_CATEGORIES} extra places this template appears,
        on top of its primary category.
      </p>
    </div>
  );
}

export function BasicInfoTab({ template, categories, onChange, getToken }: BasicInfoTabProps) {
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [translatingField, setTranslatingField] = useState<'title' | 'description' | null>(null);

  /**
   * Auto-translate ONE English field into its Arabic override via
   * `POST /v1/admin/translate` (DeepSeek; style guide lives in
   * apps/api/src/lib/translate-deepseek.ts). Fills the field only —
   * the admin still reviews, tweaks, and saves.
   */
  const translateField = async (field: 'title' | 'description') => {
    const source = (field === 'title' ? template.title : template.description)?.trim();
    if (!source) {
      toast.error(`Write the English ${field} first.`);
      return;
    }
    setTranslatingField(field);
    try {
      const { translations } = await apiFetch<{
        translations: Record<string, string>;
      }>('/v1/admin/translate', {
        method: 'POST',
        json: {
          texts: { [field]: source },
          context:
            'Template card copy for an AI product photo & video generation app.',
        },
        getToken,
      });
      const value = translations[field];
      if (!value) throw new Error('empty');
      onChange({ translations: setTemplateField(template.translations, 'ar', field, value) });
      toast.success('Arabic filled — review before saving.');
    } catch {
      toast.error('Translation failed. Try again in a moment.');
    } finally {
      setTranslatingField(null);
    }
  };
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [coverDragActive, setCoverDragActive] = useState(false);
  const [galleryDragActive, setGalleryDragActive] = useState(false);

  const gallery = template.gallery ?? [];
  // Live ref so async upload handlers always read the latest gallery
  // when they append. Without this, a rapid second drop captures the
  // pre-first-drop array and `onChange` overwrites the first batch's
  // additions when it finishes. Classic React closure trap. We key
  // the sync effect on `template.gallery` (the stable identity from
  // the parent store) rather than the per-render `gallery` array —
  // the `?? []` fallback would otherwise allocate every render and
  // re-fire the effect uselessly.
  const galleryRef = useRef<MediaRef[]>(gallery);
  useEffect(() => {
    galleryRef.current = template.gallery ?? [];
  }, [template.gallery]);

  /**
   * Append a freshly-uploaded image to the gallery using the LATEST
   * ref'd array, not whatever was captured at handler invocation.
   * Stable across overlapping batches.
   */
  const appendToGallery = (item: MediaRef) => {
    const next = [...galleryRef.current, item];
    galleryRef.current = next;
    onChange({ gallery: next });
  };

  const handleCoverUpload = async (file: File | null) => {
    if (!file) return;
    setUploadingCover(true);
    try {
      if (isVideoFile(file)) {
        // Friendly nudge before the round-trip — bigger files still go
        // through, but admins appreciate the heads-up before waiting on
        // 25 MB over a hotel Wi-Fi.
        if (file.size > VIDEO_COMPRESS_HINT_BYTES) {
          toast.info(
            `Heads up: this video is ${(file.size / 1024 / 1024).toFixed(1)} MB. Consider compressing (Handbrake / CloudConvert) for faster uploads.`,
          );
        }

        const { media, poster } = await uploadVideoAsset(file, 'templates', getToken, {
          // Only auto-capture a poster when the admin hasn't picked
          // their own cover image yet. Avoids silently overwriting an
          // already-chosen still.
          capturePoster: !template.coverMedia,
        });

        const previewVideo: MediaRef = {
          r2Key: media.r2Key,
          cdnUrl: media.cdnUrl,
          width: media.width,
          height: media.height,
          blurhash: media.blurhash,
        };

        const update: Partial<Template> = { previewVideo };
        if (poster && !template.coverMedia) {
          update.coverMedia = {
            r2Key: poster.r2Key,
            cdnUrl: poster.cdnUrl,
            width: poster.width,
            height: poster.height,
            blurhash: poster.blurhash,
          };
        }
        onChange(update);
        toast.success(
          poster && !template.coverMedia
            ? 'Preview video uploaded — middle frame captured as cover'
            : 'Preview video uploaded',
        );
      } else {
        const uploaded = await uploadImageAsset(file, 'templates', getToken);
        // Drop `fileName` — not part of `MediaRef`. The cdnUrl / r2Key /
        // dimensions / blurhash are everything the persisted row needs.
        const coverMedia: MediaRef = {
          r2Key: uploaded.r2Key,
          cdnUrl: uploaded.cdnUrl,
          width: uploaded.width,
          height: uploaded.height,
          blurhash: uploaded.blurhash,
        };
        onChange({ coverMedia });
        toast.success('Cover image uploaded');
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Cover upload failed';
      toast.error(msg);
    } finally {
      setUploadingCover(false);
    }
  };

  const removePreviewVideo = () => {
    onChange({ previewVideo: null });
  };

  const handleGalleryUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // Use the live ref instead of the render-time capture so a second
    // batch dropped mid-upload still respects the real running count.
    const remaining = MAX_GALLERY_IMAGES - galleryRef.current.length;
    if (remaining <= 0) {
      toast.error(`Gallery is full (max ${MAX_GALLERY_IMAGES} images).`);
      return;
    }
    const toUpload = Array.from(files).slice(0, remaining);
    if (Array.from(files).length > remaining) {
      toast.info(
        `Gallery cap is ${MAX_GALLERY_IMAGES} images — uploading the first ${remaining} of this batch.`,
      );
    }

    setUploadingGallery(true);
    try {
      // Upload in parallel and progressively append each success.
      // Progressive append means the admin sees thumbnails the moment
      // each upload lands instead of waiting for the slowest file in
      // the batch. `appendToGallery` reads the live ref each time, so
      // overlapping batches don't clobber each other.
      const results = await Promise.allSettled(
        toUpload.map(async (file) => {
          const uploaded = await uploadImageAsset(file, 'templates', getToken);
          const item: MediaRef = {
            r2Key: uploaded.r2Key,
            cdnUrl: uploaded.cdnUrl,
            width: uploaded.width,
            height: uploaded.height,
            blurhash: uploaded.blurhash,
          };
          appendToGallery(item);
          return file.name;
        }),
      );

      let succeeded = 0;
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          succeeded += 1;
          return;
        }
        const err = r.reason;
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Upload failed';
        const fileName = toUpload[idx]?.name ?? 'file';
        toast.error(`${fileName}: ${msg}`);
      });

      if (succeeded > 0) {
        toast.success(
          succeeded === 1
            ? '1 image added to gallery'
            : `${succeeded} images added to gallery`,
        );
      }
    } finally {
      setUploadingGallery(false);
    }
  };

  const removeGalleryItem = (index: number) => {
    const next = gallery.filter((_, i) => i !== index);
    onChange({ gallery: next });
  };

  return (
    <div className="space-y-6">
      {/* Title — English and Arabic side by side. They are the same
          field in two locales, so reading them as a pair is the point;
          stacking them put the Arabic override directly under the
          English input where it looked like a second, unrelated field. */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex h-6 items-center">
            <Label htmlFor="title">Template title</Label>
          </div>
          <Input
            id="title"
            value={template.title || ''}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="e.g., Luxury Skincare Product"
          />
        </div>

        {/* Arabic override — falls back to the English title above when
            left blank. Stored under translations.ar.title. The Translate
            button sits on this field because this is the field it fills. */}
        <div className="space-y-2">
          <div className="flex h-6 items-center justify-between gap-2">
            <Label htmlFor="title-ar">
              Title <span className="text-muted-foreground">(العربية)</span>
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={translatingField !== null || !template.title?.trim()}
              onClick={() => translateField('title')}
            >
              {translatingField === 'title' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Languages className="h-3 w-3" />
              )}
              Translate
            </Button>
          </div>
          <Input
            id="title-ar"
            dir="rtl"
            lang="ar"
            value={template.translations?.ar?.title ?? ''}
            onChange={(e) =>
              onChange({
                translations: setTemplateField(
                  template.translations,
                  'ar',
                  'title',
                  e.target.value,
                ),
              })
            }
            placeholder="عنوان القالب بالعربية"
          />
        </div>
      </div>

      {/* Categories — primary and extras are one decision, so they sit
          on one row rather than a dropdown up here and a wall of chips
          further down the panel. */}
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex h-6 items-center">
            <Label>Primary category</Label>
          </div>
          <Select
            // Resolve primary from the new field with fallback to the
            // legacy `categoryId` so editors that loaded before a
            // backend deploy still see the right pre-selected value.
            value={template.primaryCategoryId ?? template.categoryId ?? ''}
            onValueChange={(value) => {
              const next = value || undefined;
              // If the new primary is currently in the extras list,
              // drop it from extras to keep the invariant clean — the
              // backend would reject the request anyway.
              const extras = (template.extraCategoryIds ?? []).filter(
                (id) => id !== next,
              );
              onChange({
                primaryCategoryId: next,
                categoryId: next,
                extraCategoryIds: extras,
              });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a primary category">
                {(value) => {
                  if (!value || typeof value !== 'string') return null;
                  return categories.find((cat) => cat.id === value)?.name ?? value;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {/* Two-level grouping: every root is its own SelectGroup
                  with its children listed underneath as indented
                  items. Roots with no children render as a plain
                  SelectItem (no header, less visual noise). */}
              {groupCategoriesByParent(categories).map((group, idx) => {
                if (group.children.length === 0) {
                  return (
                    <SelectItem key={group.root.id} value={group.root.id}>
                      {group.root.name}
                    </SelectItem>
                  );
                }
                return (
                  <div key={group.root.id}>
                    {idx > 0 ? <SelectSeparator /> : null}
                    <SelectGroup>
                      <SelectLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.root.name}
                      </SelectLabel>
                      <SelectItem value={group.root.id}>
                        {group.root.name}{' '}
                        <span className="text-muted-foreground">(all)</span>
                      </SelectItem>
                      {group.children.map((child) => (
                        <SelectItem key={child.id} value={child.id}>
                          <span className="text-muted-foreground">↳</span>{' '}
                          {child.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </div>
                );
              })}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The category this template most belongs to. Used for
            breadcrumbs, analytics roll-ups, and home-feed placement.
          </p>
          {/* Soft hint when the picked primary is a root that has
              sub-categories — picking a sub helps discovery without
              changing where the template appears (parents aggregate
              their children's templates). */}
          {(() => {
            const primaryId =
              template.primaryCategoryId ?? template.categoryId ?? '';
            if (!primaryId) return null;
            const picked = categories.find((c) => c.id === primaryId);
            if (!picked || picked.parentId) return null;
            const hasChildren = categories.some(
              (c) => c.parentId === picked.id,
            );
            if (!hasChildren) return null;
            return (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                <strong>{picked.name}</strong> has sub-categories. Picking
                one (e.g. <em>Perfumes</em>) improves discovery in the app
                — the template still rolls up into <strong>{picked.name}</strong>.
              </p>
            );
          })()}
        </div>

        {/* Also-show-in — secondary memberships. Max 2 extras → 3 total. */}
        <ExtraCategoriesPicker
          categories={categories}
          primaryId={template.primaryCategoryId ?? template.categoryId ?? ''}
          selected={template.extraCategoryIds ?? []}
          onChange={(extras) => onChange({ extraCategoryIds: extras })}
        />
      </div>

      {/* Description — single field, line-clamped on cards */}
      <div className="space-y-2">
        <Label htmlFor="desc">Description</Label>
        <Textarea
          id="desc"
          value={template.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="What does this template do? When should someone use it?"
          className="min-h-[120px]"
        />
        <p className="text-xs text-muted-foreground">
          Shown in full on the template detail page; clamped to two lines
          on rails / category cards.
        </p>
        {/* Arabic override — falls back to the English description when
            left blank. Stored under translations.ar.description. */}
        <div className="flex items-center justify-between">
          <Label htmlFor="desc-ar" className="text-xs text-muted-foreground">
            Description (العربية)
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={translatingField !== null}
            onClick={() => translateField('description')}
          >
            {translatingField === 'description' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Languages className="h-3 w-3" />
            )}
            Translate
          </Button>
        </div>
        <Textarea
          id="desc-ar"
          dir="rtl"
          lang="ar"
          value={template.translations?.ar?.description ?? ''}
          onChange={(e) =>
            onChange({
              translations: setTemplateField(
                template.translations,
                'ar',
                'description',
                e.target.value,
              ),
            })
          }
          placeholder="وصف القالب بالعربية"
          className="min-h-[120px]"
        />
      </div>

      <Separator />

      {/* Template Kind — visual selector */}
      <div className="space-y-3">
        <Label>Template Kind</Label>
        <div className="grid grid-cols-3 gap-3">
          {templateKinds.map(({ value, label, description, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ kind: value })}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center',
                template.kind === value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/30 bg-transparent'
              )}
            >
              <Icon className={cn('h-6 w-6', template.kind === value ? 'text-primary' : 'text-muted-foreground')} />
              <div>
                <p className={cn('text-sm font-medium', template.kind === value ? 'text-foreground' : 'text-muted-foreground')}>
                  {label}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
              </div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          User-facing output shape. The internal pipeline (e.g. &quot;image
          then animate&quot;) is configured in the Generation tab.
        </p>
      </div>

      <Separator />

      {/* Settings row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            id="featured"
            checked={template.featured || false}
            onChange={(e) => onChange({ featured: e.target.checked })}
            className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-ring"
          />
          <div>
            <Label htmlFor="featured" className="cursor-pointer">Featured Template</Label>
            <p className="text-xs text-muted-foreground">Highlighted in the mobile app homepage</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            id="aspect-ratio-toggle"
            checked={template.userCanChooseAspectRatio || false}
            onChange={(e) => onChange({ userCanChooseAspectRatio: e.target.checked })}
            className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-ring"
          />
          <div>
            <Label htmlFor="aspect-ratio-toggle" className="cursor-pointer">User Aspect Ratio</Label>
            <p className="text-xs text-muted-foreground">Let users pick aspect ratio in the app</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Cover Image & Preview Gallery */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Cover & Preview Gallery</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cover accepts an image <strong>or</strong> a short video (MP4 / MOV up to {MAX_VIDEO_UPLOAD_BYTES / 1024 / 1024} MB). Videos
            auto-play muted &amp; looped on mobile, with the first frame
            extracted as a still cover. Gallery is image-only.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {/* Cover image — required to publish, single image. Accepts
              clicks and drag-drop. We render a <div> with role=button
              rather than a <button> because nested <button>s would
              confuse a11y and we want native drop targets. */}
          <div>
            <Label className="mb-2 block text-xs text-muted-foreground">
              Cover Image / Preview Video <span className="text-destructive">*</span>
            </Label>
            <div
              role="button"
              tabIndex={0}
              aria-disabled={uploadingCover}
              onClick={() => {
                if (uploadingCover) return;
                coverInputRef.current?.click();
              }}
              onKeyDown={(e) => {
                if (uploadingCover) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  coverInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                if (uploadingCover) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                if (!coverDragActive) setCoverDragActive(true);
              }}
              onDragLeave={(e) => {
                // Ignore events fired by children leaving — only react when the
                // cursor leaves the dropzone proper.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setCoverDragActive(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setCoverDragActive(false);
                if (uploadingCover) return;
                const files = pickCoverFilesFromDataTransfer(e.dataTransfer);
                if (files.length === 0) {
                  toast.error('Only PNG / JPEG / WebP / HEIC images or MP4 / MOV videos are accepted.');
                  return;
                }
                void handleCoverUpload(files[0] ?? null);
              }}
              className={cn(
                'block w-full aspect-video bg-muted/30 rounded-xl border-2 border-dashed transition-colors relative overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                coverDragActive
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50',
                uploadingCover && 'opacity-50 cursor-not-allowed',
              )}
            >
              {/*
                Render priority inside the cover slot:
                  1. Preview video — when set, autoplay + loop the clip
                     over the cover image (matching the mobile UX).
                  2. Cover image — still poster, no video.
                  3. Empty state — drop affordance.
              */}
              {template.previewVideo ? (
                <>
                  {/*
                    Native <video> is the right preview element here:
                    autoplay + muted + loop + playsInline is exactly
                    what mobile's `VideoPreview` does, so admins see a
                    faithful render of how the card will look.
                  */}
                  <video
                    key={template.previewVideo.r2Key}
                    src={mediaPreviewUrl(template.previewVideo)}
                    poster={template.coverMedia ? mediaPreviewUrl(template.coverMedia) : undefined}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="absolute inset-0 h-full w-full object-cover pointer-events-none"
                  />
                  {/* Video badge */}
                  <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white pointer-events-none">
                    <VideoIcon className="h-3 w-3" />
                    PREVIEW VIDEO
                  </div>
                  {(uploadingCover || coverDragActive) && (
                    <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-1.5 pointer-events-none">
                      {uploadingCover ? (
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      ) : (
                        <>
                          <ImagePlus className="h-6 w-6 text-primary" />
                          <p className="text-xs text-primary font-medium">Drop to replace</p>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : template.coverMedia ? (
                <>
                  { }
                  <img
                    src={mediaPreviewUrl(template.coverMedia)}
                    alt="Cover"
                    className="absolute inset-0 h-full w-full object-cover pointer-events-none"
                  />
                  {(uploadingCover || coverDragActive) && (
                    <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-1.5 pointer-events-none">
                      {uploadingCover ? (
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      ) : (
                        <>
                          <ImagePlus className="h-6 w-6 text-primary" />
                          <p className="text-xs text-primary font-medium">Drop to replace</p>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full pointer-events-none">
                  {uploadingCover ? (
                    <Loader2 className="h-7 w-7 text-primary animate-spin" />
                  ) : (
                    <>
                      <ImagePlus className={cn('h-7 w-7 mb-1.5', coverDragActive ? 'text-primary' : 'text-muted-foreground')} />
                      <p className={cn('text-xs', coverDragActive ? 'text-primary font-medium' : 'text-muted-foreground')}>
                        {coverDragActive ? 'Drop image or video' : 'Upload or drop image / video'}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
            {/* Below-slot controls: remove preview video without nuking the cover */}
            {template.previewVideo && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Cover still image is used as the poster frame on mobile.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={removePreviewVideo}
                  className="text-xs h-7"
                >
                  <X className="h-3 w-3 mr-1" />
                  Remove video
                </Button>
              </div>
            )}
            {/*
              `sr-only` (not `hidden` aka `display: none`) so Safari
              honours the programmatic `.click()` triggered from the
              dropzone's onClick handler. Safari rejects click()s on
              fully-removed-from-layout file inputs — the symptom in
              the field was "drag-drop works, click does nothing".
            */}
            <input
              ref={coverInputRef}
              type="file"
              accept={COVER_ACCEPT_ATTR}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = '';
                void handleCoverUpload(file);
              }}
            />
          </div>

          {/* Preview gallery — up to 12 images, displayed on the detail
              page carousel. Same click + drop semantics as the cover
              dropzone, but accepts multiple files at once. */}
          <div>
            <Label className="mb-2 block text-xs text-muted-foreground">
              Preview Gallery ({gallery.length}/{MAX_GALLERY_IMAGES})
            </Label>
            {(() => {
              const galleryDisabled = uploadingGallery || gallery.length >= MAX_GALLERY_IMAGES;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  aria-disabled={galleryDisabled}
                  onClick={() => {
                    if (galleryDisabled) return;
                    galleryInputRef.current?.click();
                  }}
                  onKeyDown={(e) => {
                    if (galleryDisabled) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      galleryInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    if (galleryDisabled) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (!galleryDragActive) setGalleryDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                    setGalleryDragActive(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setGalleryDragActive(false);
                    if (galleryDisabled) return;
                    const files = pickImagesFromDataTransfer(e.dataTransfer);
                    if (files.length === 0) {
                      toast.error('Only PNG, JPEG, WebP, or HEIC images are accepted.');
                      return;
                    }
                    void handleGalleryUpload(filesToList(files));
                  }}
                  className={cn(
                    'w-full aspect-video bg-muted/30 rounded-xl border-2 border-dashed transition-colors flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    galleryDragActive
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50',
                    galleryDisabled && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <div className="text-center pointer-events-none">
                    {uploadingGallery ? (
                      <Loader2 className="h-7 w-7 text-primary animate-spin mx-auto" />
                    ) : (
                      <>
                        <ImagePlus
                          className={cn(
                            'h-7 w-7 mx-auto mb-1.5',
                            galleryDragActive ? 'text-primary' : 'text-muted-foreground',
                          )}
                        />
                        <p
                          className={cn(
                            'text-xs',
                            galleryDragActive ? 'text-primary font-medium' : 'text-muted-foreground',
                          )}
                        >
                          {gallery.length >= MAX_GALLERY_IMAGES
                            ? 'Gallery full'
                            : galleryDragActive
                              ? 'Drop images here'
                              : 'Upload or drop images'}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
            {/* See note on the cover input — `sr-only` not `hidden`
                so Safari opens the picker when the dropzone is clicked. */}
            <input
              ref={galleryInputRef}
              type="file"
              accept={GALLERY_ACCEPT_ATTR}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                // `e.target.files` is a *live* FileList — resetting
                // `value` below empties it, which would leave
                // handleGalleryUpload with zero files and silently
                // bail. Snapshot into a fresh FileList first.
                const picked = e.target.files
                  ? filesToList(Array.from(e.target.files))
                  : null;
                e.target.value = '';
                void handleGalleryUpload(picked);
              }}
            />
          </div>
        </div>

        {gallery.length > 0 && (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 pt-2">
            {gallery.map((item, idx) => (
              <div
                key={`${item.r2Key}-${idx}`}
                className="relative aspect-square rounded-lg overflow-hidden border bg-muted/20 group"
              >
                { }
                <img
                  src={mediaPreviewUrl(item)}
                  alt={`Gallery ${idx + 1}`}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <Button
                  size="icon-xs"
                  variant="destructive"
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => removeGalleryItem(idx)}
                  title="Remove from gallery"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
