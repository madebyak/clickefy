import { create } from 'zustand';
import { Category, CategoryFormData } from '@/lib/types/category';
import categoriesData from '@/data/mock/categories.json';

/**
 * Categories store — client-side state for the admin dashboard.
 *
 * Currently backed by mock JSON data (`data/mock/categories.json`).
 *
 * @integration MongoDB — Replace every method body below with API calls:
 *   - fetchCategories    → GET    /api/admin/categories
 *   - createCategory     → POST   /api/admin/categories
 *   - updateCategory     → PATCH  /api/admin/categories/:id
 *   - deleteCategory     → DELETE /api/admin/categories/:id
 *   - reorderCategories  → PATCH  /api/admin/categories/reorder
 *   Remove the `setTimeout` delays — they only simulate network latency.
 *   Add optimistic UI updates for a snappier admin experience.
 */

interface CategoriesStore {
  categories: Category[];
  loading: boolean;
  error: string | null;

  fetchCategories: () => Promise<void>;
  createCategory: (data: CategoryFormData) => Promise<void>;
  updateCategory: (id: string, data: Partial<CategoryFormData>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  reorderCategories: (reorderedCategories: Category[]) => Promise<void>;
}

export const useCategoriesStore = create<CategoriesStore>((set, get) => ({
  categories: [],
  loading: false,
  error: null,

  fetchCategories: async () => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 300));

      const categories = categoriesData.map(cat => ({
        ...cat,
        createdAt: new Date(cat.createdAt),
        updatedAt: new Date(cat.updatedAt),
      }));
      
      set({ categories, loading: false });
    } catch {
      set({ error: 'Failed to fetch categories', loading: false });
    }
  },

  createCategory: async (data: CategoryFormData) => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      const { categories } = get();
      const newCategory: Category = {
        id: `cat-${Date.now()}`,
        name: data.name,
        slug: data.name.toLowerCase().replace(/\s+/g, '-'),
        parentId: data.parentId,
        order: categories.filter(c => c.parentId === data.parentId).length + 1,
        icon: data.icon,
        description: data.description,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      set({ categories: [...categories, newCategory], loading: false });
    } catch (error) {
      set({ error: 'Failed to create category', loading: false });
      throw error;
    }
  },

  updateCategory: async (id: string, data: Partial<CategoryFormData>) => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { categories } = get();
      const updatedCategories = categories.map(cat =>
        cat.id === id
          ? {
              ...cat,
              ...data,
              slug: data.name ? data.name.toLowerCase().replace(/\s+/g, '-') : cat.slug,
              updatedAt: new Date(),
            }
          : cat
      );
      
      set({ categories: updatedCategories, loading: false });
    } catch (error) {
      set({ error: 'Failed to update category', loading: false });
      throw error;
    }
  },

  deleteCategory: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      const { categories } = get();
      const hasChildren = categories.some(cat => cat.parentId === id);
      if (hasChildren) {
        throw new Error('Cannot delete category with sub-categories');
      }
      
      const filteredCategories = categories.filter(cat => cat.id !== id);
      set({ categories: filteredCategories, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete category';
      set({ error: message, loading: false });
      throw error;
    }
  },

  reorderCategories: async (reorderedCategories: Category[]) => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 300));

      const categoriesWithOrder = reorderedCategories.map((cat, index) => ({
        ...cat,
        order: index + 1,
        updatedAt: new Date(),
      }));
      
      set({ categories: categoriesWithOrder, loading: false });
    } catch (error) {
      set({ error: 'Failed to reorder categories', loading: false });
      throw error;
    }
  },
}));
