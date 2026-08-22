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
import { aspectRatiosFor, findCapabilities, listActiveModels, pixelSizeForAspect } from '@clickfy/providers';
import { cn } from '@/lib/utils';
import { uploadImageAsset, ApiError } from '@/lib/api/uploads';
import type { TokenGetter } from '@/lib/api';
import { toast } from 'sonner';
import { SeedanceModeEditor } from './seedance-mode-editor';
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

type AdminProvider = 'gemini' | 'kling' | 'seedance' | 'openai';

/**
 * Short authoring hints appended to a model's registry `displayName`.
 * Guidance for whoever is picking a model, not identity — the registry
 * owns the names, so nothing here has to be kept in sync with it.
 *
 * One BytePlus ModelArk provider covers two product lines: Seedream
 * generates images (synchronous), Seedance generates video (async task).
 * The stage's model choice is what selects between them.
 */
const MODEL_HINTS: Record<string, string> = {
  'gemini-3-pro-image': 'best quality',
  'gemini-3.1-flash-image': 'balanced',
  'gemini-3.1-flash-lite-image': 'fastest',
  'kling-v3-omni': 'latest',
  'kling-v2-5-turbo': 'fast',
  'gpt-image-2': 'best text',
  'seedream-4-0-250828': 'image, cheapest',
  'seedream-5-0-260128': 'image, best',
  'dreamina-seedance-2-0-260128': 'video',
  'dreamina-seedance-2-0-fast-260128': 'video, fast',
};

/**
 * Preferred order within each provider's group — best/latest first, which
 * is not the order the registry declares them in. Unlisted models sort to
 * the end rather than disappearing, so this never gates availability.
 */
const MODEL_ORDER: string[] = [
  'gemini-3-pro-image',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'kling-v3-omni',
  'kling-v3',
  'kling-v2-6',
  'kling-v2-5-turbo',
  'kling-v2-master',
  'gpt-image-2',
  'seedream-4-0-250828',
  'seedream-5-0-260128',
  'dreamina-seedance-2-0-260128',
  'dreamina-seedance-2-0-fast-260128',
];

/**
 * Authorable models per provider, derived from the capability registry
 * rather than hand-maintained here.
 *
 * `listActiveModels` excludes deprecated keys, which is exactly the policy
 * this list needs: the `-preview` Gemini ids and Imagen 4 stay registered
 * so existing templates keep resolving, but no new stage can be authored
 * against a retiring id. This used to be three literal arrays, so every
 * model added to the registry had to be copied here by hand — one missed
 * copy left the model unauthorable with nothing to signal it.
 */
const MODELS_BY_PROVIDER: Record<AdminProvider, Array<{ value: string; label: string }>> = (() => {
  const out: Record<AdminProvider, Array<{ value: string; label: string }>> = {
    gemini: [],
    kling: [],
    seedance: [],
    openai: [],
  };
  for (const caps of listActiveModels()) {
    const bucket = out[caps.provider as AdminProvider];
    if (!bucket) continue;
    const hint = MODEL_HINTS[caps.modelKey];
    bucket.push({
      value: caps.modelKey,
      label: hint ? `${caps.displayName} — ${hint}` : caps.displayName,
    });
  }
  // The registry is in declaration order, which is not presentation
  // order (it lists Kling V2.6 before Kling 3, and Seedance video before
  // Seedream images). Sort by the curated order above; anything not
  // listed there still appears, at the end of its provider's group.
  for (const list of Object.values(out)) {
    list.sort((a, b) => {
      const ia = MODEL_ORDER.indexOf(a.value);
      const ib = MODEL_ORDER.indexOf(b.value);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.label.localeCompare(b.label);
    });
  }
  return out;
})();

/**
 * Default model picked when an admin switches a stage to a given provider.
 * Pinned per provider rather than "first in the list" so that adding a
 * flashier model to the registry doesn't silently change what new stages
 * are authored against. Falls back to the first available key if a pin
 * is ever retired.
 */
const PROVIDER_DEFAULTS: Record<AdminProvider, string> = {
  gemini: 'gemini-3.1-flash-image',
  kling: 'kling-v2-6',
  openai: 'gpt-image-2',
  seedance: 'dreamina-seedance-2-0-fast-260128',
};

