'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { CategoryTree } from '@/components/categories/category-tree';
import { CategoryForm } from '@/components/categories/category-form';
import { Modal } from '@/components/ui/modal';
import { Toast } from '@/components/ui/toast';
import { useCategoriesStore } from '@/lib/stores/categories-store';
import { Category } from '@/lib/types/category';

/**
 * Categories Management Page
 * Full CRUD operations for categories and sub-categories
 * 
 * Features:
 * - Tree view with expand/collapse
 * - Create category/sub-category
 * - Edit category
 * - Delete category (with validation)
 * - Drag-and-drop reordering (TODO)
 */
export default function CategoriesPage() {
  const { categories, loading, error, fetchCategories, createCategory, updateCategory, deleteCategory } = useCategoriesStore();
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleCreate = async (data: any) => {
    try {
      await createCategory(data);
      setIsCreateModalOpen(false);
      setToast({ message: 'Category created successfully', type: 'success' });
    } catch (error) {
      setToast({ message: 'Failed to create category', type: 'error' });
    }
  };

  const handleEdit = async (data: any) => {
    if (!selectedCategory) return;
    
    try {
      await updateCategory(selectedCategory.id, data);
      setIsEditModalOpen(false);
      setSelectedCategory(null);
      setToast({ message: 'Category updated successfully', type: 'success' });
    } catch (error) {
      setToast({ message: 'Failed to update category', type: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!selectedCategory) return;
    
    try {
      await deleteCategory(selectedCategory.id);
      setIsDeleteModalOpen(false);
      setSelectedCategory(null);
      setToast({ message: 'Category deleted successfully', type: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete category';
      setToast({ message, type: 'error' });
    }
  };

  const openEditModal = (category: Category) => {
    setSelectedCategory(category);
    setIsEditModalOpen(true);
  };

  const openDeleteModal = (category: Category) => {
    setSelectedCategory(category);
    setIsDeleteModalOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Organize your templates with categories and sub-categories"
        action={{
          label: 'Create Category',
          onClick: () => setIsCreateModalOpen(true),
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          ),
        }}
      />

      {/* Category Tree */}
      <div className="bg-surface rounded-lg p-6">
        {loading && categories.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-purple"></div>
            <p className="text-text-secondary mt-4">Loading categories...</p>
          </div>
        ) : (
          <CategoryTree
            categories={categories}
            onEdit={openEditModal}
            onDelete={openDeleteModal}
          />
        )}
      </div>

      {/* Create Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create Category"
        size="md"
      >
        <CategoryForm
          categories={categories}
          onSubmit={handleCreate}
          onCancel={() => setIsCreateModalOpen(false)}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedCategory(null);
        }}
        title="Edit Category"
        size="md"
      >
        {selectedCategory && (
          <CategoryForm
            category={selectedCategory}
            categories={categories}
            onSubmit={handleEdit}
            onCancel={() => {
              setIsEditModalOpen(false);
              setSelectedCategory(null);
            }}
          />
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setSelectedCategory(null);
        }}
        title="Delete Category"
        size="sm"
      >
        {selectedCategory && (
          <div>
            <p className="text-text-primary mb-4">
              Are you sure you want to delete <strong>{selectedCategory.name}</strong>?
            </p>
            <p className="text-sm text-text-secondary mb-6">
              This action cannot be undone. Templates in this category will need to be reassigned.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setSelectedCategory(null);
                }}
                className="px-4 h-10 rounded-lg bg-surface-elevated text-text-primary hover:bg-[#252532] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 h-10 rounded-lg bg-error text-white hover:bg-red-600 transition-colors"
              >
                Delete Category
              </button>
            </div>
          </div>
        )}
      </Modal>

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
