'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BasicInfoTab } from '@/components/templates/editor/basic-info-tab';
import { UserInputTab } from '@/components/templates/editor/user-input-tab';
import { GenerationTab } from '@/components/templates/editor/generation-tab';
import { PlaygroundTab } from '@/components/templates/editor/playground-tab';
import { useTemplatesStore } from '@/lib/stores/templates-store';
import { useCategoriesStore } from '@/lib/stores/categories-store';
import { Template } from '@/lib/types/template';
import { ArrowLeft, Save, Globe, Info, Upload, Zap, Play, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function TemplateEditorPage() {
  const router = useRouter();
  const params = useParams();
  const templateId = params.id as string;
  const isNew = templateId === 'new';

  const { currentTemplate, fetchTemplates, fetchTemplate, createTemplate, updateTemplate, clearCurrentTemplate } =
    useTemplatesStore();
  const { categories, fetchCategories } = useCategoriesStore();

  const [templateData, setTemplateData] = useState<Partial<Template>>({});
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');

  useEffect(() => {
    fetchCategories();

    if (!isNew) {
      // Ensure templates are loaded before fetching a single one
      const store = useTemplatesStore.getState();
      if (store.templates.length === 0) {
        fetchTemplates().then(() => fetchTemplate(templateId));
      } else {
        fetchTemplate(templateId);
      }
    } else {
      setTemplateData({
        title: '',
        description: { short: '', long: '' },
        type: 'image',
        status: 'draft',
        featured: false,
        userInputs: [],
        userCanChooseAspectRatio: false,
        generation: {
          mode: 'image',
          stages: [],
        },
        output: {
          type: 'image',
          count: 1,
          format: 'png',
          allowRegeneration: true,
        },
      });
    }

    return () => {
      clearCurrentTemplate();
    };
  }, [templateId, isNew, fetchTemplate, fetchTemplates, fetchCategories, clearCurrentTemplate]);

  useEffect(() => {
    if (currentTemplate && !isNew) {
      setTemplateData(currentTemplate);
    }
  }, [currentTemplate, isNew]);

  const handleDataChange = (data: Partial<Template>) => {
    setTemplateData((prev) => ({ ...prev, ...data }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isNew) {
        const newId = await createTemplate(templateData);
        toast.success('Template created successfully');
        setTimeout(() => router.push(`/admin/templates/${newId}`), 500);
      } else {
        await updateTemplate(templateId, templateData);
        toast.success('Template saved successfully');
      }
    } catch {
      toast.error('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setSaving(true);
    try {
      await updateTemplate(templateId, { ...templateData, status: 'published' });
      toast.success('Template published successfully');
      setTimeout(() => router.push('/admin/templates'), 500);
    } catch {
      toast.error('Failed to publish template');
    } finally {
      setSaving(false);
    }
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    published: 'bg-primary-green/10 text-primary-green border-primary-green/20',
    archived: 'bg-muted text-muted-foreground',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/admin/templates')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                {isNew ? 'Create Template' : templateData.title || 'Edit Template'}
              </h1>
              {!isNew && templateData.status && (
                <Badge variant="outline" className={statusColors[templateData.status]}>
                  {templateData.status.charAt(0).toUpperCase() + templateData.status.slice(1)}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isNew
                ? 'Configure your AI generation template step by step'
                : `Last edited ${templateData.updatedAt ? new Date(templateData.updatedAt).toLocaleDateString() : 'recently'}`}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Draft
          </Button>
          {!isNew && templateData.status === 'draft' && (
            <Button onClick={handlePublish} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Globe className="h-4 w-4 mr-2" />
              )}
              Publish
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="basic">
            <Info className="h-4 w-4 mr-2" />
            Basic Info
          </TabsTrigger>
          <TabsTrigger value="input">
            <Upload className="h-4 w-4 mr-2" />
            User Input
          </TabsTrigger>
          <TabsTrigger value="generation">
            <Zap className="h-4 w-4 mr-2" />
            Generation
          </TabsTrigger>
          <TabsTrigger value="playground">
            <Play className="h-4 w-4 mr-2" />
            Playground
          </TabsTrigger>
        </TabsList>

        <div className="mt-6 bg-card rounded-xl border p-6">
          <TabsContent value="basic">
            <BasicInfoTab
              template={templateData}
              categories={categories}
              onChange={handleDataChange}
            />
          </TabsContent>
          <TabsContent value="input">
            <UserInputTab
              template={templateData}
              onChange={handleDataChange}
            />
          </TabsContent>
          <TabsContent value="generation">
            <GenerationTab
              template={templateData}
              onChange={handleDataChange}
            />
          </TabsContent>
          <TabsContent value="playground">
            <PlaygroundTab template={templateData} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
