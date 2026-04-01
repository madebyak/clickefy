/**
 * Category data model
 * Used for organizing templates in the mobile app
 * 
 * TODO: [Database Integration] Add MongoDB _id field when connecting to database
 * TODO: [Multi-tenant] Add tenantId field if multi-tenancy is needed later
 */

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null; // For sub-categories (nested structure)
  order: number; // For drag-and-drop sorting
  icon?: string; // Optional icon identifier
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
