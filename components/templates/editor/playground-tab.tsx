'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Template, TemplateInput, GenerationStage } from '@/lib/types/template';
import { cn } from '@/lib/utils';
import {
  Play,
  Loader2,
  ImageIcon,
  Video,
  Type,
  Upload,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  RotateCcw,
  Maximize2,
  Download,
  Sparkles,
  Zap,
} from 'lucide-react';

interface PlaygroundTabProps {
  template: Partial<Template>;
}

interface TestInputData {
  fieldKey: string;
  type: 'image' | 'video' | 'text';
  value: string;
  file?: File;
  preview?: string;
  base64?: string;
  mimeType?: string;
}

interface StageOutput {
  type: 'image' | 'video';
  base64?: string;
  mimeType?: string;
  url?: string;
  dataUrl?: string;
}

interface TestRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  outputs: StageOutput[];
  error?: string;
  stageProgress: { current: number; total: number; label: string };
}

const fieldIcons: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  text: Type,
};

const MAX_IMAGE_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

/**
 * Resize an image file to fit within MAX_IMAGE_DIMENSION and compress as JPEG.
 * Returns { base64, mimeType } with the compressed result.
 */
function compressImage(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      resolve({
        base64: dataUrl.split(',')[1],
        mimeType: 'image/jpeg',
      });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

function resolvePromptVariables(
  prompt: string,
  inputs: Record<string, TestInputData>
): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const input = inputs[key];
    if (!input) return match;
    if (input.type === 'text') return input.value;
    return match; // image/video variables handled via inputMapping
  });
}

