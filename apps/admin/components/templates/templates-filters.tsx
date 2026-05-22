'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Category } from '@clickfy/types';
import { Archive, Search } from 'lucide-react';

interface TemplatesFiltersProps {
  search: string;
  category: string;
  status: string;
  kind: string;
  /**
   * When true, archived rows are mixed into the listing alongside
   * drafts/published. Independent of the `Archived` chip in the
   * status select — picking that chip always shows only archived,
   * regardless of this toggle.
   */
  includeArchived: boolean;
  categories: Category[];
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onKindChange: (value: string) => void;
  onIncludeArchivedChange: (value: boolean) => void;
}

export function TemplatesFilters({
  search,
  category,
  status,
  kind,
  includeArchived,
  categories,
  onSearchChange,
  onCategoryChange,
  onStatusChange,
  onKindChange,
  onIncludeArchivedChange,
}: TemplatesFiltersProps) {
  // The status select offers `Archived` as a discrete chip too. When
  // it's active there's no point also showing the include-archived
  // toggle — disable it so the UI doesn't imply a contradiction.
  const archivedOnly = status === 'archived';
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

      {/* `value={... ?? ''}` keeps Base UI's Select controlled from the
          first render — coercing `undefined` would flip it to uncontrolled
          and emit a dev warning. The `__all__` sentinel maps back to ''. */}
      <Select value={category || '__all__'} onValueChange={(val) => onCategoryChange(!val || val === '__all__' ? '' : val)}>
        <SelectTrigger className="w-full sm:w-[180px]">
          {/* See basic-info-tab: Base UI's <SelectValue /> renders the raw
              value; map it to the category name (or the sentinel label) here. */}
          <SelectValue placeholder="All Categories">
            {(val) => {
              if (!val || val === '__all__') return 'All Categories';
              if (typeof val !== 'string') return null;
              return categories.find((c) => c.id === val)?.name ?? val;
            }}
          </SelectValue>
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

      <Select value={status || '__all__'} onValueChange={(val) => onStatusChange(!val || val === '__all__' ? '' : val)}>
        <SelectTrigger className="w-full sm:w-[140px]">
          <SelectValue placeholder="All Status">
            {(val) =>
              ({ __all__: 'All Status', draft: 'Draft', published: 'Published', archived: 'Archived' } as const)[
                val as 'draft' | 'published' | 'archived' | '__all__'
              ] ?? 'All Status'
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Status</SelectItem>
          <SelectItem value="draft">Draft</SelectItem>
          <SelectItem value="published">Published</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
        </SelectContent>
      </Select>

      <Select value={kind || '__all__'} onValueChange={(val) => onKindChange(!val || val === '__all__' ? '' : val)}>
        <SelectTrigger className="w-full sm:w-[160px]">
          <SelectValue placeholder="All Kinds">
            {(val) =>
              ({ __all__: 'All Kinds', image: 'Image', video: 'Video', image_set: 'Image set' } as const)[
                val as 'image' | 'video' | 'image_set' | '__all__'
              ] ?? 'All Kinds'
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Kinds</SelectItem>
          <SelectItem value="image">Image</SelectItem>
          <SelectItem value="video">Video</SelectItem>
          <SelectItem value="image_set">Image set</SelectItem>
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant={includeArchived ? 'default' : 'outline'}
        onClick={() => onIncludeArchivedChange(!includeArchived)}
        disabled={archivedOnly}
        title={
          archivedOnly
            ? 'Already showing only archived'
            : includeArchived
              ? 'Hide archived from the list'
              : 'Mix archived templates into the list'
        }
        className="w-full sm:w-auto"
      >
        <Archive className="h-4 w-4 mr-2" />
        {includeArchived ? 'Including archived' : 'Include archived'}
      </Button>
    </div>
  );
}
