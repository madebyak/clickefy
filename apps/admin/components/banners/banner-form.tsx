'use client';

/**
 * Banner editor form — used for both create and edit dialogs.
 *
 * Field layout:
 *   - Kind (image / video) — exactly one media file per banner row.
 *     Slider behavior on mobile comes from creating multiple banner
 *     rows (the home screen pages between them automatically), not
 *     from a multi-image kind.
 *   - Media uploader: single file
 *   - Title, Subtitle (optional)
 *   - Active toggle, schedule pickers (datetime-local; both optional)
 *
 * CTA UI is intentionally not rendered in v1 — banners default to
 * `cta.kind = 'none'`. The schema + API already accept CTAs, so a
 * future "Add CTA" button is purely additive.
 */

import { useAuth } from '@clerk/nextjs';
import { Loader2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  uploadImageAsset,
  uploadVideoAsset,
  type UploadResult,
} from '@/lib/api/uploads';
import type { HomeBanner, HomeBannerKind } from '@/lib/api/banners';

export interface BannerFormValues {
  kind: HomeBannerKind;
  media: UploadResult[];
  title: string;
  subtitle: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

interface BannerFormProps {
  banner?: HomeBanner;
  onSubmit: (values: BannerFormValues) => Promise<void>;
  onCancel: () => void;
}

function toIsoLocal(value: string | null | undefined): string {
  if (!value) return '';
  // datetime-local inputs want `YYYY-MM-DDTHH:mm` (no timezone, no
  // seconds). We render the user's local time and convert back to ISO
  // on submit so admins see the timestamps they entered.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromIsoLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function BannerForm({ banner, onSubmit, onCancel }: BannerFormProps) {
  const { getToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Coerce any legacy `image_slider` rows back to `image` in the
  // editor — the slider concept now lives at the row-list level, not
  // inside a single banner row.
  const initialKind: HomeBannerKind =
    banner?.kind === 'image_slider' ? 'image' : (banner?.kind ?? 'image');
  const [kind, setKind] = useState<HomeBannerKind>(initialKind);
  // Existing banner: media is already MediaRef[] from the API. Convert
  // to the local UploadResult shape (which is just MediaRef + fileName)
  // so the uploader's append/remove logic doesn't have to branch.
  const [media, setMedia] = useState<UploadResult[]>(
    () =>
      banner?.media.map((m) => ({
        ...m,
        // Existing rows don't carry the original filename; show the
        // r2Key tail as a stand-in.
        fileName: m.r2Key.split('/').pop() ?? 'media',
      })) ?? [],
  );
  const [title, setTitle] = useState(banner?.title ?? '');
  const [subtitle, setSubtitle] = useState(banner?.subtitle ?? '');
  const [isActive, setIsActive] = useState(banner?.isActive ?? true);
  const [startsAt, setStartsAt] = useState(toIsoLocal(banner?.startsAt));
  const [endsAt, setEndsAt] = useState(toIsoLocal(banner?.endsAt));
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);

    try {
      const results: UploadResult[] = [];
      for (const file of files) {
        // Route per-MIME so video banners use the video upload path.
        // `uploadVideoAsset` returns `{ media, poster }`; we only need
        // the video MediaRef (`media`) — the auto-captured poster is
        // unused here because the banner renderer uses the same URL
        // as both video and poster source.
        const isVideo = file.type.startsWith('video/');
        if (isVideo) {
          const { media: vmedia } = await uploadVideoAsset(file, 'banners', getToken, {
            capturePoster: false,
          });
          results.push(vmedia);
        } else {
          results.push(await uploadImageAsset(file, 'banners', getToken));
        }
      }
      setMedia(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      toast.error(message);
    } finally {
      setUploading(false);
      // Allow re-selecting the same file (browser dedupes by default).
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeMedia = (idx: number) => {
    setMedia((prev) => prev.filter((_, i) => i !== idx));
  };

  // Switching kind clears media so an image upload doesn't sit under
  // a "video" kind label (and vice versa). Both kinds accept exactly
  // one file.
  const handleKindChange = (next: HomeBannerKind) => {
    if (next === kind) return;
    setKind(next);
    setMedia([]);
  };

  const acceptForKind: string =
    kind === 'video' ? 'video/mp4,video/quicktime' : 'image/jpeg,image/png,image/webp,image/heic,image/heif';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Per-kind media count check. Mirrors the server-side rule so
    // admins see the failure before the network round-trip.
    if (media.length === 0) {
      toast.error('Please upload at least one media file.');
      return;
    }
    if (media.length !== 1) {
      toast.error('A banner needs exactly one media file.');
      return;
    }
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      toast.error('End date must be after start date.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        kind,
        media,
        title,
        subtitle,
        isActive,
        startsAt: fromIsoLocal(startsAt),
        endsAt: fromIsoLocal(endsAt),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="banner-kind">Kind</Label>
        <Select value={kind} onValueChange={(v) => handleKindChange(v as HomeBannerKind)}>
          <SelectTrigger id="banner-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="image">Image</SelectItem>
            <SelectItem value="video">Video (auto-play, muted, looping)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Media (16:9 recommended)</Label>
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
          {media.length > 0 ? (
            <ul className="space-y-2">
              {media.map((m, idx) => (
                <li
                  key={`${m.r2Key}-${idx}`}
                  className="flex items-center gap-3 rounded-md bg-background p-2 border"
                >
                  <span className="text-xs text-muted-foreground w-6 text-center">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{m.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.width} × {m.height}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMedia(idx)}
                    aria-label={`Remove media ${idx + 1}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No media uploaded yet.</p>
          )}

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptForKind}
              onChange={handleFiles}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading || media.length >= 1}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {media.length === 0 ? 'Upload media' : 'Replace media'}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Want a slider on the home screen? Create multiple banners — they pager-swipe in sort order.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="banner-title">Title (optional)</Label>
        <Input
          id="banner-title"
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Black Friday: 50% off"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="banner-subtitle">Subtitle (optional)</Label>
        <Textarea
          id="banner-subtitle"
          value={subtitle}
          maxLength={160}
          rows={2}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Drops every Friday until Dec 31"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="banner-starts-at">Starts at (optional)</Label>
          <Input
            id="banner-starts-at"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="banner-ends-at">Ends at (optional)</Label>
          <Input
            id="banner-ends-at"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label htmlFor="banner-active" className="text-sm font-medium">
            Active
          </Label>
          <p className="text-xs text-muted-foreground">
            Inactive banners never show on mobile, even within their schedule window.
          </p>
        </div>
        <Button
          id="banner-active"
          type="button"
          size="sm"
          variant={isActive ? 'default' : 'outline'}
          onClick={() => setIsActive((v) => !v)}
        >
          {isActive ? 'Active' : 'Inactive'}
        </Button>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || uploading}>
          {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {banner ? 'Save changes' : 'Create banner'}
        </Button>
      </div>
    </form>
  );
}
