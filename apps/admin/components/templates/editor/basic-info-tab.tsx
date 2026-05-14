'use client';

import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { Template, Category, TemplateKind, MediaRef } from '@clickfy/types';
import { ImagePlus, ImageIcon, Film, GalleryHorizontal, Loader2, X, Video as VideoIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
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
import type { TokenGetter } from '@/lib/api';

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

const COVER_ACCEPT_ATTR = [...ACCEPTED_IMAGE_MIME, ...ACCEPTED_VIDEO_MIME].join(',');
const COVER_ACCEPTED_MIME = new Set<string>([
  ...ACCEPTED_IMAGE_MIME,
  ...ACCEPTED_VIDEO_MIME,
]);

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

export function BasicInfoTab({ template, categories, onChange, getToken }: BasicInfoTabProps) {
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [coverDragActive, setCoverDragActive] = useState(false);
  const [galleryDragActive, setGalleryDragActive] = useState(false);

  const gallery = template.gallery ?? [];

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
            ? 'Preview video uploaded — first frame captured as cover'
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
    const remaining = MAX_GALLERY_IMAGES - gallery.length;
    if (remaining <= 0) {
      toast.error(`Gallery is full (max ${MAX_GALLERY_IMAGES} images).`);
      return;
    }
    const toUpload = Array.from(files).slice(0, remaining);

    setUploadingGallery(true);
    try {
      // Upload sequentially so a single failure doesn't orphan a half-
      // updated gallery in zustand. We accumulate successes and surface
      // a single toast at the end.
      const next: MediaRef[] = [...gallery];
      let succeeded = 0;
      for (const file of toUpload) {
        try {
          const uploaded = await uploadImageAsset(file, 'templates', getToken);
          next.push({
            r2Key: uploaded.r2Key,
            cdnUrl: uploaded.cdnUrl,
            width: uploaded.width,
            height: uploaded.height,
            blurhash: uploaded.blurhash,
          });
          succeeded += 1;
        } catch (err) {
          const msg =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Upload failed';
          toast.error(`${file.name}: ${msg}`);
        }
      }
      onChange({ gallery: next });
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
      {/* Title & Category */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="title">Template Title</Label>
          <Input
            id="title"
            value={template.title || ''}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="e.g., Luxury Skincare Product"
          />
        </div>

        <div className="space-y-2">
          <Label>Category</Label>
          {/*
            Base UI's Select considers `value === undefined` to be the
            uncontrolled state and flips to controlled the moment we
            pass a string. The dev warning is loud and ugly. Coerce
            to '' so the component is controlled from the first render;
            the placeholder still shows because Base UI's `SelectValue`
            falls back to its `placeholder` prop when no item matches.
          */}
          <Select
            value={template.categoryId ?? ''}
            onValueChange={(value) => onChange({ categoryId: value || undefined })}
          >
            <SelectTrigger className="w-full">
              {/*
                Base UI's <SelectValue /> renders the raw `value` by default,
                so a category UUID leaks into the trigger. The children
                render-prop receives the current value and lets us look up
                the display label ourselves.
              */}
              <SelectValue placeholder="Select a category">
                {(value) => {
                  if (!value || typeof value !== 'string') return null;
                  return categories.find((cat) => cat.id === value)?.name ?? value;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Author */}
      <div className="space-y-2">
        <Label htmlFor="author">Author</Label>
        <Input
          id="author"
          value={template.authorName ?? ''}
          onChange={(e) => onChange({ authorName: e.target.value })}
          placeholder="Clickfy Studio"
        />
        <p className="text-xs text-muted-foreground">
          Credit shown on the template detail page in the mobile app.
        </p>
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
                  toast.error('Only PNG / JPEG / WebP images or MP4 / MOV videos are accepted.');
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
            <input
              ref={coverInputRef}
              type="file"
              accept={COVER_ACCEPT_ATTR}
              className="hidden"
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
                      toast.error('Only PNG, JPEG, and WebP images are accepted.');
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
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                e.target.value = '';
                void handleGalleryUpload(files);
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