export function PlaygroundTab({ template }: PlaygroundTabProps) {
  const [testInputs, setTestInputs] = useState<Record<string, TestInputData>>({});
  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const userInputs = template.userInputs || [];
  const stages = template.generation?.stages || [];
  const hasRequiredInputs = userInputs.filter((i) => i.required).every((i) => testInputs[i.fieldKey]?.value);
  const hasStages = stages.length > 0;
  const canRun = hasRequiredInputs && hasStages;

  const handleFileSelect = async (input: TemplateInput, file: File) => {
    const preview = URL.createObjectURL(file);

    if (input.type === 'image') {
      const compressed = await compressImage(file);
      setTestInputs((prev) => ({
        ...prev,
        [input.fieldKey]: {
          fieldKey: input.fieldKey,
          type: 'image',
          value: file.name,
          file,
          preview,
          base64: compressed.base64,
          mimeType: compressed.mimeType,
        },
      }));
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setTestInputs((prev) => ({
          ...prev,
          [input.fieldKey]: {
            fieldKey: input.fieldKey,
            type: input.type as 'image' | 'video',
            value: file.name,
            file,
            preview,
            base64: result.split(',')[1],
            mimeType: file.type,
          },
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleTextInput = (input: TemplateInput, value: string) => {
    setTestInputs((prev) => ({
      ...prev,
      [input.fieldKey]: {
        fieldKey: input.fieldKey,
        type: 'text',
        value,
      },
    }));
  };

  const clearInput = (fieldKey: string) => {
    const current = testInputs[fieldKey];
    if (current?.preview) URL.revokeObjectURL(current.preview);
    setTestInputs((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  };

  const runStage = useCallback(
    async (
      stage: GenerationStage,
      stageIndex: number,
      previousOutputs: StageOutput[]
    ): Promise<StageOutput[]> => {
      const inputImages: { base64: string; mimeType: string; label?: string }[] = [];

      for (const [fieldKey] of Object.entries(stage.inputMapping)) {
        if (fieldKey.startsWith('stage_') && fieldKey.endsWith('_output')) {
          const stageNum = parseInt(fieldKey.replace('stage_', '').replace('_output', ''));
          const prevOutput = previousOutputs[stageNum - 1];
          if (prevOutput?.base64) {
            inputImages.push({ base64: prevOutput.base64, mimeType: prevOutput.mimeType || 'image/png', label: `Stage ${stageNum} Output` });
          }
        } else {
          const input = testInputs[fieldKey];
          if (input?.base64) {
            const fieldDef = userInputs.find((u) => u.fieldKey === fieldKey);
            inputImages.push({ base64: input.base64, mimeType: input.mimeType || 'image/png', label: fieldDef?.label || fieldKey });
          }
        }
      }

      if (inputImages.length === 0 && Object.keys(stage.inputMapping).length === 0) {
        for (const input of Object.values(testInputs)) {
          if (input.base64 && (input.type === 'image' || input.type === 'video')) {
            const fieldDef = userInputs.find((u) => u.fieldKey === input.fieldKey);
            inputImages.push({ base64: input.base64, mimeType: input.mimeType || 'image/png', label: fieldDef?.label || input.fieldKey });
          }
        }
      }

      // Build reference images from stage config (admin-uploaded)
      const referenceImages = stage.references
        .filter((ref) => ref.base64)
        .map((ref) => ({
          base64: ref.base64,
          mimeType: ref.mimeType,
          role: ref.role,
          label: ref.label,
        }));

      const resolvedPrompt = resolvePromptVariables(stage.prompt, testInputs);

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: stage.provider,
          model: stage.model,
          actionType: stage.actionType,
          prompt: resolvedPrompt,
          referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
          inputImages: inputImages.length > 0 ? inputImages : undefined,
          config: {
            aspectRatio: stage.config.aspectRatio,
            numberOfOutputs: stage.config.numberOfOutputs,
            duration: stage.config.duration,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMsg = `Stage ${stageIndex + 1} failed (${response.status})`;
        try { errorMsg = JSON.parse(text).error || errorMsg; } catch { errorMsg = text.slice(0, 200) || errorMsg; }
        throw new Error(errorMsg);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Handle async tasks (Kling video)
      if (data.status === 'processing' && data.taskId) {
        const videoOutputs = await pollForCompletion(data.taskId, data.provider);
        return videoOutputs;
      }

      // Direct results (Gemini images)
      if (data.outputs) {
        return data.outputs.map((output: { type: string; base64?: string; mimeType?: string; url?: string }) => ({
          type: output.type,
          base64: output.base64,
          mimeType: output.mimeType,
          dataUrl: output.base64 ? `data:${output.mimeType};base64,${output.base64}` : undefined,
          url: output.url,
        }));
      }

      throw new Error('No outputs received');
    },
    [testInputs]
  );

  const pollForCompletion = async (taskId: string, provider: string): Promise<StageOutput[]> => {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const response = await fetch(
        `/api/generate/status?taskId=${taskId}&provider=${provider}`
      );
      const data = await response.json();

      if (data.status === 'completed' && data.outputs) {
        return data.outputs.map((output: { type: string; url?: string }) => ({
          type: output.type,
          url: output.url,
        }));
      }

      if (data.status === 'failed') {
        throw new Error('Video generation failed');
      }
    }

    throw new Error('Video generation timed out');
  };

  const handleRunTest = async () => {
    const runId = `run-${Date.now()}`;
    setTestRun({
      id: runId,
      status: 'running',
      startTime: Date.now(),
      outputs: [],
      stageProgress: { current: 1, total: stages.length, label: getStageLabel(stages[0]) },
    });

    try {
      const allOutputs: StageOutput[] = [];

      for (let i = 0; i < stages.length; i++) {
        setTestRun((prev) =>
          prev
            ? { ...prev, stageProgress: { current: i + 1, total: stages.length, label: getStageLabel(stages[i]) } }
            : prev
        );

        const stageOutputs = await runStage(stages[i], i, allOutputs);
        allOutputs.push(...stageOutputs);
      }

      setTestRun({
        id: runId,
        status: 'completed',
        startTime: Date.now() - stages.length * 2000,
        endTime: Date.now(),
        outputs: allOutputs,
        stageProgress: { current: stages.length, total: stages.length, label: 'Done' },
      });
    } catch (error) {
      setTestRun({
        id: runId,
        status: 'failed',
        startTime: Date.now(),
        endTime: Date.now(),
        outputs: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        stageProgress: { current: 0, total: stages.length, label: 'Failed' },
      });
    }
  };

  const getStageLabel = (stage: GenerationStage) =>
    `${stage.provider === 'gemini' ? 'Gemini' : 'Kling'} — ${stage.actionType}`;

  const getDuration = () => {
    if (!testRun?.startTime || !testRun?.endTime) return null;
    return ((testRun.endTime - testRun.startTime) / 1000).toFixed(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Creative Playground</h3>
        <p className="text-sm text-muted-foreground">
          Test your template with sample inputs before publishing
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Inputs */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-medium text-sm">Test Inputs</h4>
          </div>

          {userInputs.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No input fields configured. Add fields in the User Input tab first.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {userInputs
                .sort((a, b) => a.order - b.order)
                .map((input) => {
                  const Icon = fieldIcons[input.type] || ImageIcon;
                  const testInput = testInputs[input.fieldKey];

                  return (
                    <Card key={input.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <Label className="text-sm">{input.label}</Label>
                            {input.required && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Required</Badge>
                            )}
                          </div>
                          {testInput && (
                            <Button size="icon-xs" variant="ghost" onClick={() => clearInput(input.fieldKey)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>

                        {input.type === 'text' ? (
                          <Input
                            value={testInput?.value || ''}
                            onChange={(e) => handleTextInput(input, e.target.value)}
                            placeholder={input.placeholder || `Enter ${input.label.toLowerCase()}...`}
                            maxLength={input.maxLength}
                          />
                        ) : testInput?.preview ? (
                          <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                            <img src={testInput.preview} alt={input.label} className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => fileInputRefs.current[input.fieldKey]?.click()}
                            className="w-full aspect-3/1 rounded-lg border-2 border-dashed border-border hover:border-primary/50 bg-muted/30 flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer"
                          >
                            <Upload className="h-6 w-6 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Click to upload {input.type}</span>
                            {input.helperText && (
                              <span className="text-xs text-muted-foreground/60">{input.helperText}</span>
                            )}
                          </button>
                        )}

                        <input
                          ref={(el) => { fileInputRefs.current[input.fieldKey] = el; }}
                          type="file"
                          className="hidden"
                          accept={input.acceptedFormats?.join(',') || (input.type === 'image' ? 'image/*' : 'video/*')}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileSelect(input, file);
                            e.target.value = '';
                          }}
                        />
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}

          {/* Pipeline summary */}
          {stages.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                <h4 className="font-medium text-sm">Pipeline</h4>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {stages.map((stage, i) => (
                  <div key={stage.id} className="flex items-center gap-2">
                    {i > 0 && <span className="text-muted-foreground">→</span>}
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs',
                        testRun?.status === 'running' &&
                          testRun?.stageProgress?.current === i + 1 &&
                          'border-primary/50 bg-primary/10 animate-pulse'
                      )}
                    >
                      {stage.provider === 'gemini' ? '✦ Gemini' : '▶ Kling'}: {stage.actionType}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Run button */}
          <Button
            className="w-full h-11"
            disabled={!canRun || testRun?.status === 'running'}
            onClick={handleRunTest}
          >
            {testRun?.status === 'running' ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {testRun.stageProgress.label} ({testRun.stageProgress.current}/{testRun.stageProgress.total})
              </>
            ) : testRun?.status === 'completed' || testRun?.status === 'failed' ? (
              <>
                <RotateCcw className="h-4 w-4 mr-2" />
                Re-run Test
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Run Generation
              </>
            )}
          </Button>

          {!canRun && !testRun && (
            <p className="text-xs text-muted-foreground text-center">
              {!hasStages
                ? 'Add generation stages in the Generation tab first'
                : 'Fill in all required inputs to run a test'}
            </p>
          )}
        </div>

        {/* Right: Results */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-medium text-sm">Results</h4>
            {testRun?.status === 'completed' && getDuration() && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                <Clock className="h-3 w-3" />
                {getDuration()}s
              </div>
            )}
          </div>

          {!testRun ? (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <Sparkles className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Results will appear here after running a test</p>
                <p className="text-xs text-muted-foreground mt-1">Upload test inputs and click &quot;Run Generation&quot;</p>
              </CardContent>
            </Card>
          ) : testRun.status === 'running' ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
                <p className="font-medium">Generating...</p>
                <p className="text-sm text-muted-foreground mt-1">{testRun.stageProgress.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Stage {testRun.stageProgress.current} of {testRun.stageProgress.total}
                </p>
                <div className="w-48 mx-auto mt-4 bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${(testRun.stageProgress.current / testRun.stageProgress.total) * 100}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ) : testRun.status === 'failed' ? (
            <Card className="border-destructive/30">
              <CardContent className="py-8 text-center">
                <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
                <p className="font-medium text-destructive">Generation Failed</p>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto wrap-break-word">
                  {testRun.error || 'An unexpected error occurred'}
                </p>
              </CardContent>
            </Card>
          ) : testRun.outputs.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-primary-green/10 border border-primary-green/20">
                <CheckCircle2 className="h-4 w-4 text-primary-green" />
                <span className="text-sm text-primary-green font-medium">Generation complete</span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {testRun.outputs.map((output, i) => (
                  <Card key={i} className="overflow-hidden group">
                    {output.type === 'image' ? (
                      <div className="relative">
                        <img
                          src={output.dataUrl || output.url || ''}
                          alt={`Result ${i + 1}`}
                          className="w-full aspect-square object-cover"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                          <Button
                            size="icon-sm"
                            variant="secondary"
                            onClick={() => setPreviewImage(output.dataUrl || output.url || '')}
                          >
                            <Maximize2 className="h-4 w-4" />
                          </Button>
                          {(output.dataUrl || output.url) && (
                            <a href={output.dataUrl || output.url} download={`result-${i + 1}.png`}>
                              <Button size="icon-sm" variant="secondary">
                                <Download className="h-4 w-4" />
                              </Button>
                            </a>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4">
                        {output.url ? (
                          <video src={output.url} controls className="w-full rounded-lg" />
                        ) : (
                          <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
                            <Video className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    )}
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">
                        Output {i + 1} — {output.type === 'image' ? 'Image' : 'Video'}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Full-screen preview */}
      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Preview</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <div className="p-4">
              <img src={previewImage} alt="Preview" className="w-full rounded-lg" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
