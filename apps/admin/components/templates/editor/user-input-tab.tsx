'use client';

import { useState } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type {
  Template,
  TemplateInput,
  InputFieldType,
  TemplateInputType,
  TemplateInputTranslation,
} from '@clickfy/types';
import { cn } from '@/lib/utils';
import {
  getTemplateInputTranslation,
  pruneTemplateInputTranslations,
  setTemplateInputTranslation,
} from '@/lib/i18n-content';
import {
  ImageIcon,
  Video,
  Type,
  Pencil,
  Trash2,
  Upload,
  GripVertical,
  Copy,
  AlertCircle,
} from 'lucide-react';

interface UserInputTabProps {
  template: Partial<Template>;
  onChange: (data: Partial<Template>) => void;
}

interface FieldTypeMeta {
  label: string;
  icon: typeof ImageIcon;
  color: string;
  bgColor: string;
}

/**
 * Phase 1 admin only exposes the legacy `image | video | text` types in
 * the field editor. Phase 4 extends this to the full union (textarea,
 * image_multi, select). Unknown variants fall back to the image styling.
 */
const fieldTypeConfig: Record<InputFieldType, FieldTypeMeta> = {
  image: { label: 'Image', icon: ImageIcon, color: 'text-blue-400', bgColor: 'bg-blue-400/10' },
  video: { label: 'Video', icon: Video, color: 'text-purple-400', bgColor: 'bg-purple-400/10' },
  text: { label: 'Text', icon: Type, color: 'text-emerald-400', bgColor: 'bg-emerald-400/10' },
};

const legacyMetaFallback: FieldTypeMeta = fieldTypeConfig.image;

function metaFor(type: TemplateInputType): FieldTypeMeta {
  return (fieldTypeConfig as Partial<Record<TemplateInputType, FieldTypeMeta>>)[type] ?? legacyMetaFallback;
}

function generateFieldKey(label: string, existingKeys: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
  let key = base;
  let counter = 1;
  while (existingKeys.includes(key)) {
    key = `${base}_${counter}`;
    counter++;
  }
  return key;
}

