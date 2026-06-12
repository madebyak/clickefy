'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
    loadingMore,
    total,
    hasMore,
    filters,
    fetchTemplates,
    loadMore,
    archiveTemplate,
    restoreTemplate,
    purgeTemplate,
    duplicateTemplate,
    publishTemplate,
    unpublishTemplate,
    setFilters,
  } = useTemplatesStore();

  const { categories, fetchCategories } = useCategoriesStore();

  // The search box updates this local state on every keystroke for a
  // snappy input, then debounces the value into the store (which is
  // what actually triggers a server fetch). Keeps us from firing a
  // request per character.
  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    const handle = setTimeout(() => {
      // Avoid a redundant fetch when the debounced value already
      // matches what's in the store (e.g. on mount).
      if (searchInput !== filters.search) {
        setFilters({ search: searchInput });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput, filters.search, setFilters]);

  // The dialog distinguishes archive (soft, default) from purge (hard,
  // gated). Both share the same `selectedTemplate`; `dialogMode`
  // decides which copy + action button we render.
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [dialogMode, setDialogMode] = useState<'archive' | 'purge'>('archive');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Categories only need loading once (they back the filter dropdown).
  useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);

  // Every server-side filter, search term and sort change refetches
  // page one. Search/category/status/kind/sort all run in the API now
  // (no client-side filtering), so the grid renders exactly what the
  // server returns for the current query.
  useEffect(() => {
    void fetchTemplates(tokenGetter);
  }, [
    fetchTemplates,
    tokenGetter,
    filters.search,
    filters.category,
    filters.status,
    filters.kind,
    filters.sort,
    filters.includeArchived,
  ]);

  const hasActiveFilters = Boolean(
    filters.search || filters.category || filters.status || filters.kind,
  );

  // Infinite scroll: auto-fetch the next page when this sentinel scrolls
  // into view. The `rootMargin` pre-fetches ~600px before the sentinel
  // is actually visible so the next rows are usually ready by the time
  // the admin reaches them. `loadMore` self-guards against overlapping
  // requests, so re-observing after each page lands is safe. We keep a
  // manual "Load more" button below too — a fallback for keyboard users
  // and the rare case the observer doesn't fire.
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore(tokenGetter);
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore, tokenGetter, templates.length]);

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
        search={searchInput}
        category={filters.category}
        status={filters.status}
        kind={filters.kind}
        sort={filters.sort}
        includeArchived={filters.includeArchived}
        categories={categories}
        onSearchChange={setSearchInput}
        onCategoryChange={(value) => setFilters({ category: value })}
        onStatusChange={(value) => setFilters({ status: value })}
        onKindChange={(value) => setFilters({ kind: value })}
        onSortChange={(value) => setFilters({ sort: value as typeof filters.sort })}
        onIncludeArchivedChange={(value) => setFilters({ includeArchived: value })}
      />

      {/* Templates Grid */}
      {loading && templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground mt-4">Loading templates...</p>
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 bg-card rounded-lg border">
          <FileText className="h-16 w-16 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            {hasActiveFilters ? 'No templates match your filters' : 'No templates yet'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {hasActiveFilters
              ? 'Try adjusting your filters'
              : 'Create your first template to get started'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {templates.length} of {total} template{total !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => (
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

          {hasMore && (
            // Sentinel: the observer above watches this node and fetches
            // the next page as it nears the viewport. The button is a
            // manual fallback (and shows the in-flight spinner).
            <div ref={loadMoreRef} className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => void loadMore(tokenGetter)}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load more'
                )}
              </Button>
            </div>
          )}
        </>
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
