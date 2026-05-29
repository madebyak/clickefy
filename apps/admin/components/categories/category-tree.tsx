'use client';

import { useMemo, useState } from 'react';
import type { Category } from '@clickfy/types';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ChevronRight,
  Pencil,
  Trash2,
  FolderTree,
  GripVertical,
} from 'lucide-react';

interface CategoryTreeProps {
  categories: Category[];
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  /** Called with the new top-level order whenever a root row drag ends. */
  onReorder?: (newOrderTopLevel: Category[]) => void;
  /**
   * Called when an admin reorders the children of a single parent.
   * Receives the parent id + the new order of its direct children.
   * Children DnD is independent per-parent — dropping a Beauty child
   * doesn't change Lifestyle's children ordering.
   */
  onReorderChildren?: (parentId: string, newChildOrder: Category[]) => void;
}

export function CategoryTree({
  categories,
  onEdit,
  onDelete,
  onReorder,
  onReorderChildren,
}: CategoryTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  const rootCategories = useMemo(
    () => categories.filter((c) => !c.parentId),
    [categories],
  );

  const getChildren = (parentId: string) =>
    categories.filter((c) => c.parentId === parentId);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── DnD setup ──────────────────────────────────────────────────
  // PointerSensor with a small activation distance prevents accidental
  // drags from a quick click — feels exactly right for desktop UX.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Resolve whether the dragged item is a root or a child by looking
    // it up in the full categories list. Roots reorder among
    // themselves; children reorder among siblings under the same
    // parent. We never cross-reparent via DnD — moving a category
    // between parents is a Pencil-then-edit flow (less error-prone).
    const dragged = categories.find((c) => c.id === active.id);
    if (!dragged) return;

    if (!dragged.parentId) {
      // Root reorder.
      const oldIndex = rootCategories.findIndex((c) => c.id === active.id);
      const newIndex = rootCategories.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const next = arrayMove(rootCategories, oldIndex, newIndex);
      onReorder?.(next);
      return;
    }

    // Child reorder within a single parent. Reject drops that try to
    // cross parents (over.id sits under a different parent) — the
    // SortableContext scoping below already makes this practically
    // impossible, but defensive checks are cheap.
    const siblings = getChildren(dragged.parentId);
    const oldIndex = siblings.findIndex((c) => c.id === active.id);
    const newIndex = siblings.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(siblings, oldIndex, newIndex);
    onReorderChildren?.(dragged.parentId, next);
  };

  if (rootCategories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <FolderTree className="mb-4 h-16 w-16 text-muted-foreground" />
        <p className="text-muted-foreground">No categories yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create your first category to organize templates
        </p>
      </div>
    );
  }

  // The active row might be a root OR a child — search the full list
  // so the DragOverlay can render either.
  const activeCategory = activeId
    ? categories.find((c) => c.id === activeId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={rootCategories.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-1">
          {rootCategories.map((category) => (
            <SortableRow
              key={category.id}
              category={category}
              isExpanded={expandedIds.has(category.id)}
              onToggleExpand={() => toggleExpand(category.id)}
              onEdit={onEdit}
              onDelete={onDelete}
            >
              {getChildren(category.id)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>

      {/* DragOverlay renders a floating preview that follows the
          cursor. Works for both root and child drags — the overlay
          row is a static snapshot, so its nesting depth is purely
          cosmetic. */}
      <DragOverlay>
        {activeCategory ? (
          <CategoryRow
            category={activeCategory}
            hasChildren={getChildren(activeCategory.id).length > 0}
            childCount={getChildren(activeCategory.id).length}
            isExpanded={false}
            dragging
            nested={Boolean(activeCategory.parentId)}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Sortable row wrapper ─────────────────────────────────────────

interface SortableRowProps {
  category: Category;
  isExpanded: boolean;
  children: Category[];
  onToggleExpand: () => void;
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
}

function SortableRow({
  category,
  isExpanded,
  children,
  onToggleExpand,
  onEdit,
  onDelete,
}: SortableRowProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <CategoryRow
        category={category}
        hasChildren={children.length > 0}
        childCount={children.length}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        onEdit={onEdit}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
      />

      {isExpanded && children.length > 0 && (
        <div className="ml-6 mt-1 border-l border-border pl-2">
          {/* Independent SortableContext per parent — drags in this
              list resolve against `children` only, so a Beauty child
              never tries to swap with a Lifestyle child. */}
          <SortableContext
            items={children.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {children.map((child) => (
              <SortableChildRow
                key={child.id}
                category={child}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </SortableContext>
        </div>
      )}
    </div>
  );
}

// ─── Sortable child row ───────────────────────────────────────────
//
// Children render inside their parent's expanded block and are
// draggable independently. We expose the drag handle the same way
// `SortableRow` does for roots so the UX (grip icon on the left)
// stays consistent between the two levels.

function SortableChildRow({
  category,
  onEdit,
  onDelete,
}: {
  category: Category;
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <CategoryRow
        category={category}
        hasChildren={false}
        childCount={0}
        isExpanded={false}
        onEdit={onEdit}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
        nested
      />
    </div>
  );
}

// ─── Presentational row (used by both sortable + overlay) ─────────

type DragHandleProps = Record<string, unknown>;

interface CategoryRowProps {
  category: Category;
  hasChildren: boolean;
  childCount: number;
  isExpanded: boolean;
  onToggleExpand?: () => void;
  onEdit?: (c: Category) => void;
  onDelete?: (c: Category) => void;
  dragHandleProps?: DragHandleProps;
  dragging?: boolean;
  nested?: boolean;
}

function CategoryRow({
  category,
  hasChildren,
  childCount,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  dragHandleProps,
  dragging,
  nested,
}: CategoryRowProps) {
  const initial = category.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      className={cn(
        'group flex items-center justify-between rounded-lg px-2 py-2 transition-colors',
        dragging
          ? 'border border-border bg-card shadow-lg ring-1 ring-primary/20'
          : 'hover:bg-muted/50',
        nested && 'ml-2',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {/* Drag handle — rendered whenever the caller passed
            sortable props (roots AND children both get it now). */}
        {dragHandleProps ? (
          <button
            type="button"
            {...dragHandleProps}
            className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
            aria-label="Drag to reorder"
            // Keep this button out of the keyboard tab order — keyboard
            // users get the sortable-key navigation via @dnd-kit.
            tabIndex={-1}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : (
          <div className="w-7 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => hasChildren && onToggleExpand?.()}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors',
            hasChildren ? 'cursor-pointer hover:bg-muted' : 'cursor-default opacity-0',
          )}
        >
          <ChevronRight
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              isExpanded && 'rotate-90',
            )}
          />
        </button>

        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-muted">
          {category.iconUrl ? (
             
            <img
              src={category.iconUrl}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
              <span className="text-sm font-semibold">{initial}</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{category.name}</p>
          <p className="truncate text-xs text-muted-foreground">/{category.slug}</p>
        </div>

        {hasChildren && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {childCount}
          </span>
        )}
      </div>

      {(onEdit || onDelete) && !dragging && (
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onEdit && (
            <Button size="icon-xs" variant="ghost" onClick={() => onEdit(category)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button
              size="icon-xs"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(category)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
