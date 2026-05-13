'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { Template, GenerationStage, TemplateInput, ReferenceImageRole, GenerationReference } from '@clickfy/types';
import { findCapabilities } from '@clickfy/providers';
import { cn } from '@/lib/utils';
import { uploadImageAsset, ApiError } from '@/lib/api/uploads';
import type { TokenGetter } from '@/lib/api';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Zap,
  ChevronDown,
  ArrowDown,
  Sparkles,
  Film,
  Variable,
  ImageIcon,
  Type,
  Video,
  X,
  Copy,
  Upload,
  Palette,
  Layout,
  Sun,
  Mountain,
  Eye,
} from 'lucide-react';

interface GenerationTabProps {
  template: Partial<Template>;
  onChange: (data: Partial<Template>) => void;
  /**
   * Clerk session token getter — required to upload reference images
   * to R2 via the Worker's `/v1/admin/uploads` endpoint. Pulled from
   * `useAuth()` in the page and passed in here.
   */
  getToken: TokenGetter;
}

const geminiModels = [
  { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash (Fast)' },
  { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash (Latest)' },
  { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro (Best Quality)' },
  { value: 'imagen-4.0-generate-001', label: 'Imagen 4.0' },
  { value: 'imagen-4.0-fast-generate-001', label: 'Imagen 4.0 Fast' },
];

const klingModels = [
  { value: 'kling-v2-6', label: 'Kling V2.6 (Latest)' },
  { value: 'kling-v2-5-turbo', label: 'Kling V2.5 Turbo (Fast)' },
  { value: 'kling-v2-master', label: 'Kling V2 Master' },
];

/** Admin only exposes gemini & kling for now; Phase 4 may add veo. */
type AdminProvider = 'gemini' | 'kling';

const providerConfig: Record<AdminProvider, { label: string; icon: typeof Sparkles; color: string; bgColor: string; borderColor: string }> = {
  gemini: { label: 'Google Gemini', icon: Sparkles, color: 'text-blue-400', bgColor: 'bg-blue-400/10', borderColor: 'border-blue-400/20' },
  kling: { label: 'Kling AI', icon: Film, color: 'text-purple-400', bgColor: 'bg-purple-400/10', borderColor: 'border-purple-400/20' },
};

const referenceRoles: { value: ReferenceImageRole; label: string; icon: typeof Palette }[] = [
  { value: 'style', label: 'Style', icon: Palette },
  { value: 'composition', label: 'Composition', icon: Layout },
  { value: 'lighting', label: 'Lighting', icon: Sun },
  { value: 'scene', label: 'Scene', icon: Mountain },
  { value: 'example', label: 'Example', icon: Eye },
];

/**
 * Resolve a reference image's preview URL. New references uploaded
 * this session carry `cdnUrl` on the in-memory copy (set by
 * `uploadImageAsset`); references loaded from the DB only have
 * `r2Key`, in which case we point at the Worker's public proxy.
 *
 * NEXT_PUBLIC_API_URL is required by `lib/api.ts` at boot, so it's
 * always defined here — the fallback is purely defensive.
 */
function referencePreviewUrl(ref: GenerationReference): string {
  // Authors keep a transient `cdnUrl` on the in-memory ref via the
  // upload helper, which is faster than a fresh fetch through the
  // Worker proxy. We type it as `unknown` to avoid widening the
  // canonical type — the field lives only in the admin form, never
  // in the persisted row.
  const transientCdnUrl = (ref as unknown as { cdnUrl?: string }).cdnUrl;
  if (transientCdnUrl) return transientCdnUrl;
  if (ref.r2Key) {
    const base = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${base}/v1/uploads/${ref.r2Key}`;
  }
  // Legacy drafts still in zustand from before R2 wiring — show the
  // base64 thumb so the admin can see what's there and re-upload.
  if (ref.base64 && ref.mimeType) {
    return `data:${ref.mimeType};base64,${ref.base64}`;
  }
  return '';
}

function PromptEditor({
  value,
  onChange,
  userInputs,
  references,
  stageIndex,
  stages,
}: {
  value: string;
  onChange: (val: string) => void;
  userInputs: TemplateInput[];
  references: GenerationReference[];
  stageIndex: number;
  stages: GenerationStage[];
}) {
  const fieldTypeIcons: Record<string, typeof ImageIcon> = { image: ImageIcon, video: Video, text: Type };

  // Each chip carries a `token` — the literal text we insert — and a
  // `label` we show next to it. The token uses the new namespaced
  // syntax (`input:` / `ref:` / `stage_N_output`) so prompts stay
  // unambiguous and the compiler never has to guess.
  const inputVars = userInputs.map((input) => ({
    token: `input:${input.fieldKey}`,
    label: input.label || input.fieldKey,
    type: input.type,
  }));
  const refVars = references.map((ref) => ({
    token: `ref:${ref.key}`,
    label: ref.label ? `${ref.role} — ${ref.label}` : ref.role,
    type: 'image' as const,
  }));
  const previousStageVars = stages
    .filter((_, i) => i < stageIndex)
    .map((_, i) => ({
      token: `stage_${i + 1}_output`,
      label: `Stage ${i + 1} Output`,
      type: 'image' as const,
    }));

  const allVariables = [...inputVars, ...refVars, ...previousStageVars];

  const insertVariable = (token: string) => {
    const textarea = document.getElementById('prompt-editor') as HTMLTextAreaElement | null;
    if (!textarea) {
      onChange(value + `{{${token}}}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const newValue = `${before}{{${token}}}${after}`;
    onChange(newValue);
    requestAnimationFrame(() => {
      const cursorPos = start + token.length + 4;
      textarea.focus();
      textarea.setSelectionRange(cursorPos, cursorPos);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Prompt</Label>
        <span className="text-xs text-muted-foreground">{value.length} characters</span>
      </div>

      {/* Variable chips */}
      {allVariables.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Click to insert variable at cursor:</p>
          <div className="flex flex-wrap gap-1.5">
            {allVariables.map((v) => {
              const Icon = fieldTypeIcons[v.type] || Variable;
              return (
                <button
                  key={v.token}
                  type="button"
                  onClick={() => insertVariable(v.token)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/50 border border-border text-xs font-mono hover:border-primary/50 hover:bg-primary/5 transition-colors"
                >
                  <Icon className="h-3 w-3 text-muted-foreground" />
                  <span className="text-primary">{`{{${v.token}}}`}</span>
                  <span className="text-muted-foreground font-sans">— {v.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Textarea
        id="prompt-editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Describe what you want the AI to generate. Use {{variables}} to reference user inputs..."
        className="min-h-[200px] font-mono text-sm leading-relaxed"
      />
      <p className="text-xs text-muted-foreground">
        Be specific: describe composition, lighting, mood, style. Use variables to reference user uploads.
      </p>
    </div>
  );
}

export function GenerationTab({ template, onChange, getToken }: GenerationTabProps) {
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);
  const refFileInputRef = useRef<HTMLInputElement | null>(null);
  const [addingRefToStageId, setAddingRefToStageId] = useState<string | null>(null);
  const [uploadingRefStageId, setUploadingRefStageId] = useState<string | null>(null);

  const stages = template.generation?.stages || [];
  const userInputs = template.userInputs || [];

  const updateStages = (updatedStages: GenerationStage[]) => {
    // Pipeline mode tracks the *generation shape*, which doesn't 1:1
    // match `kind`. Map sensibly: image-set still produces images, so
    // default to the existing mode or 'image' if no mode is set yet.
    const defaultMode = template.generation?.mode
      ?? (template.kind === 'video' ? 'video' : 'image');
    onChange({
      generation: {
        mode: defaultMode,
        stages: updatedStages,
      },
    });
  };

  const handleAddStage = () => {
    const newStage: GenerationStage = {
      id: `stage-${crypto.randomUUID()}`,
      order: stages.length + 1,
      provider: 'gemini',
      model: 'gemini-2.5-flash-image',
      prompt: '',
      references: [],
      config: {
        aspectRatio: '1:1',
        numberOfOutputs: 1,
      },
      retry: {
        enabled: true,
        maxAttempts: 2,
      },
    };
    const updated = [...stages, newStage];
    updateStages(updated);
    setExpandedStageId(newStage.id);
  };

  const handleDeleteStage = (id: string) => {
    updateStages(stages.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i + 1 })));
    if (expandedStageId === id) setExpandedStageId(null);
  };

  const handleDuplicateStage = (stage: GenerationStage) => {
    const duplicate: GenerationStage = {
      ...stage,
      id: `stage-${crypto.randomUUID()}`,
      order: stages.length + 1,
    };
    updateStages([...stages, duplicate]);
  };

  const handleUpdateStage = (id: string, updates: Partial<GenerationStage>) => {
    updateStages(stages.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Generation Pipeline</h3>
          <p className="text-sm text-muted-foreground">
            Configure the AI generation stages. Each stage runs sequentially.
          </p>
        </div>
        <Button onClick={handleAddStage}>
          <Plus className="h-4 w-4 mr-2" />
          Add Stage
        </Button>
      </div>

      {/* Pipeline */}
      {stages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-muted/30 rounded-xl border border-dashed border-border">
          <Zap className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground font-medium">No generation stages</p>
          <p className="text-sm text-muted-foreground mt-1">Add a stage to define how AI generates content</p>
          <Button className="mt-4" onClick={handleAddStage}>
            <Plus className="h-4 w-4 mr-2" />
            Add First Stage
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {stages.map((stage, index) => {
            // Provider may be 'veo' in older drafts; fall back to gemini styling.
            const prov = providerConfig[(stage.provider as AdminProvider) in providerConfig
              ? (stage.provider as AdminProvider)
              : 'gemini'];
            const ProvIcon = prov.icon;
            const isExpanded = expandedStageId === stage.id;

            return (
              <div key={stage.id}>
                {/* Connector arrow between stages */}
                {index > 0 && (
                  <div className="flex justify-center -mt-1 -mb-1">
                    <div className="flex flex-col items-center">
                      <div className="w-px h-3 bg-border" />
                      <ArrowDown className="h-4 w-4 text-muted-foreground" />
                      <div className="w-px h-3 bg-border" />
                    </div>
                  </div>
                )}

                <Card className={cn('transition-colors', isExpanded && 'border-primary/30')}>
                  <CardContent className="p-0">
                    {/* Stage header */}
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedStageId(isExpanded ? null : stage.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-green/10 text-primary-green font-bold text-sm">
                          {index + 1}
                        </div>
                        <div className={cn('flex h-9 items-center gap-2 px-3 rounded-lg border', prov.bgColor, prov.borderColor)}>
                          <ProvIcon className={cn('h-4 w-4', prov.color)} />
                          <span className={cn('text-sm font-medium', prov.color)}>{prov.label}</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {stage.model}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">
                            {stage.prompt ? stage.prompt.slice(0, 80) + (stage.prompt.length > 80 ? '...' : '') : 'No prompt configured'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); handleDuplicateStage(stage); }}
                          title="Duplicate stage"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); handleDeleteStage(stage.id); }}
                          title="Delete stage"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <ChevronDown className={cn('h-5 w-5 text-muted-foreground transition-transform ml-1', isExpanded && 'rotate-180')} />
                      </div>
                    </div>

                    {/* Expanded stage editor */}
                    {isExpanded && (
                      <div className="border-t px-4 pb-5 pt-4 space-y-6">
                        {/* Provider & Model row — action-type was dropped;
                            provider+model already determine the call shape. */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Provider</Label>
                            <Select
                              value={stage.provider}
                              onValueChange={(value) =>
                                handleUpdateStage(stage.id, {
                                  provider: (value || 'gemini') as 'gemini' | 'kling',
                                  model: value === 'gemini' ? 'gemini-2.5-flash-image' : 'kling-v2-6',
                                })
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="gemini">
                                  <div className="flex items-center gap-2">
                                    <Sparkles className="h-3.5 w-3.5 text-blue-400" />
                                    Google Gemini
                                  </div>
                                </SelectItem>
                                <SelectItem value="kling">
                                  <div className="flex items-center gap-2">
                                    <Film className="h-3.5 w-3.5 text-purple-400" />
                                    Kling AI
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Model</Label>
                            <Select
                              value={stage.model}
                              onValueChange={(value) => handleUpdateStage(stage.id, { model: value || stage.model })}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(stage.provider === 'gemini' ? geminiModels : klingModels).map((m) => (
                                  <SelectItem key={m.value} value={m.value}>
                                    {m.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <Separator />

                        {/* Prompt editor with variables */}
                        <PromptEditor
                          value={stage.prompt}
                          onChange={(val) => handleUpdateStage(stage.id, { prompt: val })}
                          userInputs={userInputs}
                          references={stage.references}
                          stageIndex={index}
                          stages={stages}
                        />

                        {/* Reference Images */}
                        {stage.provider === 'gemini' && (
                          <>
                            <Separator />
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <Label className="text-sm font-medium">Reference Images</Label>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Upload style, composition, or scene references. These are labeled separately from user inputs so Gemini knows which is which.
                                  </p>
                                </div>
                                {stage.references.length < 5 && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setAddingRefToStageId(stage.id);
                                      refFileInputRef.current?.click();
                                    }}
                                    className="gap-2"
                                    disabled={uploadingRefStageId === stage.id}
                                  >
                                    <Upload className="h-3.5 w-3.5" />
                                    {uploadingRefStageId === stage.id ? 'Uploading…' : 'Add Reference'}
                                  </Button>
                                )}
                              </div>

                              {stage.references.length > 0 ? (
                                <div className="grid grid-cols-1 gap-3">
                                  {stage.references.map((ref) => {
                                    const roleInfo = referenceRoles.find((r) => r.value === ref.role) || referenceRoles[0];
                                    const RoleIcon = roleInfo.icon;
                                    return (
                                      <div
                                        key={ref.id}
                                        className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20"
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={referencePreviewUrl(ref)}
                                          alt={ref.label || 'Reference'}
                                          className="h-16 w-16 rounded-md object-cover border shrink-0"
                                        />
                                        <div className="flex-1 min-w-0 space-y-2">
                                          <div className="flex items-center gap-2">
                                            <Select
                                              value={ref.role}
                                              onValueChange={(value) => {
                                                const updated = stage.references.map((r) =>
                                                  r.id === ref.id ? { ...r, role: (value || ref.role) as ReferenceImageRole } : r
                                                );
                                                handleUpdateStage(stage.id, { references: updated });
                                              }}
                                            >
                                              <SelectTrigger className="h-7 w-[140px] text-xs">
                                                <div className="flex items-center gap-1.5">
                                                  <RoleIcon className="h-3 w-3" />
                                                  <SelectValue />
                                                </div>
                                              </SelectTrigger>
                                              <SelectContent>
                                                {referenceRoles.map((r) => (
                                                  <SelectItem key={r.value} value={r.value}>
                                                    <div className="flex items-center gap-1.5">
                                                      <r.icon className="h-3 w-3" />
                                                      {r.label}
                                                    </div>
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                            {ref.fileName && (
                                              <span className="text-[10px] text-muted-foreground truncate">{ref.fileName}</span>
                                            )}
                                          </div>
                                          <Input
                                            value={ref.label}
                                            onChange={(e) => {
                                              const updated = stage.references.map((r) =>
                                                r.id === ref.id ? { ...r, label: e.target.value } : r
                                              );
                                              handleUpdateStage(stage.id, { references: updated });
                                            }}
                                            placeholder="Describe what this reference shows (e.g., 'Warm studio lighting on white backdrop')"
                                            className="h-8 text-xs"
                                          />
                                        </div>
                                        <Button
                                          size="icon-xs"
                                          variant="ghost"
                                          className="text-destructive hover:text-destructive shrink-0 mt-0.5"
                                          onClick={() => {
                                            const updated = stage.references.filter((r) => r.id !== ref.id);
                                            handleUpdateStage(stage.id, { references: updated });
                                          }}
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="rounded-lg border border-dashed border-border bg-muted/10 p-6 text-center">
                                  <ImageIcon className="h-6 w-6 text-muted-foreground/40 mx-auto mb-1.5" />
                                  <p className="text-xs text-muted-foreground">
                                    No reference images. The model will only use the prompt and user inputs.
                                  </p>
                                </div>
                              )}

                              <input
                                ref={refFileInputRef}
                                type="file"
                                className="hidden"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  const stageId = addingRefToStageId;
                                  // Always clear the file input value so the
                                  // same file can be re-selected after an error.
                                  e.target.value = '';
                                  if (!file || !stageId) {
                                    setAddingRefToStageId(null);
                                    return;
                                  }
                                  const targetStage = stages.find((s) => s.id === stageId);
                                  if (!targetStage) {
                                    setAddingRefToStageId(null);
                                    return;
                                  }
                                  setUploadingRefStageId(stageId);
                                  try {
                                    // Eager upload to R2: the moment the admin
                                    // picks a file, it goes to the templates
                                    // folder via the Worker. We keep `cdnUrl`
                                    // on the in-memory ref so the thumbnail
                                    // renders instantly; on save the store
                                    // strips it and only `r2Key` is persisted.
                                    const uploaded = await uploadImageAsset(file, 'templates', getToken);

                                    const existingKeys = new Set(
                                      targetStage.references.map((r) => r.key),
                                    );
                                    let n = targetStage.references.length + 1;
                                    let key = `style_${n}`;
                                    while (existingKeys.has(key)) {
                                      n += 1;
                                      key = `style_${n}`;
                                    }
                                    // Cast through unknown so we can stash the
                                    // transient cdnUrl on the in-memory ref
                                    // without polluting the canonical type.
                                    const newRef = {
                                      id: `ref-${crypto.randomUUID()}`,
                                      key,
                                      label: '',
                                      role: 'style' as ReferenceImageRole,
                                      r2Key: uploaded.r2Key,
                                      mimeType: file.type,
                                      fileName: uploaded.fileName,
                                      cdnUrl: uploaded.cdnUrl,
                                    } as unknown as GenerationReference;
                                    handleUpdateStage(stageId, {
                                      references: [...targetStage.references, newRef],
                                    });
                                  } catch (err) {
                                    const msg =
                                      err instanceof ApiError
                                        ? err.message
                                        : err instanceof Error
                                          ? err.message
                                          : 'Failed to upload reference image.';
                                    toast.error(msg);
                                  } finally {
                                    setUploadingRefStageId(null);
                                    setAddingRefToStageId(null);
                                  }
                                }}
                              />
                            </div>
                          </>
                        )}

                        <Separator />

                        {/* Model config */}
                        <div>
                          <Label className="mb-3 block text-sm font-medium">Model Configuration</Label>
                          <div className="grid grid-cols-3 gap-4">
                            {(() => {
                              // Drive the aspect-ratio control off the
                              // model's capability declaration so the UI
                              // never offers values the provider would
                              // silently drop. Imagen-only models would
                              // also fit here in the future; for now
                              // every entry in MODEL_CAPABILITIES uses
                              // the 'aspect' sizing mode.
                              const caps = findCapabilities(stage.model);
                              const aspectValues =
                                caps?.sizing.mode === 'aspect' ? caps.sizing.values : [];
                              if (aspectValues.length === 0) {
                                return (
                                  <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">Aspect Ratio</Label>
                                    <div className="h-9 flex items-center px-3 text-xs text-muted-foreground border border-dashed rounded-md bg-muted/30">
                                      Not configurable for this model
                                    </div>
                                  </div>
                                );
                              }
                              const locked = aspectValues.length === 1;
                              const selected = aspectValues.includes(stage.config.aspectRatio as string)
                                ? (stage.config.aspectRatio as string)
                                : aspectValues[0];
                              return (
                                <div className="space-y-2">
                                  <Label className="text-xs text-muted-foreground">
                                    Aspect Ratio {locked && <span className="text-muted-foreground/60">(locked)</span>}
                                  </Label>
                                  <Select
                                    value={selected}
                                    onValueChange={(value) =>
                                      handleUpdateStage(stage.id, {
                                        config: { ...stage.config, aspectRatio: value || aspectValues[0] },
                                      })
                                    }
                                    disabled={locked}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {aspectValues.map((ratio) => (
                                        <SelectItem key={ratio} value={ratio}>
                                          {ratio}
                                          {locked ? ' (model-locked)' : ''}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              );
                            })()}

                            {stage.provider === 'gemini' && (
                              <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Output Count</Label>
                                <Input
                                  type="number"
                                  value={(stage.config.numberOfOutputs as number | undefined) ?? 1}
                                  onChange={(e) =>
                                    handleUpdateStage(stage.id, {
                                      config: { ...stage.config, numberOfOutputs: Math.max(1, Math.min(4, parseInt(e.target.value) || 1)) },
                                    })
                                  }
                                  min={1}
                                  max={4}
                                />
                              </div>
                            )}

                            {stage.provider === 'kling' && (
                              <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Duration (sec)</Label>
                                <Select
                                  value={String(stage.config.duration || 5)}
                                  onValueChange={(value) =>
                                    handleUpdateStage(stage.id, { config: { ...stage.config, duration: parseInt(value ?? '5') || 5 } })
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="5">5 seconds</SelectItem>
                                    <SelectItem value="10">10 seconds</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">Retry on Failure</Label>
                              <Select
                                value={stage.retry.enabled ? String(stage.retry.maxAttempts) : '0'}
                                onValueChange={(value) => {
                                  const attempts = parseInt(value ?? '0') || 0;
                                  handleUpdateStage(stage.id, {
                                    retry: { ...stage.retry, enabled: attempts > 0, maxAttempts: Math.max(attempts, 1) },
                                  });
                                }}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">Disabled</SelectItem>
                                  <SelectItem value="1">1 retry</SelectItem>
                                  <SelectItem value="2">2 retries</SelectItem>
                                  <SelectItem value="3">3 retries</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}

          {/* Add another stage */}
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={handleAddStage} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Another Stage
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
