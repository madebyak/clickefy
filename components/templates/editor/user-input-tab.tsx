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
import { Template, TemplateInput, InputFieldType } from '@/lib/types/template';
import { cn } from '@/lib/utils';
import {
  Plus,
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

const fieldTypeConfig: Record<InputFieldType, { label: string; icon: typeof ImageIcon; color: string; bgColor: string }> = {
  image: { label: 'Image', icon: ImageIcon, color: 'text-blue-400', bgColor: 'bg-blue-400/10' },
  video: { label: 'Video', icon: Video, color: 'text-purple-400', bgColor: 'bg-purple-400/10' },
  text: { label: 'Text', icon: Type, color: 'text-emerald-400', bgColor: 'bg-emerald-400/10' },
};

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
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const inputs = template.userInputs || [];

  const handleAddInput = (type: InputFieldType) => {
    const existingKeys = inputs.map((i) => i.fieldKey);
    const defaultLabels: Record<InputFieldType, string> = {
      image: 'Product Image',
      video: 'Product Video',
      text: 'Product Name',
    };

    const label = defaultLabels[type];
    const newInput: TemplateInput = {
      id: `input-${Date.now()}`,
      fieldKey: generateFieldKey(label, existingKeys),
      label,
      required: true,
      type,
      order: inputs.length + 1,
      ...(type !== 'text' && {
        acceptedFormats: type === 'image'
          ? ['image/jpeg', 'image/png', 'image/webp']
          : ['video/mp4', 'video/quicktime'],
        maxSize: type === 'image' ? 10 : 50,
      }),
      ...(type === 'text' && {
        placeholder: '',
        maxLength: 100,
      }),
    };
    setEditingInput(newInput);
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

    onChange({ userInputs: updatedInputs });
    setEditingInput(null);
    setIsDialogOpen(false);
  };

  const handleDeleteInput = (id: string) => {
    onChange({ userInputs: inputs.filter((i) => i.id !== id) });
  };

  const handleDuplicateInput = (input: TemplateInput) => {
    const existingKeys = inputs.map((i) => i.fieldKey);
    const duplicate: TemplateInput = {
      ...input,
      id: `input-${Date.now()}`,
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
            .map((input, index) => {
              const config = fieldTypeConfig[input.type];
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
                            {input.type !== 'text' && input.maxSize && ` • Max ${input.maxSize}MB`}
                            {input.type === 'text' && input.maxLength && ` • Max ${input.maxLength} chars`}
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
                          onClick={() => {
                            setEditingInput(input);
                            setIsDialogOpen(true);
                          }}
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
          if (!open) setEditingInput(null);
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
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Field Type</Label>
                  <Select
                    value={editingInput.type}
                    onValueChange={(value) => {
                      const newType = (value || 'image') as InputFieldType;
                      setEditingInput({
                        ...editingInput,
                        type: newType,
                        ...(newType === 'text'
                          ? { acceptedFormats: undefined, maxSize: undefined, minResolution: undefined, placeholder: '', maxLength: 100 }
                          : {
                              placeholder: undefined,
                              maxLength: undefined,
                              acceptedFormats: newType === 'image'
                                ? ['image/jpeg', 'image/png', 'image/webp']
                                : ['video/mp4', 'video/quicktime'],
                              maxSize: newType === 'image' ? 10 : 50,
                            }),
                      });
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

                {editingInput.type !== 'text' ? (
                  <div className="space-y-2">
                    <Label htmlFor="input-maxsize">Max File Size (MB)</Label>
                    <Input
                      id="input-maxsize"
                      type="number"
                      value={editingInput.maxSize ?? 10}
                      onChange={(e) =>
                        setEditingInput({ ...editingInput, maxSize: parseInt(e.target.value) || 10 })
                      }
                    />
                  </div>
                ) : (
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
                )}
              </div>

              {editingInput.type === 'text' && (
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
