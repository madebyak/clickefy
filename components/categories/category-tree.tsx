'use client';

import { useState } from 'react';
import { Category } from '@/lib/types/category';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

interface CategoryTreeProps {
  categories: Category[];
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
}

/**
 * Category tree component
 * Displays categories in a hierarchical tree structure
 * 
 * TODO: [Drag & Drop] Implement drag-and-drop reordering
 */
export function CategoryTree({ categories, onEdit, onDelete }: CategoryTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Build tree structure
  const buildTree = (parentId: string | null = null): Category[] => {
    return categories
      .filter(cat => cat.parentId === parentId)
      .sort((a, b) => a.order - b.order);
  };

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  const renderCategory = (category: Category, level: number = 0) => {
    const children = buildTree(category.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(category.id);

    return (
      <div key={category.id}>
        <div
          className={cn(
            'flex items-center gap-3 p-3 rounded-lg hover:bg-surface-elevated transition-colors group',
            level > 0 && 'ml-8'
          )}
        >
          {/* Expand/Collapse Button */}
          {hasChildren ? (
            <button
              onClick={() => toggleExpand(category.id)}
              className="w-6 h-6 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
            >
              <svg
                className={cn('w-4 h-4 transition-transform', isExpanded && 'rotate-90')}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <div className="w-6" />
          )}

          {/* Icon */}
          {category.icon && (
            <div className="w-8 h-8 rounded-lg bg-primary-purple/10 flex items-center justify-center text-primary-purple">
              <span className="text-sm">{category.icon}</span>
            </div>
          )}

          {/* Category Info */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-text-primary">{category.name}</p>
            {category.description && (
              <p className="text-sm text-text-secondary truncate">{category.description}</p>
            )}
          </div>

          {/* Badge for sub-category count */}
          {hasChildren && (
            <span className="px-2 py-1 text-xs font-medium bg-surface-elevated text-text-secondary rounded">
              {children.length} sub-{children.length === 1 ? 'category' : 'categories'}
            </span>
          )}

          {/* Actions */}
          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEdit(category)}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              }
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => onDelete(category)}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              }
            >
              Delete
            </Button>
          </div>
        </div>

        {/* Render children */}
        {hasChildren && isExpanded && (
          <div className="mt-1">
            {children.map(child => renderCategory(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const topLevelCategories = buildTree(null);

  if (topLevelCategories.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="w-16 h-16 mx-auto text-text-secondary mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        <p className="text-text-secondary">No categories yet</p>
        <p className="text-sm text-text-secondary mt-1">Create your first category to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {topLevelCategories.map(category => renderCategory(category))}
    </div>
  );
}
