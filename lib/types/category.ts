/**
 * Category — organizes templates in the mobile app's browse screen.
 *
 * @integration MongoDB
 *   - Replace `id` with MongoDB `_id: ObjectId`.
 *   - Add `tenantId: ObjectId` if multi-tenancy is needed.
 *   - Index on `slug` (unique) and `parentId` for tree queries.
 *
 * @integration React Native
 *   - GET /api/categories returns these to populate the mobile category picker.
 *   - `icon` maps to a Lucide icon key — mirror the mapping in `components/categories/category-tree.tsx`.
 */
export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  order: number;
  icon?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryFormData {
  name: string;
  parentId: string | null;
  icon?: string;
  description?: string;
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
  level: number;
}
