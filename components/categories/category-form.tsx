'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dropdown } from '@/components/ui/dropdown';
import { Button } from '@/components/ui/button';
import { Category, CategoryFormData } from '@/lib/types/category';

interface CategoryFormProps {
  category?: Category;
  categories: Category[];
  onSubmit: (data: CategoryFormData) => Promise<void>;
  onCancel: () => void;
}

/**
 * Category form component
 * Used for both creating and editing categories
 */
export function CategoryForm({ category, categories, onSubmit, onCancel }: CategoryFormProps) {
  const [formData, setFormData] = useState<CategoryFormData>({
    name: category?.name || '',
    parentId: category?.parentId || null,
    icon: category?.icon || '',
    description: category?.description || '',
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Get parent category options (exclude current category and its children)
  const parentOptions = [
    { value: '', label: 'None (Top Level)' },
    ...categories
      .filter(cat => {
        // Exclude current category
        if (category && cat.id === category.id) return false;
        // Exclude children of current category
        if (category && cat.parentId === category.id) return false;
        // Only show top-level categories as parent options
        return cat.parentId === null;
      })
      .map(cat => ({ value: cat.id, label: cat.name })),
  ];

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Category name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) return;

    setLoading(true);
    try {
      await onSubmit({
        ...formData,
        parentId: formData.parentId || null,
      });
    } catch (error) {
      console.error('Failed to save category:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Input
        label="Category Name"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        placeholder="e.g., Skincare, Beauty, Food & Beverage"
        required
        error={errors.name}
      />

      <Dropdown
        label="Parent Category"
        options={parentOptions}
        value={formData.parentId || ''}
        onChange={(value) => setFormData({ ...formData, parentId: value || null })}
        helperText="Select a parent category to create a sub-category"
      />

      <Input
        label="Icon"
        value={formData.icon || ''}
        onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
        placeholder="e.g., droplet, coffee, pill"
        helperText="Optional icon identifier"
      />

      <Textarea
        label="Description"
        value={formData.description || ''}
        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        placeholder="Brief description of this category..."
        helperText="Optional description for internal use"
      />

      <div className="flex gap-3 justify-end pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {category ? 'Update Category' : 'Create Category'}
        </Button>
      </div>
    </form>
  );
}
