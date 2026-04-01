'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dropdown } from '@/components/ui/dropdown';
import { Template, TemplateInput } from '@/lib/types/template';

interface UserInputTabProps {
  template: Partial<Template>;
  onChange: (data: Partial<Template>) => void;
}

/**
 * User Input Tab
 * Configure what inputs users need to provide (images/videos)
 */
export function UserInputTab({ template, onChange }: UserInputTabProps) {
  const [editingInput, setEditingInput] = useState<TemplateInput | null>(null);

  const inputs = template.userInputs || [];

  const typeOptions = [
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' },
  ];

  const handleAddInput = () => {
    const newInput: TemplateInput = {
      id: `input-${Date.now()}`,
      fieldKey: `input_${inputs.length + 1}`,
      label: 'New Input',
      required: true,
      type: 'image',
      acceptedFormats: ['image/jpeg', 'image/png', 'image/webp'],
      maxSize: 10,
      order: inputs.length + 1,
    };
    setEditingInput(newInput);
  };

  const handleSaveInput = () => {
    if (!editingInput) return;

    const existingIndex = inputs.findIndex(i => i.id === editingInput.id);
    let updatedInputs;

    if (existingIndex >= 0) {
      updatedInputs = [...inputs];
      updatedInputs[existingIndex] = editingInput;
    } else {
      updatedInputs = [...inputs, editingInput];
    }

    onChange({ userInputs: updatedInputs });
    setEditingInput(null);
  };

  const handleDeleteInput = (id: string) => {
    const updatedInputs = inputs.filter(i => i.id !== id);
    onChange({ userInputs: updatedInputs });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">User Inputs</h3>
          <p className="text-sm text-text-secondary">Define what users need to upload</p>
        </div>
        <Button onClick={handleAddInput} icon={
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        }>
          Add Input
        </Button>
      </div>

      {/* Input List */}
      {inputs.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-lg">
          <svg className="w-16 h-16 mx-auto text-text-secondary mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-text-secondary">No user inputs configured</p>
          <p className="text-sm text-text-secondary mt-1">Add inputs that users will upload</p>
        </div>
      ) : (
        <div className="space-y-3">
          {inputs.map((input) => (
            <div key={input.id} className="bg-surface rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary-purple/10 flex items-center justify-center">
                  {input.type === 'image' ? (
                    <svg className="w-5 h-5 text-primary-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-primary-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="font-medium text-text-primary">{input.label}</p>
                  <p className="text-sm text-text-secondary">
                    Field key: <code className="text-primary-purple">{input.fieldKey}</code> • 
                    {input.required ? ' Required' : ' Optional'} • 
                    Max {input.maxSize}MB
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditingInput(input)}>
                  Edit
                </Button>
                <Button size="sm" variant="danger" onClick={() => handleDeleteInput(input.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-elevated rounded-lg p-6 w-full max-w-2xl">
            <h3 className="text-xl font-semibold text-text-primary mb-6">
              {inputs.find(i => i.id === editingInput.id) ? 'Edit Input' : 'Add Input'}
            </h3>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Label"
                  value={editingInput.label}
                  onChange={(e) => setEditingInput({ ...editingInput, label: e.target.value })}
                  placeholder="e.g., Product Image"
                  required
                />
                <Input
                  label="Field Key"
                  value={editingInput.fieldKey}
                  onChange={(e) => setEditingInput({ ...editingInput, fieldKey: e.target.value })}
                  placeholder="e.g., product_image"
                  helperText="Used in generation mapping"
                  required
                />
              </div>

              <Input
                label="Helper Text"
                value={editingInput.helperText || ''}
                onChange={(e) => setEditingInput({ ...editingInput, helperText: e.target.value })}
                placeholder="Instructions for the user"
              />

              <div className="grid grid-cols-2 gap-4">
                <Dropdown
                  label="Input Type"
                  options={typeOptions}
                  value={editingInput.type}
                  onChange={(value) => setEditingInput({ ...editingInput, type: value as 'image' | 'video' })}
                />
                <Input
                  label="Max Size (MB)"
                  type="number"
                  value={editingInput.maxSize}
                  onChange={(e) => setEditingInput({ ...editingInput, maxSize: parseInt(e.target.value) })}
                />
              </div>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={editingInput.required}
                  onChange={(e) => setEditingInput({ ...editingInput, required: e.target.checked })}
                  className="w-5 h-5 rounded bg-surface border-border text-primary-purple focus:ring-2 focus:ring-primary-purple"
                />
                <span className="text-sm font-medium text-text-primary">Required field</span>
              </label>
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <Button variant="ghost" onClick={() => setEditingInput(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveInput}>
                Save Input
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
