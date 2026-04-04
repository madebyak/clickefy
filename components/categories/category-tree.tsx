'use client';

import { useState } from 'react';
import { Category } from '@/lib/types/category';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ChevronRight,
  Pencil,
  Trash2,
  FolderTree,
  Droplet,
  Coffee,
  Pill,
  Shirt,
  Smartphone,
  Gem,
  Sparkles,
  ShoppingBag,
  Camera,
  Palette,
  Utensils,
  Heart,
  Star,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  droplet: Droplet,
  coffee: Coffee,
  pill: Pill,
  shirt: Shirt,
  smartphone: Smartphone,
  gem: Gem,
  sparkles: Sparkles,
  'shopping-bag': ShoppingBag,
  camera: Camera,
  palette: Palette,
  utensils: Utensils,
  heart: Heart,
  star: Star,
  zap: Zap,
};

interface CategoryTreeProps {
  categories: Category[];
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
}

/**
 * Category tree component
 * Displays categories in a hierarchical tree structure
 */
export function CategoryTree({ categories, onEdit, onDelete }: CategoryTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    const newSet = new Set(expandedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedIds(newSet);
  };

  const rootCategories = categories.filter((cat) => !cat.parentId);

  const getChildren = (parentId: string) => {
    return categories.filter((cat) => cat.parentId === parentId);
  };

  const renderCategory = (category: Category, depth: number = 0) => {
    const children = getChildren(category.id);
    const isExpanded = expandedIds.has(category.id);
    const hasChildren = children.length > 0;

    return (
      <div key={category.id}>
        <div
          className={cn(
            'flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors group',
            depth > 0 && 'ml-6'
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => hasChildren && toggleExpand(category.id)}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded transition-colors',
                hasChildren
                  ? 'hover:bg-muted cursor-pointer'
                  : 'cursor-default opacity-0'
              )}
            >
              <ChevronRight
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform',
                  isExpanded && 'rotate-90'
                )}
              />
            </button>

            {category.icon && (() => {
              const IconComponent = iconMap[category.icon];
              return IconComponent ? (
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 shrink-0">
                  <IconComponent className="h-4 w-4 text-primary" />
                </div>
              ) : (
                <span className="text-lg shrink-0">{category.icon}</span>
              );
            })()}

            <div className="min-w-0">
              <p className="font-medium truncate">{category.name}</p>
              {category.description && (
                <p className="text-xs text-muted-foreground truncate">
                  {category.description}
                </p>
              )}
            </div>

            {hasChildren && (
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 shrink-0">
                {children.length}
              </span>
            )}
          </div>

          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button size="icon-xs" variant="ghost" onClick={() => onEdit(category)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(category)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {isExpanded && hasChildren && (
          <div className="border-l border-border ml-6">
            {children.map((child) => renderCategory(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (rootCategories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <FolderTree className="h-16 w-16 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No categories yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Create your first category to organize templates
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {rootCategories.map((category) => renderCategory(category))}
    </div>
  );
}
