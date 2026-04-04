'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Category } from '@/lib/types/category';
import { Search } from 'lucide-react';

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
  return (
    <div className="flex flex-col sm:flex-row gap-3 mb-6">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <Select value={category || undefined} onValueChange={(val) => onCategoryChange(!val || val === '__all__' ? '' : val)}>
        <SelectTrigger className="w-full sm:w-[180px]">
          <SelectValue placeholder="All Categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Categories</SelectItem>
          {categories.map((cat) => (
            <SelectItem key={cat.id} value={cat.id}>
              {cat.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={status || undefined} onValueChange={(val) => onStatusChange(!val || val === '__all__' ? '' : val)}>
        <SelectTrigger className="w-full sm:w-[140px]">
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Status</SelectItem>
          <SelectItem value="draft">Draft</SelectItem>
          <SelectItem value="published">Published</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
        </SelectContent>
      </Select>

      <Select value={type || undefined} onValueChange={(val) => onTypeChange(!val || val === '__all__' ? '' : val)}>
        <SelectTrigger className="w-full sm:w-[160px]">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Types</SelectItem>
          <SelectItem value="image">Image Only</SelectItem>
          <SelectItem value="video">Video Only</SelectItem>
          <SelectItem value="image-then-video">Image + Video</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
