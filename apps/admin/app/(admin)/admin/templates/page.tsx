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
    deleteTemplate,
    duplicateTemplate,
    publishTemplate,
    unpublishTemplate,
    setFilters,
  } = useTemplatesStore();

  const { categories, fetchCategories } = useCategoriesStore();

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  useEffect(() => {
    void fetchTemplates(tokenGetter);
    void fetchCategories();
  }, [fetchTemplates, fetchCategories, tokenGetter]);

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

  const handleDelete = async () => {
    if (!selectedTemplate) return;
    try {
      await deleteTemplate(selectedTemplate.id, tokenGetter);
      setIsDeleteDialogOpen(false);
      setSelectedTemplate(null);
      toast.success('Template deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

  const openDeleteDialog = (template: Template) => {
    setSelectedTemplate(template);
    setIsDeleteDialogOpen(true);
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
        categories={categories}
        onSearchChange={(value) => setFilters({ search: value })}
        onCategoryChange={(value) => setFilters({ category: value })}
        onStatusChange={(value) => setFilters({ status: value })}
        onKindChange={(value) => setFilters({ kind: value })}
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
              onDelete={openDeleteDialog}
              onDuplicate={handleDuplicate}
              onPublish={handlePublish}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setSelectedTemplate(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Template</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <strong>{selectedTemplate?.title}</strong>? This action cannot be
              undone. All template data and settings will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDeleteDialogOpen(false);
                setSelectedTemplate(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