function modelsFor(provider: AdminProvider) {
  return MODELS_BY_PROVIDER[provider];
}

function defaultModelFor(provider: AdminProvider): string {
  const pinned = PROVIDER_DEFAULTS[provider];
  const list = MODELS_BY_PROVIDER[provider];
  return list.some((m) => m.value === pinned) ? pinned : (list[0]?.value ?? pinned);
}

const providerConfig: Record<AdminProvider, { label: string; icon: typeof Sparkles; color: string; bgColor: string; borderColor: string }> = {
  gemini: { label: 'Google Gemini', icon: Sparkles, color: 'text-blue-400', bgColor: 'bg-blue-400/10', borderColor: 'border-blue-400/20' },
  kling: { label: 'Kling AI', icon: Film, color: 'text-purple-400', bgColor: 'bg-purple-400/10', borderColor: 'border-purple-400/20' },
  seedance: { label: 'BytePlus (Seedream / Seedance)', icon: Film, color: 'text-orange-400', bgColor: 'bg-orange-400/10', borderColor: 'border-orange-400/20' },
  openai: { label: 'OpenAI', icon: Sparkles, color: 'text-emerald-400', bgColor: 'bg-emerald-400/10', borderColor: 'border-emerald-400/20' },
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
                              onValueChange={(value) => {
                                const nextProvider = (value || 'gemini') as AdminProvider;
                                handleUpdateStage(stage.id, {
                                  provider: nextProvider,
                                  model: defaultModelFor(nextProvider),
                                });
                              }}
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
                                <SelectItem value="seedance">
                                  <div className="flex items-center gap-2">
                                    <Film className="h-3.5 w-3.5 text-orange-400" />
                                    BytePlus (Seedream / Seedance)
                                  </div>
                                </SelectItem>
                                <SelectItem value="openai">
                                  <div className="flex items-center gap-2">
                                    <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                                    OpenAI
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
                                {modelsFor(stage.provider as AdminProvider).map((m) => (
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

                        {/* Seedance gets its own mode editor (first/last
                            frame vs reference) because BytePlus rejects
                            mixed-mode requests. See `seedance-mode-editor.tsx`. */}
                        {stage.provider === 'seedance' && (
                          <>
                            <Separator />
                            <SeedanceModeEditor
                              stage={stage}
                              userInputs={userInputs}
                              stageIndex={index}
                              onChange={(updates) => handleUpdateStage(stage.id, updates)}
                              getToken={getToken}
                            />
                          </>
                        )}

                        {/* Reference Images — Gemini / Kling Omni only. Seedance
                             routes through its own editor above. */}
                        {stage.provider !== 'seedance' &&
                          (findCapabilities(stage.model)?.maxReferences ?? 0) > 0 && (
                          <>
                            <Separator />
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <Label className="text-sm font-medium">Reference Images</Label>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Upload style, composition, or scene references. These are labeled separately from user inputs so the model knows which is which.
                                  </p>
                                </div>
                                {stage.references.length < (findCapabilities(stage.model)?.maxReferences ?? 5) && (
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
                                        { }
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

                              {/* sr-only (not hidden) so Safari opens
                                  the picker when the Add Reference
                                  button triggers `.click()` on it. */}
                              <input
                                ref={refFileInputRef}
                                type="file"
                                className="sr-only"
                                tabIndex={-1}
                                aria-hidden="true"
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
                              // silently drop. `aspectRatiosFor` covers
                              // both sizing modes: ratio-based models
                              // (Gemini, Kling, Seedance) list them
                              // directly, and pixel-based models (GPT
                              // Image 2) declare the ratios the compiler
                              // solves into exact dimensions — labelled
                              // below so the admin sees the real output
                              // size for each preset.
                              const caps = findCapabilities(stage.model);
                              const aspectValues = caps ? aspectRatiosFor(caps) : [];
                              const dimsFor = (ratio: string): string | null => {
                                if (!caps) return null;
                                const solved = pixelSizeForAspect(caps, ratio);
                                return solved ? solved.replace('x', '×') : null;
                              };
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
                                      {aspectValues.map((ratio) => {
                                        const dims = dimsFor(ratio);
                                        return (
                                          <SelectItem key={ratio} value={ratio}>
                                            {ratio}
                                            {dims ? ` — ${dims}` : ''}
                                            {locked ? ' (model-locked)' : ''}
                                          </SelectItem>
                                        );
                                      })}
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

                            {(stage.provider === 'kling' || stage.provider === 'seedance') && (() => {
                              // Duration options come from the model's capability
                              // declaration (e.g. Kling 3 Omni: 3/5/8/10/15s).
                              // Models without a declared list keep the classic
                              // 5/10 pair — identical to the previous hardcoded
                              // options, so existing templates are unaffected.
                              // Video-only: the `seedance` provider also hosts
                              // the Seedream IMAGE models, which have no
                              // duration — the compiler would just drop it.
                              const caps = findCapabilities(stage.model);
                              if (caps && caps.kind !== 'video') return null;
                              const durations = caps?.duration?.values ?? [5, 10];
                              return (
                                <div className="space-y-2">
                                  <Label className="text-xs text-muted-foreground">Duration (sec)</Label>
                                  <Select
                                    value={String(stage.config.duration || caps?.duration?.default || 5)}
                                    onValueChange={(value) =>
                                      handleUpdateStage(stage.id, { config: { ...stage.config, duration: parseInt(value ?? '5') || 5 } })
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {durations.map((d) => (
                                        <SelectItem key={d} value={String(d)}>{d} seconds</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              );
                            })()}

                            {/* Quality tier — any model that declares priced `modes`:
                                Kling std/pro/4k, Gemini 1K/2K/4K resolution, GPT Image 2
                                Draft/Standard/High. Written to `stage.config.mode`; the
                                compiler maps it onto the provider's own parameter and
                                template costing bills that tier's credits. Seedance is
                                excluded — its tier is the Resolution picker below, which
                                shares the same key space. Labels come from the registry
                                so they never drift from what the compiler accepts. */}
                            {stage.provider !== 'seedance' && (() => {
                              const caps = findCapabilities(stage.model);
                              if (!caps?.modes) return null;
                              const modes = caps.modes;
                              const cfgMode = stage.config.mode as string | undefined;
                              const selected =
                                cfgMode && (modes.values as readonly string[]).includes(cfgMode)
                                  ? cfgMode
                                  : modes.default;
                              return (
                                <div className="space-y-2">
                                  <Label className="text-xs text-muted-foreground">Quality</Label>
                                  <Select
                                    value={selected}
                                    onValueChange={(value) =>
                                      handleUpdateStage(stage.id, {
                                        config: { ...stage.config, mode: value || modes.default },
                                      })
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {modes.values.map((m) => (
                                        <SelectItem key={m} value={m}>{modes.labels?.[m] ?? m}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <p className="text-[10px] text-muted-foreground">
                                    Quality changes this stage&apos;s credit price.
                                  </p>
                                </div>
                              );
                            })()}

                            {/* Kling 3 Omni: native audio (`sound: on|off`). Mirrors the
                                Seedance Generate Audio control; only rendered for
                                sound-capable models. */}
                            {stage.provider === 'kling' && (() => {
                              const caps = findCapabilities(stage.model);
                              if (!caps?.supportsSound) return null;
                              return (
                                <div className="space-y-2">
                                  <Label className="text-xs text-muted-foreground">Generate Audio</Label>
                                  <Select
                                    value={(stage.config.sound as boolean | string | undefined) === true || stage.config.sound === 'on' ? 'on' : 'off'}
                                    onValueChange={(value) =>
                                      handleUpdateStage(stage.id, {
                                        config: { ...stage.config, sound: value === 'on' },
                                      })
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="off">Off</SelectItem>
                                      <SelectItem value="on">On (sfx + ambience + speech)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              );
                            })()}

                            {/* Seedance: resolution picker. Defaults to 720p per
                                spec — the cheapest tier above 480p, and the
                                sweet spot for cost/quality. Higher tiers escalate
                                billing meaningfully (1080p ≈ 2× 720p; 2K higher).
                                The resolution IS the priced tier, so it's written
                                to BOTH `resolution` (provider parameter) and
                                `mode` (billed tier) — costing reads `mode`, and a
                                stage that generated 1080p while billing the 720p
                                base was a silent loss-maker. */}
                            {stage.provider === 'seedance' && (() => {
                              const caps = findCapabilities(stage.model);
                              if (!caps || caps.kind !== 'video') return null;
                              const allowed =
                                caps.sizing.mode === 'aspect' ? caps.sizing.resolutions ?? [] : [];
                              if (allowed.length === 0) return null;
                              const cfgRes =
                                (stage.config.resolution as string | undefined) ??
                                (stage.config.mode as string | undefined);
                              const selected = cfgRes && allowed.includes(cfgRes) ? cfgRes : '720p';
                              return (
                                <div className="space-y-2">
                                  <Label className="text-xs text-muted-foreground">Resolution</Label>
                                  <Select
                                    value={selected}
                                    onValueChange={(value) =>
                                      handleUpdateStage(stage.id, {
                                        config: {
                                          ...stage.config,
                                          resolution: value || '720p',
                                          mode: value || '720p',
                                        },
                                      })
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {allowed.map((r) => (
                                        <SelectItem key={r} value={r}>{r}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <p className="text-[10px] text-muted-foreground">
                                    Resolution changes this stage&apos;s credit price.
                                  </p>
                                </div>
                              );
                            })()}

                            {/* Seedream (image line): resolution keyword, written to
                                `imageSize` — the key the Seedream compiler reads.
                                Flat-priced, so unlike the video picker this does not
                                affect billing. Previously this model family fell into
                                the video Resolution picker above, whose `resolution`
                                key the image compiler ignores — the choice was a no-op
                                and every stage ran at the model's first resolution. */}
                            {stage.provider === 'seedance' && (() => {
                              const caps = findCapabilities(stage.model);
                              if (!caps || caps.kind !== 'image') return null;
                              const allowed =
                                caps.sizing.mode === 'aspect' ? caps.sizing.resolutions ?? [] : [];
                              if (allowed.length === 0) return null;
                              const cfg = stage.config.imageSize as string | undefined;
                              const selected = cfg && allowed.includes(cfg) ? cfg : allowed[0];
                              return (
                                <div className="space-y-2">
                                  <Label className="text-xs text-muted-foreground">Resolution</Label>
                                  <Select
                                    value={selected}
                                    onValueChange={(value) =>
                                      handleUpdateStage(stage.id, {
                                        config: { ...stage.config, imageSize: value || allowed[0] },
                                      })
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {allowed.map((r) => (
                                        <SelectItem key={r} value={r}>{r}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              );
                            })()}

                            {stage.provider === 'seedance' && (() => {
                              const caps = findCapabilities(stage.model);
                              // Audio + camera are video-generation knobs; the
                              // Seedream image models share this provider and
                              // must not render them.
                              if (!caps || caps.kind !== 'video') return null;
                              return (
                              <>
                                <div className="space-y-2">
                                  <Label className="text-xs text-muted-foreground">Generate Audio</Label>
                                  <Select
                                    value={
                                      (stage.config.generateAudio as boolean | undefined) === true
                                        ? 'on'
                                        : 'off'
                                    }
                                    onValueChange={(value) =>
                                      handleUpdateStage(stage.id, {
                                        config: { ...stage.config, generateAudio: value === 'on' },
                                      })
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="off">Off</SelectItem>
                                      <SelectItem value="on">On (sfx + lip-sync)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-xs text-muted-foreground">Camera Movement</Label>
                                  <Select
                                    value={
                                      (stage.config.cameraFixed as boolean | undefined) === true
                                        ? 'fixed'
                                        : 'free'
                                    }
                                    onValueChange={(value) =>
                                      handleUpdateStage(stage.id, {
                                        config: { ...stage.config, cameraFixed: value === 'fixed' },
                                      })
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="free">Free (model decides)</SelectItem>
                                      <SelectItem value="fixed">Fixed (no pan/zoom)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </>
                              );
                            })()}

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
