import { create } from 'zustand';
import { Template } from '@/lib/types/template';
import templatesData from '@/data/mock/templates.json';

/**
 * Templates store — client-side state for the admin dashboard.
 *
 * Currently backed by mock JSON data (`data/mock/templates.json`).
 *
 * @integration MongoDB — Replace every method body below with API calls:
 *   - fetchTemplates  → GET    /api/admin/templates
 *   - fetchTemplate   → GET    /api/admin/templates/:id
 *   - createTemplate  → POST   /api/admin/templates
 *   - updateTemplate  → PATCH  /api/admin/templates/:id
 *   - deleteTemplate  → DELETE /api/admin/templates/:id
 *   - duplicateTemplate, publishTemplate, unpublishTemplate → PATCH variants
 *   Remove the `setTimeout` delays — they only simulate network latency.
 *   Consider @tanstack/react-query (already in package.json) for caching/revalidation.
 */

interface TemplatesStore {
  templates: Template[];
  currentTemplate: Template | null;
  loading: boolean;
  error: string | null;

  filters: {
    search: string;
    category: string;
    status: string;
    type: string;
  };

  fetchTemplates: () => Promise<void>;
  fetchTemplate: (id: string) => Promise<void>;
  createTemplate: (data: Partial<Template>) => Promise<string>;
  updateTemplate: (id: string, data: Partial<Template>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  duplicateTemplate: (id: string) => Promise<string>;
  publishTemplate: (id: string) => Promise<void>;
  unpublishTemplate: (id: string) => Promise<void>;
  setFilters: (filters: Partial<TemplatesStore['filters']>) => void;
  clearCurrentTemplate: () => void;
}

export const useTemplatesStore = create<TemplatesStore>((set, get) => ({
  templates: [],
  currentTemplate: null,
  loading: false,
  error: null,
  filters: {
    search: '',
    category: '',
    status: '',
    type: '',
  },

  fetchTemplates: async () => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const templates = templatesData.map(tpl => ({
        ...tpl,
        type: tpl.type as Template['type'],
        status: tpl.status as Template['status'],
        createdAt: new Date(tpl.createdAt),
        updatedAt: new Date(tpl.updatedAt),
        lastTested: tpl.lastTested ? new Date(tpl.lastTested) : undefined,
      })) as Template[];
      
      set({ templates, loading: false });
    } catch {
      set({ error: 'Failed to fetch templates', loading: false });
    }
  },

  fetchTemplate: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const { templates } = get();
      const template = templates.find(t => t.id === id);
      
      if (!template) {
        throw new Error('Template not found');
      }
      
      set({ currentTemplate: template, loading: false });
    } catch (error) {
      set({ error: 'Failed to fetch template', loading: false });
      throw error;
    }
  },

  createTemplate: async (data: Partial<Template>) => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { templates } = get();
      const newTemplate: Template = {
        id: `tpl-${Date.now()}`,
        title: data.title || 'Untitled Template',
        slug: (data.title || 'untitled').toLowerCase().replace(/\s+/g, '-'),
        description: data.description || { short: '', long: '' },
        categoryId: data.categoryId || '',
        type: data.type || 'image',
        status: 'draft',
        featured: false,
        coverImage: '',
        previewGallery: [],
        userInputs: data.userInputs || [],
        generation: data.generation || {
          mode: data.type || 'image',
          stages: [],
        },
        output: data.output || {
          type: data.type === 'image-then-video' ? 'both' : (data.type || 'image'),
          count: 1,
          format: data.type === 'video' || data.type === 'image-then-video' ? 'mp4' : 'png',
          allowRegeneration: true,
        },
        userCanChooseAspectRatio: data.userCanChooseAspectRatio ?? false,
        sortOrder: templates.length + 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      set({ templates: [...templates, newTemplate], loading: false });
      return newTemplate.id;
    } catch (error) {
      set({ error: 'Failed to create template', loading: false });
      throw error;
    }
  },

  updateTemplate: async (id: string, data: Partial<Template>) => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { templates } = get();
      const updatedTemplates = templates.map(tpl =>
        tpl.id === id
          ? {
              ...tpl,
              ...data,
              updatedAt: new Date(),
            }
          : tpl
      );
      
      set({ templates: updatedTemplates, loading: false });
    } catch (error) {
      set({ error: 'Failed to update template', loading: false });
      throw error;
    }
  },

  deleteTemplate: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { templates } = get();
      const filteredTemplates = templates.filter(tpl => tpl.id !== id);
      
      set({ templates: filteredTemplates, loading: false });
    } catch (error) {
      set({ error: 'Failed to delete template', loading: false });
      throw error;
    }
  },

  duplicateTemplate: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { templates } = get();
      const original = templates.find(t => t.id === id);
      
      if (!original) {
        throw new Error('Template not found');
      }
      
      const duplicate: Template = {
        ...original,
        id: `tpl-${Date.now()}`,
        title: `${original.title} (Copy)`,
        slug: `${original.slug}-copy-${Date.now()}`,
        status: 'draft',
        featured: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastTested: undefined,
      };
      
      set({ templates: [...templates, duplicate], loading: false });
      return duplicate.id;
    } catch (error) {
      set({ error: 'Failed to duplicate template', loading: false });
      throw error;
    }
  },

  publishTemplate: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { templates } = get();
      const updatedTemplates = templates.map(tpl =>
        tpl.id === id
          ? { ...tpl, status: 'published' as const, updatedAt: new Date() }
          : tpl
      );
      
      set({ templates: updatedTemplates, loading: false });
    } catch (error) {
      set({ error: 'Failed to publish template', loading: false });
      throw error;
    }
  },

  unpublishTemplate: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { templates } = get();
      const updatedTemplates = templates.map(tpl =>
        tpl.id === id
          ? { ...tpl, status: 'draft' as const, updatedAt: new Date() }
          : tpl
      );
      
      set({ templates: updatedTemplates, loading: false });
    } catch (error) {
      set({ error: 'Failed to unpublish template', loading: false });
      throw error;
    }
  },

  setFilters: (newFilters) => {
    const { filters } = get();
    set({ filters: { ...filters, ...newFilters } });
  },

  clearCurrentTemplate: () => {
    set({ currentTemplate: null });
  },
}));
