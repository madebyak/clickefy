'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';
import { BasicInfoTab } from '@/components/templates/editor/basic-info-tab';
import { UserInputTab } from '@/components/templates/editor/user-input-tab';
import { GenerationTab } from '@/components/templates/editor/generation-tab';
import { useTemplatesStore } from '@/lib/stores/templates-store';
import { useCategoriesStore } from '@/lib/stores/categories-store';
import { Template } from '@/lib/types/template';

/**
 * Template Editor Page
 * Multi-tab interface for creating and editing templates
 * 
 * Tabs:
 * 1. Basic Info - Title, description, category, type
 * 2. User Input - Configure user upload requirements
 * 3. Generation Setup - AI generation pipeline configuration
 * 4. Creative Playground - Test generation (TODO)
 * 5. Output Settings - Configure output format (TODO)
 * 6. Publish - Review and publish (TODO)
 */
export default function TemplateEditorPage() {
  const router = useRouter();
  const params = useParams();
  const templateId = params.id as string;
  const isNew = templateId === 'new';

  const { currentTemplate, fetchTemplate, createTemplate, updateTemplate, clearCurrentTemplate } = useTemplatesStore();
  const { categories, fetchCategories } = useCategoriesStore();

  const [activeTab, setActiveTab] = useState('basic');
  const [templateData, setTemplateData] = useState<Partial<Template>>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchCategories();
    
    if (!isNew) {
      fetchTemplate(templateId);
    } else {
      setTemplateData({
        title: '',
        description: { short: '', long: '' },
        type: 'image',
        status: 'draft',
        featured: false,
        userInputs: [],
        generation: {
          mode: 'image',
          stages: [],
        },
      });
    }

    return () => {
      clearCurrentTemplate();
    };
  }, [templateId, isNew, fetchTemplate, fetchCategories, clearCurrentTemplate]);

  useEffect(() => {
    if (currentTemplate && !isNew) {
      setTemplateData(currentTemplate);
    }
  }, [currentTemplate, isNew]);

  const tabs = [
    {
      id: 'basic',
      label: 'Basic Info',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: 'input',
      label: 'User Input',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      ),
    },
    {
      id: 'generation',
      label: 'Generation',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      id: 'playground',
      label: 'Playground',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  const handleDataChange = (data: Partial<Template>) => {
    setTemplateData({ ...templateData, ...data });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isNew) {
        const newId = await createTemplate(templateData);
        setToast({ message: 'Template created successfully', type: 'success' });
        setTimeout(() => router.push(`/admin/templates/${newId}`), 1000);
      } else {
        await updateTemplate(templateId, templateData);
        setToast({ message: 'Template saved successfully', type: 'success' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save template', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    // TODO: Add validation before publishing
    setSaving(true);
    try {
      await updateTemplate(templateId, { ...templateData, status: 'published' });
      setToast({ message: 'Template published successfully', type: 'success' });
      setTimeout(() => router.push('/admin/templates'), 1000);
    } catch (error) {
      setToast({ message: 'Failed to publish template', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/admin/templates')}
            className="w-10 h-10 rounded-lg bg-surface hover:bg-surface-elevated transition-colors flex items-center justify-center"
          >
            <svg className="w-5 h-5 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              {isNew ? 'Create Template' : templateData.title || 'Edit Template'}
            </h1>
            <p className="text-sm text-text-secondary">
              {isNew ? 'Configure your AI generation template' : `Editing ${templateData.status} template`}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleSave} loading={saving}>
            Save Draft
          </Button>
          {!isNew && templateData.status === 'draft' && (
            <Button onClick={handlePublish} loading={saving}>
              Publish
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface rounded-lg overflow-hidden">
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'basic' && (
            <BasicInfoTab
              template={templateData}
              categories={categories}
              onChange={handleDataChange}
            />
          )}
          {activeTab === 'input' && (
            <UserInputTab
              template={templateData}
              onChange={handleDataChange}
            />
          )}
          {activeTab === 'generation' && (
            <GenerationTab
              template={templateData}
              onChange={handleDataChange}
            />
          )}
          {activeTab === 'playground' && (
            <div className="text-center py-12">
              <svg className="w-16 h-16 mx-auto text-text-secondary mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-text-primary font-medium mb-2">Creative Playground</p>
              <p className="text-sm text-text-secondary">Coming next: Test your generation with Gemini API</p>
            </div>
          )}
        </div>
      </div>

      {/* Toast Notifications */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          isVisible={true}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
