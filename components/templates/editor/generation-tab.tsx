'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dropdown } from '@/components/ui/dropdown';
import { Template, GenerationStage } from '@/lib/types/template';

interface GenerationTabProps {
  template: Partial<Template>;
  onChange: (data: Partial<Template>) => void;
}

/**
 * Generation Setup Tab
 * Configure AI generation stages, prompts, and model settings
 */
export function GenerationTab({ template, onChange }: GenerationTabProps) {
  const [editingStage, setEditingStage] = useState<GenerationStage | null>(null);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  const stages = template.generation?.stages || [];

  const providerOptions = [
    { value: 'gemini', label: 'Google Gemini' },
    { value: 'kling', label: 'Kling AI' },
  ];

  const geminiModels = [
    { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image Preview' },
    { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
  ];

  const klingModels = [
    { value: 'kling-v1', label: 'Kling V1' },
  ];

  const actionTypeOptions = [
    { value: 'text-to-image', label: 'Text to Image' },
    { value: 'image-to-image', label: 'Image to Image' },
    { value: 'image-to-video', label: 'Image to Video' },
  ];

  const aspectRatioOptions = [
    { value: '1:1', label: '1:1 (Square)' },
    { value: '4:5', label: '4:5 (Portrait)' },
    { value: '9:16', label: '9:16 (Vertical)' },
    { value: '16:9', label: '16:9 (Horizontal)' },
  ];

  const handleAddStage = () => {
    const newStage: GenerationStage = {
      id: `stage-${Date.now()}`,
      order: stages.length + 1,
      provider: 'gemini',
      model: 'gemini-3.1-flash-image-preview',
      actionType: 'image-to-image',
      prompt: '',
      inputMapping: {},
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
    setEditingStage(newStage);
  };

  const handleSaveStage = () => {
    if (!editingStage) return;

    const existingIndex = stages.findIndex(s => s.id === editingStage.id);
    let updatedStages;

    if (existingIndex >= 0) {
      updatedStages = [...stages];
      updatedStages[existingIndex] = editingStage;
    } else {
      updatedStages = [...stages, editingStage];
    }

    onChange({
      generation: {
        mode: template.generation?.mode || template.type || 'image',
        stages: updatedStages,
      },
    });
    setEditingStage(null);
  };

  const handleDeleteStage = (id: string) => {
    const updatedStages = stages.filter(s => s.id !== id);
    onChange({
      generation: {
        mode: template.generation?.mode || template.type || 'image',
        stages: updatedStages,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Generation Pipeline</h3>
          <p className="text-sm text-text-secondary">Configure AI generation stages</p>
        </div>
        <Button onClick={handleAddStage} icon={
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        }>
          Add Stage
        </Button>
      </div>

      {/* Stages List */}
      {stages.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-lg">
          <svg className="w-16 h-16 mx-auto text-text-secondary mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <p className="text-text-secondary">No generation stages configured</p>
          <p className="text-sm text-text-secondary mt-1">Add stages to define the AI generation pipeline</p>
        </div>
      ) : (
        <div className="space-y-3">
          {stages.map((stage, index) => (
            <div key={stage.id} className="bg-surface rounded-lg overflow-hidden">
              <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-surface-elevated transition-colors"
                onClick={() => setExpandedStage(expandedStage === stage.id ? null : stage.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary-green/10 flex items-center justify-center">
                    <span className="text-primary-green font-semibold">{index + 1}</span>
                  </div>
                  <div>
                    <p className="font-medium text-text-primary">
                      {stage.provider === 'gemini' ? 'Google Gemini' : 'Kling AI'} • {stage.actionType}
                    </p>
                    <p className="text-sm text-text-secondary">{stage.model}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditingStage(stage); }}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); handleDeleteStage(stage.id); }}>
                    Delete
                  </Button>
                  <svg
                    className={`w-5 h-5 text-text-secondary transition-transform ${expandedStage === stage.id ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {expandedStage === stage.id && (
                <div className="p-4 bg-surface-elevated border-t border-border">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">Prompt</label>
                      <p className="text-sm text-text-secondary bg-surface rounded-lg p-3 whitespace-pre-wrap">
                        {stage.prompt || 'No prompt configured'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-text-primary mb-1">Aspect Ratio</label>
                        <p className="text-sm text-text-secondary">{stage.config.aspectRatio || 'Not set'}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-text-primary mb-1">Retry</label>
                        <p className="text-sm text-text-secondary">
                          {stage.retry.enabled ? `Up to ${stage.retry.maxAttempts} attempts` : 'Disabled'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Edit Stage Modal */}
      {editingStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-surface-elevated rounded-lg p-6 w-full max-w-4xl my-8">
            <h3 className="text-xl font-semibold text-text-primary mb-6">
              {stages.find(s => s.id === editingStage.id) ? 'Edit Stage' : 'Add Stage'}
            </h3>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <Dropdown
                  label="Provider"
                  options={providerOptions}
                  value={editingStage.provider}
                  onChange={(value) => setEditingStage({
                    ...editingStage,
                    provider: value as 'gemini' | 'kling',
                    model: value === 'gemini' ? 'gemini-3.1-flash-image-preview' : 'kling-v1',
                  })}
                />
                <Dropdown
                  label="Model"
                  options={editingStage.provider === 'gemini' ? geminiModels : klingModels}
                  value={editingStage.model}
                  onChange={(value) => setEditingStage({ ...editingStage, model: value })}
                />
              </div>

              <Dropdown
                label="Action Type"
                options={actionTypeOptions}
                value={editingStage.actionType}
                onChange={(value) => setEditingStage({ ...editingStage, actionType: value as GenerationStage['actionType'] })}
              />

              <Textarea
                label="Prompt"
                value={editingStage.prompt}
                onChange={(e) => setEditingStage({ ...editingStage, prompt: e.target.value })}
                placeholder="Describe what you want the AI to generate..."
                className="min-h-[200px] font-mono text-sm"
                helperText="Be specific and detailed. Mention composition, lighting, mood, and style."
                required
              />

              <div className="grid grid-cols-2 gap-4">
                <Dropdown
                  label="Aspect Ratio"
                  options={aspectRatioOptions}
                  value={editingStage.config.aspectRatio || '1:1'}
                  onChange={(value) => setEditingStage({
                    ...editingStage,
                    config: { ...editingStage.config, aspectRatio: value },
                  })}
                />
                <Input
                  label="Number of Outputs"
                  type="number"
                  value={editingStage.config.numberOfOutputs || 1}
                  onChange={(e) => setEditingStage({
                    ...editingStage,
                    config: { ...editingStage.config, numberOfOutputs: parseInt(e.target.value) },
                  })}
                  min={1}
                  max={4}
                />
              </div>

              <div className="bg-surface rounded-lg p-4">
                <label className="flex items-center gap-3 mb-3">
                  <input
                    type="checkbox"
                    checked={editingStage.retry.enabled}
                    onChange={(e) => setEditingStage({
                      ...editingStage,
                      retry: { ...editingStage.retry, enabled: e.target.checked },
                    })}
                    className="w-5 h-5 rounded bg-surface border-border text-primary-purple focus:ring-2 focus:ring-primary-purple"
                  />
                  <span className="text-sm font-medium text-text-primary">Enable retry on failure</span>
                </label>
                {editingStage.retry.enabled && (
                  <Input
                    label="Max Retry Attempts"
                    type="number"
                    value={editingStage.retry.maxAttempts}
                    onChange={(e) => setEditingStage({
                      ...editingStage,
                      retry: { ...editingStage.retry, maxAttempts: parseInt(e.target.value) },
                    })}
                    min={1}
                    max={5}
                  />
                )}
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <Button variant="ghost" onClick={() => setEditingStage(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveStage}>
                Save Stage
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
