'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BasicInfoTab } from '@/components/templates/editor/basic-info-tab';
import { UserInputTab } from '@/components/templates/editor/user-input-tab';
import { GenerationTab } from '@/components/templates/editor/generation-tab';
import { PlaygroundTab } from '@/components/templates/editor/playground-tab';
import { TemplateCostSummary } from '@/components/templates/template-cost-summary';
import { useTemplatesStore } from '@/lib/stores/templates-store';
import { useCategoriesStore } from '@/lib/stores/categories-store';
import type { Template, TemplateFormData } from '@clickfy/types';
import { ArrowLeft, Save, Globe, Info, Upload, Zap, Play, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Build the body sent to `createTemplate` / `updateTemplate`.
 *
 * Validation is tiered:
 *
 *   - `intent: 'draft'` — only the bare minimum the API actually
 *     needs (title + a generation/output skeleton). Cover image and
 *     primary category may be missing; the admin can fill them in
 *     later. The server's `cover_media` column is nullable for this
 *     reason and the `/publish` endpoint enforces the rest.
 *
 *   - `intent: 'publish'` — everything a published template needs to
 *     render on the mobile catalog (title, primary category, cover,
 *     at least one pipeline stage). Failing here keeps the admin from
 *     hitting a confusing 400 from the publish handler.
 *
 * Returns the typed `TemplateFormData` on success, or `null` if the
 * caller should not save.
 */
function buildFormPayload(
  templateData: Partial<Template>,
  { intent }: { intent: 'draft' | 'publish' },
): TemplateFormData | null {
  if (!templateData.title?.trim()) {
    toast.error('Title is required.');
    return null;
  }

  const primaryCategoryId =
    templateData.primaryCategoryId || templateData.categoryId || undefined;
  const extras = templateData.extraCategoryIds ?? [];

  if (extras.length > 2) {
    toast.error('A template can have at most 3 categories (1 primary + 2 extras).');
    return null;
  }
  if (primaryCategoryId && extras.includes(primaryCategoryId)) {
    toast.error('The primary category cannot also be listed as an extra.');
    return null;
  }

  if (!templateData.kind) {
    toast.error('Pick a template kind (image / video / image set).');
    return null;
  }
  // `generation` / `output` are always populated by the page on init,
  // so a missing one here means something dropped the field — bail
  // loudly instead of letting the server return a confusing 400.
  if (!templateData.generation) {
    toast.error('Generation pipeline is missing. Reload the page and try again.');
    return null;
  }
  if (!templateData.output) {
    toast.error('Output settings are missing. Reload the page and try again.');
    return null;
  }

  if (intent === 'publish') {
    if (!primaryCategoryId) {
      toast.error('Pick a primary category before publishing.');
      return null;
    }
    if (!templateData.coverMedia) {
      toast.error('Upload a cover image before publishing.');
      return null;
    }
    const stageCount = templateData.generation.stages?.length ?? 0;
    if (stageCount === 0) {
      toast.error('Add at least one generation stage before publishing.');
      return null;
    }
  }

  return {
    title: templateData.title.trim(),
    slug: templateData.slug?.trim() || undefined,
    description: templateData.description ?? '',
    primaryCategoryId,
    extraCategoryIds: extras,
    kind: templateData.kind,
    featured: templateData.featured ?? false,
    coverMedia: templateData.coverMedia ?? null,
    previewVideo: templateData.previewVideo ?? null,
    gallery: templateData.gallery ?? [],
    userInputs: templateData.userInputs ?? [],
    userCanChooseAspectRatio: templateData.userCanChooseAspectRatio ?? false,
    defaultAspectRatio: templateData.defaultAspectRatio ?? null,
    generation: templateData.generation,
    output: templateData.output,
    costCredits: templateData.costCredits,
    sortOrder: templateData.sortOrder,
  };
}

export default function TemplateEditorPage() {
  const router = useRouter();
  const params = useParams();
  const templateId = params.id as string;
  const isNew = templateId === 'new';
  const { getToken } = useAuth();

  // `getToken` from `useAuth()` returns a function whose identity is
  // stable across renders, but TypeScript-wise it returns
  // `Promise<string | null>` — which already matches our
  // `TokenGetter` signature. We memoise it for the tabs that depend
  // on referential equality (image-upload effects).
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);

  const {
    currentTemplate,
    fetchTemplate,
    createTemplate,
    updateTemplate,
    publishTemplate,
    clearCurrentTemplate,
  } = useTemplatesStore();
  const { categories, fetchCategories } = useCategoriesStore();

  const [templateData, setTemplateData] = useState<Partial<Template>>({});
  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');

  useEffect(() => {
    void fetchCategories();
    if (isNew) {
      // New template — sensible defaults. Cover stays undefined until
      // the admin uploads one (validated at Save).
      setTemplateData({
        title: '',
        description: '',
        kind: 'image',
        status: 'draft',
        featured: false,
        userInputs: [],
        gallery: [],
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
      return;
    }
    setLoadingExisting(true);
    fetchTemplate(templateId, tokenGetter).finally(() => setLoadingExisting(false));

    return () => {
      clearCurrentTemplate();
    };
  }, [templateId, isNew, fetchCategories, fetchTemplate, tokenGetter, clearCurrentTemplate]);

  useEffect(() => {
    if (currentTemplate && !isNew) {
      setTemplateData(currentTemplate);
    }
  }, [currentTemplate, isNew]);

  const handleDataChange = (data: Partial<Template>) => {
    setTemplateData((prev) => ({ ...prev, ...data }));
  };

  const handleSave = async () => {
    // Save uses draft-grade validation regardless of `isNew`. A draft
    // can legitimately have no cover and no category; the server will
    // store nulls. Publishing is the only moment we enforce the full
    // set of requirements.
    const payload = buildFormPayload(templateData, { intent: 'draft' });
    if (!payload) return;
    setSaving(true);
    try {
      if (isNew) {
        const created = await createTemplate(payload, tokenGetter);
        toast.success('Template created');
        router.push(`/admin/templates/${created.id}`);
      } else {
        await updateTemplate(templateId, payload, tokenGetter);
        toast.success('Saved');
      }
    } catch (err) {
      // The store has already set `error`; surface the message.
      toast.error(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (isNew) return;
    // Publish performs an implicit save first so the snapshot in
    // `template_versions` matches the admin's current draft. Use the
    // strict variant so we catch missing cover/category/stages
    // client-side instead of bouncing off the server's 400.
    const payload = buildFormPayload(templateData, { intent: 'publish' });
    if (!payload) return;
    setSaving(true);
    try {
      await updateTemplate(templateId, payload, tokenGetter);
      await publishTemplate(templateId, tokenGetter);
      toast.success('Template published');
      router.push('/admin/templates');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setSaving(false);
    }
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    published: 'bg-primary-green/10 text-primary-green border-primary-green/20',
    archived: 'bg-muted text-muted-foreground',
  };

  if (loadingExisting && !templateData.title) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground mt-4">Loading template…</p>
      </div>
    );
  }

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
            {isNew ? 'Create Draft' : 'Save'}
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

      {/* Live cost breakdown — auto-computed from current pipeline stages.
          Mirrors the server-side rule in apps/api/src/lib/template-cost.ts. */}
      <TemplateCostSummary
        stages={templateData.generation?.stages}
        getToken={tokenGetter}
      />

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
          {/* Playground does not need a saved template id — it
              POSTs the in-memory pipeline to `/api/generate` (the
              admin's local Next.js route), so admins can iterate on
              a brand-new template before it's ever persisted. The
              tab's own empty-state UI guides the admin to add stages
              and required inputs. */}
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
              getToken={tokenGetter}
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
              getToken={tokenGetter}
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
