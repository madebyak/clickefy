"use client";

/**
 * Shared slot-source picker — "where does this image/video/audio come
 * from?" for one frame or reference slot.
 *
 * Extracted from the Seedance mode editor unchanged. Kling now binds
 * its first/last frames with the same `FrameSlotBinding` shape, and a
 * Kling stage importing a module called `seedance-mode-editor` to draw
 * its frame picker would be its own kind of wrong.
 *
 * The three source kinds are the provider-neutral ones:
 *   - `user_input`   — a template field the end user fills at run time
 *   - `stage_output` — a prior stage's output, for chaining
 *   - `admin_asset`  — an image baked into the template at edit time
 */

import { useRef, useState } from 'react';
import type { FrameSlotBinding, TemplateInput } from '@clickfy/types';
import { toast } from 'sonner';
import { ImageIcon, Music, Upload, Video } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { uploadImageAsset, uploadVideoAsset, ApiError } from '@/lib/api/uploads';
import type { TokenGetter } from '@/lib/api';

export type AssetKind = 'image' | 'video' | 'audio';

export function bindingLabel(b: FrameSlotBinding | undefined, userInputs: TemplateInput[]): string {
  if (!b) return 'Not set';
  if (b.kind === 'user_input') {
    const f = userInputs.find((u) => u.fieldKey === b.fieldKey);
    return f ? `User input — ${f.label || f.fieldKey}` : `User input — ${b.fieldKey}`;
  }
  if (b.kind === 'stage_output') return `Stage ${b.stageIndex} output`;
  return `Admin asset (${b.r2Key.split('/').pop()})`;
}

export function assetKindIcon(kind: AssetKind) {
  if (kind === 'video') return Video;
  if (kind === 'audio') return Music;
  return ImageIcon;
}

// ─── Slot source picker ──────────────────────────────────────────────

/**
 * Renders a 3-pane picker (User input / Stage output / Admin asset)
 * for a single slot binding. Restricts options to those that make sense
 * for the given `assetKind`:
 *   - audio: admin_asset only (no mobile audio picker exists yet)
 *   - video: any source, but user inputs filtered to type==='video'
 *   - image: any source, user inputs filtered to type==='image'|'video'
 *           (Seedance accepts a video frame as a still reference)
 */
export function SlotSourcePicker({
  binding,
  assetKind,
  userInputs,
  stageIndex,
  folder,
  getToken,
  onChange,
}: {
  binding: FrameSlotBinding | undefined;
  assetKind: AssetKind;
  userInputs: TemplateInput[];
  stageIndex: number;
  folder: 'templates';
  getToken: TokenGetter;
  onChange: (next: FrameSlotBinding | undefined) => void;
}) {
  const kind = binding?.kind ?? '';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  // Audio inputs aren't mobile-collectable, so force admin_asset.
  const allowedSourceKinds: ('user_input' | 'stage_output' | 'admin_asset')[] =
    assetKind === 'audio' ? ['admin_asset'] : ['user_input', 'stage_output', 'admin_asset'];

  // Compatible user inputs for this assetKind.
  const compatibleInputs = userInputs.filter((f) => {
    if (assetKind === 'audio') return false;
    if (assetKind === 'video') return f.type === 'video';
    return f.type === 'image' || f.type === 'video';
  });

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[160px_1fr] gap-2">
        <Select
          value={kind}
          onValueChange={(value) => {
            const next = value as 'user_input' | 'stage_output' | 'admin_asset' | '';
            if (!next) {
              onChange(undefined);
              return;
            }
            if (next === 'user_input') {
              onChange({ kind: 'user_input', fieldKey: compatibleInputs[0]?.fieldKey ?? '' });
            } else if (next === 'stage_output') {
              onChange({ kind: 'stage_output', stageIndex: Math.max(1, stageIndex) });
            } else {
              onChange({ kind: 'admin_asset', r2Key: '' });
            }
          }}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="Choose source" />
          </SelectTrigger>
          <SelectContent>
            {allowedSourceKinds.includes('user_input') && (
              <SelectItem value="user_input">User input</SelectItem>
            )}
            {allowedSourceKinds.includes('stage_output') && stageIndex >= 1 && (
              <SelectItem value="stage_output">Stage output</SelectItem>
            )}
            <SelectItem value="admin_asset">Admin asset (uploaded)</SelectItem>
          </SelectContent>
        </Select>

        {binding?.kind === 'user_input' && (
          <Select
            value={binding.fieldKey}
            onValueChange={(value) =>
              onChange({ kind: 'user_input', fieldKey: value || binding.fieldKey })
            }
            disabled={compatibleInputs.length === 0}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue
                placeholder={
                  compatibleInputs.length === 0
                    ? `No compatible ${assetKind} inputs defined`
                    : 'Pick a user input'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {compatibleInputs.map((f) => (
                <SelectItem key={f.fieldKey} value={f.fieldKey}>
                  {f.label || f.fieldKey}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {binding?.kind === 'stage_output' && (
          <Select
            value={String(binding.stageIndex)}
            onValueChange={(value) =>
              onChange({ kind: 'stage_output', stageIndex: parseInt(value ?? '1') || 1 })
            }
            disabled={stageIndex < 1}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue
                placeholder={
                  stageIndex < 1 ? 'No previous stages exist' : 'Pick a previous stage'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: stageIndex }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Stage {n} output
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {binding?.kind === 'admin_asset' && (
          <div className="flex gap-2">
            <Input
              value={binding.r2Key}
              onChange={(e) =>
                onChange({ kind: 'admin_asset', r2Key: e.target.value })
              }
              placeholder="r2://templates/…"
              className="h-9 flex-1 text-xs font-mono"
              readOnly={uploading}
            />
            {/*
              Uploader handles image + video. Audio admin-asset uploads
              are paste-only for v1 — we don't ship an audio uploader
              yet, but admins can drop in any pre-staged R2 key.
            */}
            {assetKind !== 'audio' && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                {uploading ? 'Uploading…' : 'Upload'}
              </Button>
            )}
            {/* sr-only (not hidden) so Safari opens the picker when
                the Upload button triggers `.click()` on it. */}
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              accept={
                assetKind === 'video'
                  ? 'video/mp4,video/quicktime,video/webm'
                  : 'image/png,image/jpeg,image/webp'
              }
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setUploading(true);
                try {
                  const uploaded =
                    assetKind === 'video'
                      ? (await uploadVideoAsset(file, folder, getToken)).media
                      : await uploadImageAsset(file, folder, getToken);
                  onChange({ kind: 'admin_asset', r2Key: uploaded.r2Key });
                  toast.success(`Uploaded ${uploaded.fileName ?? 'asset'}.`);
                } catch (err) {
                  const msg =
                    err instanceof ApiError
                      ? err.message
                      : err instanceof Error
                        ? err.message
                        : 'Upload failed.';
                  toast.error(msg);
                } finally {
                  setUploading(false);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main editor ─────────────────────────────────────────────────────
