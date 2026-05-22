'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { TemplateCard } from '@/components/templates/template-card';
import { TemplatesFilters } from '@/components/templates/templates-filters';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTemplatesStore } from '@/lib/stores/templates-store';
import { useCategoriesStore } from '@/lib/stores/categories-store';
import { ApiError } from '@/lib/api';
import type { Template } from '@clickfy/types';
import { Plus, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function TemplatesPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);

  const {
    templates,
    loading,
    filters,
    fetchTemplates,
    archiveTemplate,
    restoreTemplate,
    purgeTemplate,
    duplicateTemplate,
    publishTemplate,
    unpublishTemplate,
    setFilters,
  } = useTemplatesStore();

  const { categories, fetchCategories } = useCategoriesStore();

  // The dialog distinguishes archive (soft, default) from purge (hard,
  // gated). Both share the same `selectedTemplate`; `dialogMode`
  // decides which copy + action button we render.
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [dialogMode, setDialogMode] = useState<'archive' | 'purge'>('archive');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Refetch when the include-archived toggle or status filter
  // changes — those translate to different server queries (the rest
  // of the filters are applied client-side from the same payload).
  useEffect(() => {
    void fetchTemplates(tokenGetter);
    void fetchCategories();
  }, [fetchTemplates, fetchCategories, tokenGetter, filters.includeArchived, filters.status]);

  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const matchesSearch =
        template.title.toLowerCase().includes(filters.search.toLowerCase()) ||
        template.description.toLowerCase().includes(filters.search.toLowerCase());
      // Match against the full membership set — a template surfaces
      // under any of its categories. `categoryIds` is set by the API
      // response; fall back to legacy `categoryId` for safety during
      // a deploy transition.
      const matchesCategory =
        !filters.category ||
        (template.categoryIds?.length
          ? template.categoryIds.includes(filters.category)
          : template.categoryId === filters.category);
      const matchesStatus = !filters.status || template.status === filters.status;
      const matchesKind = !filters.kind || template.kind === filters.kind;

      return matchesSearch && matchesCategory && matchesStatus && matchesKind;
    });
  }, [templates, filters]);

  const handleEdit = (template: Template) => {
    router.push(`/admin/templates/${template.id}`);
  };

  const handleDuplicate = async (template: Template) => {
    try {
      const cloned = await duplicateTemplate(template.id, tokenGetter);
      toast.success('Template duplicated');
      router.push(`/admin/templates/${cloned.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to duplicate template');
    }
  };

  const handlePublish = async (template: Template) => {
    try {
      if (template.status === 'published') {
        await unpublishTemplate(template.id, tokenGetter);
        toast.success('Template unpublished');
      } else {
        await publishTemplate(template.id, tokenGetter);
        toast.success('Template published');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update template status');
    }
  };

  const handleConfirmDialog = async () => {
    if (!selectedTemplate) return;
    try {
      if (dialogMode === 'archive') {
        await archiveTemplate(selectedTemplate.id, tokenGetter);
        toast.success('Template archived', {
          description:
            'Hidden from the catalog. Existing user generations are preserved.',
        });
      } else {
        await purgeTemplate(selectedTemplate.id, tokenGetter);
        toast.success('Template permanently deleted');
      }
      setIsDialogOpen(false);
      setSelectedTemplate(null);
    } catch (err) {
      // The purge endpoint returns 409 `template_in_use` when any job
      // has ever referenced the template. Catch that specific case
      // and offer the archive fallback inline so the admin doesn't
      // have to close the dialog and start over.
      if (
        dialogMode === 'purge' &&
        err instanceof ApiError &&
        err.code === 'template_in_use'
      ) {
        toast.error('Cannot delete', {
          description:
            'This template has been used to create generations. Switching to Archive instead — confirm to hide it from the catalog without touching user data.',
        });
        setDialogMode('archive');
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const openArchiveDialog = (template: Template) => {
    setSelectedTemplate(template);
    setDialogMode('archive');
    setIsDialogOpen(true);
  };

  const openPurgeDialog = (template: Template) => {
    setSelectedTemplate(template);
    setDialogMode('purge');
    setIsDialogOpen(true);
  };

  const handleRestore = async (template: Template) => {
    try {
      await restoreTemplate(template.id, tokenGetter);
      toast.success('Template restored as draft');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore template');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
          <p className="text-muted-foreground mt-1">
            Manage your AI generation templates
          </p>
        </div>
        <Button onClick={() => router.push('/admin/templates/new')}>
          <Plus className="h-4 w-4 mr-2" />
          Create Template
        </Button>
      </div>

      {/* Filters */}
      <TemplatesFilters
        search={filters.search}
        category={filters.category}
        status={filters.status}
        kind={filters.kind}
        includeArchived={filters.includeArchived}
        categories={categories}
        onSearchChange={(value) => setFilters({ search: value })}
        onCategoryChange={(value) => setFilters({ category: value })}
        onStatusChange={(value) => setFilters({ status: value })}
        onKindChange={(value) => setFilters({ kind: value })}
        onIncludeArchivedChange={(value) => setFilters({ includeArchived: value })}
      />

      {/* Templates Grid */}
      {loading && templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground mt-4">Loading templates...</p>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 bg-card rounded-lg border">
          <FileText className="h-16 w-16 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            {filters.search || filters.category || filters.status || filters.kind
              ? 'No templates match your filters'
              : 'No templates yet'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {filters.search || filters.category || filters.status || filters.kind
              ? 'Try adjusting your filters'
              : 'Create your first template to get started'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onEdit={handleEdit}
              onArchive={openArchiveDialog}
              onRestore={handleRestore}
              onPurge={openPurgeDialog}
              onDuplicate={handleDuplicate}
              onPublish={handlePublish}
            />
          ))}
        </div>
      )}

      {/* Archive / Purge Confirmation Dialog
       *
       * Same component, two modes. Archive is the safe default that
       * preserves user-owned generations; Purge is the rare hard
       * delete the API gates with a "no jobs reference this row"
       * check (returns 409 → we fall back to archive copy in the
       * handler above). */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setSelectedTemplate(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            {dialogMode === 'archive' ? (
              <>
                <DialogTitle>Archive Template</DialogTitle>
                <DialogDescription>
                  Hide <strong>{selectedTemplate?.title}</strong> from the
                  catalog? Existing user generations and library entries will
                  keep working — only new generations against this template are
                  blocked. You can restore it from the “Include archived”
                  filter at any time.
                </DialogDescription>
              </>
            ) : (
              <>
                <DialogTitle>Permanently Delete Template</DialogTitle>
                <DialogDescription>
                  Permanently remove <strong>{selectedTemplate?.title}</strong>?
                  This is only possible when no user has ever generated from
                  it. If anyone has, we’ll archive it instead (you’ll see a
                  message). Use Archive for any template that has been used —
                  it preserves user data.
                </DialogDescription>
              </>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false);
                setSelectedTemplate(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={dialogMode === 'archive' ? 'default' : 'destructive'}
              onClick={handleConfirmDialog}
            >
              {dialogMode === 'archive' ? 'Archive Template' : 'Delete Permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