export function UserInputTab({ template, onChange }: UserInputTabProps) {
  const [editingInput, setEditingInput] = useState<TemplateInput | null>(null);
  // Arabic overrides for the field currently open in the dialog. Kept
  // separate from `editingInput` (which is the canonical English field)
  // and committed into `template.translations` only on Save.
  const [editingTranslation, setEditingTranslation] =
    useState<TemplateInputTranslation>({});
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const inputs = template.userInputs || [];

  /** Open the dialog for an input, seeding its Arabic overrides. */
  const openEditor = (input: TemplateInput) => {
    setEditingInput(input);
    setEditingTranslation(
      getTemplateInputTranslation(template.translations, 'ar', input.fieldKey),
    );
    setIsDialogOpen(true);
  };

  /** Patch one Arabic sub-field of the field being edited. */
  const patchTranslation = (patch: Partial<TemplateInputTranslation>) => {
    setEditingTranslation((prev) => ({ ...prev, ...patch }));
  };

  /** Patch one Arabic select-option label (keyed by option `value`). */
  const patchOptionTranslation = (value: string, label: string) => {
    setEditingTranslation((prev) => ({
      ...prev,
      options: { ...(prev.options ?? {}), [value]: label },
    }));
  };

  const handleAddInput = (type: InputFieldType) => {
    const existingKeys = inputs.map((i) => i.fieldKey);
    const defaultLabels: Record<InputFieldType, string> = {
      image: 'Product Image',
      video: 'Product Video',
      text: 'Product Name',
    };

    const label = defaultLabels[type];
    const base = {
      id: `input-${crypto.randomUUID()}`,
      fieldKey: generateFieldKey(label, existingKeys),
      label,
      required: true,
      order: inputs.length + 1,
    };

    // Each variant is constructed with its discriminated shape, then
    // re-narrowed by TS via the union. Cast in a single spot so the
    // dialog state (which still tracks an arbitrary `TemplateInput`)
    // remains assignable.
    let newInput: TemplateInput;
    if (type === 'text') {
      newInput = { ...base, type: 'text', placeholder: '', maxLength: 100 };
    } else if (type === 'image') {
      newInput = {
        ...base,
        type: 'image',
        acceptedFormats: ['image/jpeg', 'image/png', 'image/webp'],
        maxSizeMB: 10,
      };
    } else {
      newInput = {
        ...base,
        type: 'video',
        acceptedFormats: ['video/mp4', 'video/quicktime'],
        maxSizeMB: 50,
      };
    }

    setEditingInput(newInput);
    setEditingTranslation({});
    setIsDialogOpen(true);
  };

  const handleSaveInput = () => {
    if (!editingInput) return;

    const existingIndex = inputs.findIndex((i) => i.id === editingInput.id);
    let updatedInputs;

    if (existingIndex >= 0) {
      updatedInputs = [...inputs];
      updatedInputs[existingIndex] = editingInput;
    } else {
      updatedInputs = [...inputs, editingInput];
    }

    // Commit the Arabic overrides. First prune to the live fieldKeys so a
    // renamed field drops its stale entry, then write this field's Arabic
    // under its (possibly new) fieldKey. Empty values are stripped by the
    // helper so they fall back to English.
    const validKeys = updatedInputs.map((i) => i.fieldKey);
    const pruned = pruneTemplateInputTranslations(template.translations, validKeys);
    const nextTranslations = setTemplateInputTranslation(
      pruned,
      'ar',
      editingInput.fieldKey,
      editingTranslation,
    );

    onChange({ userInputs: updatedInputs, translations: nextTranslations });
    setEditingInput(null);
    setEditingTranslation({});
    setIsDialogOpen(false);
  };

  const handleDeleteInput = (id: string) => {
    const remaining = inputs.filter((i) => i.id !== id);
    onChange({
      userInputs: remaining,
      // Drop the deleted field's Arabic so it can't resurface on a reused key.
      translations: pruneTemplateInputTranslations(
        template.translations,
        remaining.map((i) => i.fieldKey),
      ),
    });
  };

  const handleDuplicateInput = (input: TemplateInput) => {
    const existingKeys = inputs.map((i) => i.fieldKey);
    const duplicate: TemplateInput = {
      ...input,
      id: `input-${crypto.randomUUID()}`,
      label: `${input.label} (Copy)`,
      fieldKey: generateFieldKey(`${input.label} copy`, existingKeys),
      order: inputs.length + 1,
    };
    onChange({ userInputs: [...inputs, duplicate] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">User Input Fields</h3>
          <p className="text-sm text-muted-foreground">
            Define what users need to provide when using this template.
            Use field keys as <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{'{{field_key}}'}</code> variables in your prompts.
          </p>
        </div>
      </div>

      {/* Add field buttons */}
      <div className="flex gap-2">
        {(Object.entries(fieldTypeConfig) as [InputFieldType, typeof fieldTypeConfig.image][]).map(
          ([type, config]) => (
            <Button
              key={type}
              variant="outline"
              size="sm"
              onClick={() => handleAddInput(type)}
              className="gap-2"
            >
              <config.icon className={cn('h-4 w-4', config.color)} />
              Add {config.label}
            </Button>
          )
        )}
      </div>

      {/* Input fields list */}
      {inputs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-muted/30 rounded-xl border border-dashed border-border">
          <Upload className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground font-medium">No input fields yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm text-center">
            Add the fields users will fill out when they use this template — images, videos, or text
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {inputs
            .sort((a, b) => a.order - b.order)
            .map((input) => {
              const config = metaFor(input.type);
              const IconComp = config.icon;

              return (
                <Card key={input.id} className="group">
                  <CardContent className="p-0">
                    <div className="flex items-center gap-3 p-4">
                      <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0 cursor-grab" />

                      <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg shrink-0', config.bgColor)}>
                        <IconComp className={cn('h-5 w-5', config.color)} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">{input.label}</p>
                          {input.required && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                              Required
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <code className="text-xs text-primary font-mono bg-primary/5 px-1.5 py-0.5 rounded">
                            {`{{${input.fieldKey}}}`}
                          </code>
                          <span className="text-xs text-muted-foreground">
                            {config.label}
                            {'maxSizeMB' in input && input.maxSizeMB && ` • Max ${input.maxSizeMB}MB`}
                            {(input.type === 'text' || input.type === 'textarea') && input.maxLength && ` • Max ${input.maxLength} chars`}
                          </span>
                        </div>
                      </div>

                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => handleDuplicateInput(input)}
                          title="Duplicate"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => openEditor(input)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteInput(input.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}

      {/* Hint */}
      {inputs.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10">
          <AlertCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Reference these fields in your generation prompts using their variable keys.
            For example, use <code className="text-primary font-mono">{'{{product_image}}'}</code> in
            your prompt to include the user&apos;s uploaded image.
          </p>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setEditingInput(null);
            setEditingTranslation({});
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingInput && inputs.find((i) => i.id === editingInput.id)
                ? 'Edit Field'
                : 'Add Field'}
            </DialogTitle>
          </DialogHeader>

          {editingInput && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="input-label">Label</Label>
                  <Input
                    id="input-label"
                    value={editingInput.label}
                    onChange={(e) => setEditingInput({ ...editingInput, label: e.target.value })}
                    placeholder="e.g., Product Image"
                  />
                  <p className="text-xs text-muted-foreground">Shown to users in the mobile app</p>
                  {/* Arabic override — blank falls back to the English label. */}
                  <Label htmlFor="input-label-ar" className="text-xs text-muted-foreground">
                    Label (العربية)
                  </Label>
                  <Input
                    id="input-label-ar"
                    dir="rtl"
                    lang="ar"
                    value={editingTranslation.label ?? ''}
                    onChange={(e) => patchTranslation({ label: e.target.value })}
                    placeholder="مثال: صورة المنتج"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="input-key">Variable Key</Label>
                  <div className="relative">
                    <Input
                      id="input-key"
                      value={editingInput.fieldKey}
                      onChange={(e) =>
                        setEditingInput({
                          ...editingInput,
                          fieldKey: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                        })
                      }
                      placeholder="e.g., product_image"
                      className="font-mono text-sm"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Use as <code className="text-primary font-mono">{`{{${editingInput.fieldKey || '...'}}}`}</code> in prompts
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="input-helper">Helper Text</Label>
                <Input
                  id="input-helper"
                  value={editingInput.helperText || ''}
                  onChange={(e) =>
                    setEditingInput({ ...editingInput, helperText: e.target.value })
                  }
                  placeholder="Instructions for the user, e.g., Upload a clear photo of your product"
                />
                {/* Arabic override — blank falls back to the English helper. */}
                <Label htmlFor="input-helper-ar" className="text-xs text-muted-foreground">
                  Helper Text (العربية)
                </Label>
                <Input
                  id="input-helper-ar"
                  dir="rtl"
                  lang="ar"
                  value={editingTranslation.helperText ?? ''}
                  onChange={(e) => patchTranslation({ helperText: e.target.value })}
                  placeholder="تعليمات للمستخدم بالعربية"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Field Type</Label>
                  <Select
                    value={editingInput.type}
                    onValueChange={(value) => {
                      const newType = (value || 'image') as InputFieldType;
                      // Re-build the variant from scratch so TS can narrow
                      // properly — switching from text → image leaves text-only
                      // fields (placeholder/maxLength) that don't belong on the
                      // image variant, and vice versa.
                      const common = {
                        id: editingInput.id,
                        fieldKey: editingInput.fieldKey,
                        label: editingInput.label,
                        helperText: editingInput.helperText,
                        required: editingInput.required,
                        order: editingInput.order,
                      };
                      let next: TemplateInput;
                      if (newType === 'text') {
                        next = { ...common, type: 'text', placeholder: '', maxLength: 100 };
                      } else if (newType === 'image') {
                        next = {
                          ...common,
                          type: 'image',
                          acceptedFormats: ['image/jpeg', 'image/png', 'image/webp'],
                          maxSizeMB: 10,
                        };
                      } else {
                        next = {
                          ...common,
                          type: 'video',
                          acceptedFormats: ['video/mp4', 'video/quicktime'],
                          maxSizeMB: 50,
                        };
                      }
                      setEditingInput(next);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(fieldTypeConfig) as [InputFieldType, typeof fieldTypeConfig.image][]).map(
                        ([type, config]) => (
                          <SelectItem key={type} value={type}>
                            <div className="flex items-center gap-2">
                              <config.icon className={cn('h-3.5 w-3.5', config.color)} />
                              {config.label}
                            </div>
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {(editingInput.type === 'image' || editingInput.type === 'video') ? (
                  <div className="space-y-2">
                    <Label htmlFor="input-maxsize">Max File Size (MB)</Label>
                    <Input
                      id="input-maxsize"
                      type="number"
                      value={editingInput.maxSizeMB ?? 10}
                      onChange={(e) =>
                        setEditingInput({ ...editingInput, maxSizeMB: parseInt(e.target.value) || 10 })
                      }
                    />
                  </div>
                ) : editingInput.type === 'text' ? (
                  <div className="space-y-2">
                    <Label htmlFor="input-maxlength">Max Characters</Label>
                    <Input
                      id="input-maxlength"
                      type="number"
                      value={editingInput.maxLength ?? 100}
                      onChange={(e) =>
                        setEditingInput({ ...editingInput, maxLength: parseInt(e.target.value) || 100 })
                      }
                    />
                  </div>
                ) : null}
              </div>

              {(editingInput.type === 'text' || editingInput.type === 'textarea') && (
                <div className="space-y-2">
                  <Label htmlFor="input-placeholder">Placeholder Text</Label>
                  <Input
                    id="input-placeholder"
                    value={editingInput.placeholder || ''}
                    onChange={(e) =>
                      setEditingInput({ ...editingInput, placeholder: e.target.value })
                    }
                    placeholder="e.g., Enter your product name"
                  />
                  {/* Arabic override — blank falls back to English. */}
                  <Label htmlFor="input-placeholder-ar" className="text-xs text-muted-foreground">
                    Placeholder Text (العربية)
                  </Label>
                  <Input
                    id="input-placeholder-ar"
                    dir="rtl"
                    lang="ar"
                    value={editingTranslation.placeholder ?? ''}
                    onChange={(e) => patchTranslation({ placeholder: e.target.value })}
                    placeholder="مثال: أدخل اسم المنتج"
                  />
                </div>
              )}

              {/* Select option labels — one Arabic field per option,
                  keyed by the option `value`. Only rendered for `select`
                  fields (created/seeded via the API; the add-field
                  buttons above don't yet expose `select`). */}
              {editingInput.type === 'select' && editingInput.options.length > 0 && (
                <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                  <Label className="text-sm font-medium">Option labels (العربية)</Label>
                  <p className="text-xs text-muted-foreground">
                    Translate each choice. Blank falls back to the English label.
                  </p>
                  <div className="space-y-2 pt-1">
                    {editingInput.options.map((opt) => (
                      <div key={opt.value} className="grid grid-cols-2 items-center gap-3">
                        <span className="truncate text-sm text-muted-foreground" title={opt.label}>
                          {opt.label}
                        </span>
                        <Input
                          dir="rtl"
                          lang="ar"
                          value={editingTranslation.options?.[opt.value] ?? ''}
                          onChange={(e) => patchOptionTranslation(opt.value, e.target.value)}
                          placeholder="الترجمة العربية"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="input-required"
                  checked={editingInput.required}
                  onChange={(e) =>
                    setEditingInput({ ...editingInput, required: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-ring"
                />
                <Label htmlFor="input-required" className="cursor-pointer">
                  Required field
                </Label>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false);
                setEditingInput(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveInput}>Save Field</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
