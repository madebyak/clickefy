'use client';

/**
 * Seedance generation-mode editor.
 *
 * Replaces the legacy "Reference Images" uploader for Seedance stages
 * because BytePlus Seedance 2.0 enforces mutually-exclusive generation
 * modes (first/last-frame vs reference) on the wire — the old uploader
 * couldn't represent that distinction.
 *
 * Slot semantics mirror the compiler in `@clickfy/providers`:
 *   - `user_input`   — bound to a TemplateInputField.fieldKey; the
 *                      mobile picker collects the file at run time.
 *   - `stage_output` — chains from a prior stage's output (Nano Banana
 *                      → Seedance is the headline case).
 *   - `admin_asset`  — baked into the template at edit time. The only
 *                      kind allowed for audio refs today (mobile has
 *                      no audio picker yet, so user_input audio would
 *                      strand the slot).
 */

import { useRef, useState } from 'react';
import type {
  GenerationStage,
  SeedanceFrameSlots,
  SeedanceReferenceSlot,
  SeedanceSlotBinding,
  SeedanceStageConfig,
  TemplateInput,
} from '@clickfy/types';
import { findCapabilities } from '@clickfy/providers';
import { toast } from 'sonner';
import {
  Film,
  ImageIcon,
  Music,
  Plus,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { TokenGetter } from '@/lib/api';
import {
  ApiError,
  uploadImageAsset,
  uploadVideoAsset,
} from '@/lib/api/uploads';

type AssetKind = 'image' | 'video' | 'audio';

interface SeedanceModeEditorProps {
  stage: GenerationStage;
  userInputs: TemplateInput[];
  stageIndex: number; // 0-based position; previous stages = 1..stageIndex
  onChange: (updates: Partial<GenerationStage>) => void;
  getToken: TokenGetter;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Initial mode pick when `seedanceMode` isn't set. Mirrors the
 * compiler's `inferLegacySeedanceMode()` shim so the UI shows the
 * same mode the runtime would have inferred — no surprises.
 */
function inferModeFromStage(stage: GenerationStage): 'first_last_frame' | 'reference' {
  const cfg = stage.config as SeedanceStageConfig;
  if (cfg.seedanceMode === 'first_last_frame' || cfg.seedanceMode === 'reference') {
    return cfg.seedanceMode;
  }
  if (stage.references.length > 0) return 'reference';
  return 'first_last_frame';
}

function getCfg(stage: GenerationStage): SeedanceStageConfig {
  return (stage.config as SeedanceStageConfig) ?? {};
}

function bindingLabel(b: SeedanceSlotBinding | undefined, userInputs: TemplateInput[]): string {
  if (!b) return 'Not set';
  if (b.kind === 'user_input') {
    const f = userInputs.find((u) => u.fieldKey === b.fieldKey);
    return f ? `User input — ${f.label || f.fieldKey}` : `User input — ${b.fieldKey}`;
  }
  if (b.kind === 'stage_output') return `Stage ${b.stageIndex} output`;
  return `Admin asset (${b.r2Key.split('/').pop()})`;
}

function assetKindIcon(kind: AssetKind) {
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
function SlotSourcePicker({
  binding,
  assetKind,
  userInputs,
  stageIndex,
  folder,
  getToken,
  onChange,
}: {
  binding: SeedanceSlotBinding | undefined;
  assetKind: AssetKind;
  userInputs: TemplateInput[];
  stageIndex: number;
  folder: 'templates';
  getToken: TokenGetter;
  onChange: (next: SeedanceSlotBinding | undefined) => void;
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

export function SeedanceModeEditor({
  stage,
  userInputs,
  stageIndex,
  onChange,
  getToken,
}: SeedanceModeEditorProps) {
  const caps = findCapabilities(stage.model);
  const acceptsLastFrame = caps?.acceptsStartEndImage ?? false;

  const cfg = getCfg(stage);
  const mode = inferModeFromStage(stage);
  const frameSlots = cfg.frameSlots ?? {};
  const refSlots = cfg.referenceSlots ?? [];

  /**
   * Patch helper that writes back to `stage.config` without dropping
   * unrelated keys (resolution, generateAudio, etc.).
   */
  const patchCfg = (patch: Partial<SeedanceStageConfig>) => {
    onChange({ config: { ...stage.config, ...patch } });
  };

  const setMode = (next: 'first_last_frame' | 'reference') => {
    // Persist the mode flag and clear data belonging to the other
    // mode so the compiler doesn't have to drop it later with a
    // warning. We keep frame/ref data for the *current* mode intact.
    if (next === 'first_last_frame') {
      patchCfg({ seedanceMode: next, referenceSlots: undefined });
    } else {
      patchCfg({ seedanceMode: next, frameSlots: undefined });
    }
  };

  const patchFrameSlots = (next: SeedanceFrameSlots) => {
    patchCfg({ frameSlots: next });
  };

  const patchRefSlots = (next: SeedanceReferenceSlot[]) => {
    patchCfg({ referenceSlots: next.length > 0 ? next : undefined });
  };

  return (
    <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-sm font-medium">Generation Mode</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            BytePlus Seedance only accepts one mode per request — first/last frame
            <em> or </em> multimodal references. Mixing them is rejected.
          </p>
        </div>
        <Select value={mode} onValueChange={(v) => setMode(v as 'first_last_frame' | 'reference')}>
          <SelectTrigger className="h-9 w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="first_last_frame">First & Last Frame</SelectItem>
            <SelectItem value="reference">Reference (multimodal)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {mode === 'first_last_frame' ? (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5" /> First Frame
              <span className="text-muted-foreground/60">— required for I2V</span>
            </Label>
            <SlotSourcePicker
              binding={frameSlots.firstFrame}
              assetKind="image"
              userInputs={userInputs}
              stageIndex={stageIndex}
              folder="templates"
              getToken={getToken}
              onChange={(next) => patchFrameSlots({ ...frameSlots, firstFrame: next })}
            />
            <p className="text-[11px] text-muted-foreground">
              {bindingLabel(frameSlots.firstFrame, userInputs)}
            </p>
          </div>

          {acceptsLastFrame && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ImageIcon className="h-3.5 w-3.5" /> Last Frame
                <span className="text-muted-foreground/60">— optional (bookend control)</span>
              </Label>
              <SlotSourcePicker
                binding={frameSlots.lastFrame}
                assetKind="image"
                userInputs={userInputs}
                stageIndex={stageIndex}
                folder="templates"
                getToken={getToken}
                onChange={(next) => patchFrameSlots({ ...frameSlots, lastFrame: next })}
              />
              <p className="text-[11px] text-muted-foreground">
                {bindingLabel(frameSlots.lastFrame, userInputs)}
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 pt-1">
            <input
              type="checkbox"
              id={`return-last-frame-${stage.id}`}
              checked={Boolean(cfg.returnLastFrame)}
              onChange={(e) => patchCfg({ returnLastFrame: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-input bg-background accent-primary-green"
            />
            <div>
              <Label
                htmlFor={`return-last-frame-${stage.id}`}
                className="text-xs font-medium cursor-pointer"
              >
                Return last frame as a still
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Useful when a downstream stage needs to keep animating from where
                this one ended.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Reference Slots</Label>
              <p className="text-xs text-muted-foreground">
                Image (≤9), video (≤3), audio (≤3). BytePlus blends all references
                into the generation.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patchRefSlots([
                  ...refSlots,
                  {
                    id: `slot-${crypto.randomUUID()}`,
                    assetKind: 'image',
                    source: { kind: 'admin_asset', r2Key: '' },
                  },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Slot
            </Button>
          </div>

          {refSlots.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/5 p-6 text-center">
              <Film className="h-6 w-6 text-muted-foreground/40 mx-auto mb-1.5" />
              <p className="text-xs text-muted-foreground">
                No reference slots yet. Add one to attach style, scene, or audio cues.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {refSlots.map((slot, idx) => {
                const KindIcon = assetKindIcon(slot.assetKind);
                return (
                  <div key={slot.id} className="rounded-lg border bg-background p-3">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary-green/10 text-[11px] font-semibold text-primary-green">
                          {idx + 1}
                        </span>
                        <KindIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <Select
                          value={slot.assetKind}
                          onValueChange={(v) => {
                            // Switching asset kind invalidates the binding —
                            // a user_input bound to a text field would never
                            // resolve as video. Reset to admin_asset r2Key=''.
                            patchRefSlots(
                              refSlots.map((s) =>
                                s.id === slot.id
                                  ? {
                                      ...s,
                                      assetKind: (v as AssetKind) || s.assetKind,
                                      source: { kind: 'admin_asset', r2Key: '' },
                                    }
                                  : s,
                              ),
                            );
                          }}
                        >
                          <SelectTrigger className="h-7 w-[110px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="image">Image</SelectItem>
                            <SelectItem value="video">Video</SelectItem>
                            <SelectItem value="audio">Audio</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-destructive hover:text-destructive"
                        onClick={() => patchRefSlots(refSlots.filter((s) => s.id !== slot.id))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <SlotSourcePicker
                      binding={slot.source}
                      assetKind={slot.assetKind}
                      userInputs={userInputs}
                      stageIndex={stageIndex}
                      folder="templates"
                      getToken={getToken}
                      onChange={(next) =>
                        patchRefSlots(
                          refSlots.map((s) =>
                            s.id === slot.id
                              ? {
                                  ...s,
                                  source: next ?? { kind: 'admin_asset', r2Key: '' },
                                }
                              : s,
                          ),
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
