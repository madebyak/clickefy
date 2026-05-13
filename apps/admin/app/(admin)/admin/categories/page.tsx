'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CategoryTree } from '@/components/categories/category-tree';
import { CategoryForm } from '@/components/categories/category-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCategoriesStore } from '@/lib/stores/categories-store';
import type { Category, CategoryFormData } from '@clickfy/types';
import { Plus, Loader2, FolderTree } from 'lucide-react';
import { toast } from 'sonner';

export default function CategoriesPage() {
  const { getToken } = useAuth();
  const {
    categories,
    loading,
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
  } = useCategoriesStore();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleCreate = async (data: CategoryFormData) => {
    try {
      await createCategory(data, getToken);
      setIsCreateDialogOpen(false);
      toast.success('Category created');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create category';
      toast.error(message);
    }
  };

  const handleEdit = async (data: CategoryFormData) => {
    if (!selectedCategory) return;

    try {
      await updateCategory(selectedCategory.id, data, getToken);
      setIsEditDialogOpen(false);
      setSelectedCategory(null);
      toast.success('Category updated');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update category';
      toast.error(message);
    }
  };

  const handleDelete = async () => {
    if (!selectedCategory) return;

    try {
      await deleteCategory(selectedCategory.id, getToken);
      setIsDeleteDialogOpen(false);
      setSelectedCategory(null);
      toast.success('Category deleted');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete category';
      toast.error(message);
    }
  };

  const openEditDialog = (category: Category) => {
    setSelectedCategory(category);
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (category: Category) => {
    setSelectedCategory(category);
    setIsDeleteDialogOpen(true);
  };

  const handleReorder = async (newRootOrder: Category[]) => {
    // The tree only reorders top-level rows; merge them with their
    // children (children stay in their existing relative order) so the
    // store's full categories list remains consistent.
    const childrenByParent = new Map<string, Category[]>();
    for (const c of categories) {
      if (!c.parentId) continue;
      const arr = childrenByParent.get(c.parentId) ?? [];
      arr.push(c);
      childrenByParent.set(c.parentId, arr);
    }
    const merged: Category[] = [];
    for (const root of newRootOrder) {
      merged.push(root);
      const kids = childrenByParent.get(root.id);
      if (kids) merged.push(...kids);
    }
    try {
      await reorderCategories(merged, getToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reorder categories';
      toast.error(message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Categories</h1>
          <p className="text-muted-foreground mt-1">
            Organize your templates with categories and sub-categories
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Category
        </Button>
      </div>

      {/* Category Tree */}
      <div className="bg-card rounded-lg border p-6">
        {loading && categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground mt-4">Loading categories...</p>
          </div>
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <FolderTree className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No categories yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first category to organize templates</p>
          </div>
        ) : (
          <CategoryTree
            categories={categories}
            onEdit={openEditDialog}
            onDelete={openDeleteDialog}
            onReorder={handleReorder}
          />
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Category</DialogTitle>
            <DialogDescription>
              Add a new category to organize your templates.
            </DialogDescription>
          </DialogHeader>
          <CategoryForm
            categories={categories}
            onSubmit={handleCreate}
            onCancel={() => setIsCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          setIsEditDialogOpen(open);
          if (!open) setSelectedCategory(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription>
              Update category details.
            </DialogDescription>
          </DialogHeader>
          {selectedCategory && (
            <CategoryForm
              category={selectedCategory}
              categories={categories}
              onSubmit={handleEdit}
              onCancel={() => {
                setIsEditDialogOpen(false);
                setSelectedCategory(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setSelectedCategory(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Category</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{selectedCategory?.name}</strong>?
              This action cannot be undone. Templates in this category will need to be reassigned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDeleteDialogOpen(false);
                setSelectedCategory(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
