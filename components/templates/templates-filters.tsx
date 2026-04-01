'use client';

import { Input } from '@/components/ui/input';
import { Dropdown } from '@/components/ui/dropdown';
import { Category } from '@/lib/types/category';

interface TemplatesFiltersProps {
  search: string;
  category: string;
  status: string;
  type: string;
  categories: Category[];
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onTypeChange: (value: string) => void;
}

/**
 * Templates filters component
 * Search, category, status, and type filters
 */
export function TemplatesFilters({
  search,
  category,
  status,
  type,
  categories,
  onSearchChange,
  onCategoryChange,
  onStatusChange,
  onTypeChange,
}: TemplatesFiltersProps) {
  const categoryOptions = [
    { value: '', label: 'All Categories' },
    ...categories.map(cat => ({ value: cat.id, label: cat.name })),
  ];

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'draft', label: 'Draft' },
    { value: 'published', label: 'Published' },
    { value: 'archived', label: 'Archived' },
  ];

  const typeOptions = [
    { value: '', label: 'All Types' },
    { value: 'image', label: 'Image Only' },
    { value: 'video', label: 'Video Only' },
    { value: 'image-then-video', label: 'Image + Video' },
  ];

  return (
    <div className="bg-surface rounded-lg p-4 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <Dropdown
          options={categoryOptions}
          value={category}
          onChange={onCategoryChange}
        />
        <div className="grid grid-cols-2 gap-4">
          <Dropdown
            options={statusOptions}
            value={status}
            onChange={onStatusChange}
          />
          <Dropdown
            options={typeOptions}
            value={type}
            onChange={onTypeChange}
          />
        </div>
      </div>
    </div>
  );
}
