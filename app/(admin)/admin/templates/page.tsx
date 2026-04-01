'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { TemplateCard } from '@/components/templates/template-card';
import { TemplatesFilters } from '@/components/templates/templates-filters';
import { Modal } from '@/components/ui/modal';
import { Toast } from '@/components/ui/toast';
import { useTemplatesStore } from '@/lib/stores/templates-store';
import { useCategoriesStore } from '@/lib/stores/categories-store';
import { Template } from '@/lib/types/template';

/**
 * Templates List Page
 * Grid view with filters, search, and actions
 * 
 * Features:
 * - Grid layout with template cards
 * - Search by title
 * - Filter by category, status, type
 * - Quick actions: Edit, Duplicate, Publish, Delete
 * - Create new template
 */
export default function TemplatesPage() {
  const router = useRouter();
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
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchTemplates();
    fetchCategories();
  }, [fetchTemplates, fetchCategories]);

  // Filter templates based on current filters
  const filteredTemplates = useMemo(() => {
    return templates.filter(template => {
      const matchesSearch = template.title.toLowerCase().includes(filters.search.toLowerCase()) ||
                           template.description.short.toLowerCase().includes(filters.search.toLowerCase());
      const matchesCategory = !filters.category || template.categoryId === filters.category;
      const matchesStatus = !filters.status || template.status === filters.status;
      const matchesType = !filters.type || template.type === filters.type;
      
      return matchesSearch && matchesCategory && matchesStatus && matchesType;
    });
  }, [templates, filters]);

  const handleCreateTemplate = () => {
    router.push('/admin/templates/new');
  };

  const handleEdit = (template: Template) => {
    router.push(`/admin/templates/${template.id}`);
  };

  const handleDuplicate = async (template: Template) => {
    try {
      const newId = await duplicateTemplate(template.id);
      setToast({ message: 'Template duplicated successfully', type: 'success' });
      router.push(`/admin/templates/${newId}`);
    } catch (error) {
      setToast({ message: 'Failed to duplicate template', type: 'error' });
    }
  };

  const handlePublish = async (template: Template) => {
    try {
      if (template.status === 'published') {
        await unpublishTemplate(template.id);
        setToast({ message: 'Template unpublished', type: 'success' });
      } else {
        await publishTemplate(template.id);
        setToast({ message: 'Template published successfully', type: 'success' });
      }
    } catch (error) {
      setToast({ message: 'Failed to update template status', type: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!selectedTemplate) return;
    
    try {
      await deleteTemplate(selectedTemplate.id);
      setIsDeleteModalOpen(false);
      setSelectedTemplate(null);
      setToast({ message: 'Template deleted successfully', type: 'success' });
    } catch (error) {
      setToast({ message: 'Failed to delete template', type: 'error' });
    }
  };

  const openDeleteModal = (template: Template) => {
    setSelectedTemplate(template);
    setIsDeleteModalOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Templates"
        description="Manage your AI generation templates"
        action={{
          label: 'Create Template',
          onClick: handleCreateTemplate,
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          ),
        }}
      />

      {/* Filters */}
      <TemplatesFilters
        search={filters.search}
        category={filters.category}
        status={filters.status}
        type={filters.type}
        categories={categories}
        onSearchChange={(value) => setFilters({ search: value })}
        onCategoryChange={(value) => setFilters({ category: value })}
        onStatusChange={(value) => setFilters({ status: value })}
        onTypeChange={(value) => setFilters({ type: value })}
      />

      {/* Templates Grid */}
      {loading && templates.length === 0 ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-purple"></div>
          <p className="text-text-secondary mt-4">Loading templates...</p>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-lg">
          <svg className="w-16 h-16 mx-auto text-text-secondary mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
          </svg>
          <p className="text-text-secondary">
            {filters.search || filters.category || filters.status || filters.type
              ? 'No templates match your filters'
              : 'No templates yet'}
          </p>
          <p className="text-sm text-text-secondary mt-1">
            {filters.search || filters.category || filters.status || filters.type
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
              onDelete={openDeleteModal}
              onDuplicate={handleDuplicate}
              onPublish={handlePublish}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setSelectedTemplate(null);
        }}
        title="Delete Template"
        size="sm"
      >
        {selectedTemplate && (
          <div>
            <p className="text-text-primary mb-4">
              Are you sure you want to delete <strong>{selectedTemplate.title}</strong>?
            </p>
            <p className="text-sm text-text-secondary mb-6">
              This action cannot be undone. All template data and settings will be permanently deleted.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setSelectedTemplate(null);
                }}
                className="px-4 h-10 rounded-lg bg-surface-elevated text-text-primary hover:bg-[#252532] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 h-10 rounded-lg bg-error text-white hover:bg-red-600 transition-colors"
              >
                Delete Template
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
