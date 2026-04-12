'use client';

import { useEffect, useState } from 'react';
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
import { Category, CategoryFormData } from '@/lib/types/category';
import { Plus, Loader2, FolderTree } from 'lucide-react';
import { toast } from 'sonner';

export default function CategoriesPage() {
  const { categories, loading, fetchCategories, createCategory, updateCategory, deleteCategory } = useCategoriesStore();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleCreate = async (data: CategoryFormData) => {
    try {
      await createCategory(data);
      setIsCreateDialogOpen(false);
      toast.success('Category created successfully');
    } catch {
      toast.error('Failed to create category');
    }
  };

  const handleEdit = async (data: CategoryFormData) => {
    if (!selectedCategory) return;

    try {
      await updateCategory(selectedCategory.id, data);
      setIsEditDialogOpen(false);
      setSelectedCategory(null);
      toast.success('Category updated successfully');
    } catch {
      toast.error('Failed to update category');
    }
  };

  const handleDelete = async () => {
    if (!selectedCategory) return;

    try {
      await deleteCategory(selectedCategory.id);
      setIsDeleteDialogOpen(false);
      setSelectedCategory(null);
      toast.success('Category deleted successfully');
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
