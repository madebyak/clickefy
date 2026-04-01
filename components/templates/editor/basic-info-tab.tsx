'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dropdown } from '@/components/ui/dropdown';
import { Template } from '@/lib/types/template';
import { Category } from '@/lib/types/category';

interface BasicInfoTabProps {
  template: Partial<Template>;
  categories: Category[];
  onChange: (data: Partial<Template>) => void;
}

/**
 * Basic Info Tab
 * Template title, description, category, type, and visibility settings
 */
export function BasicInfoTab({ template, categories, onChange }: BasicInfoTabProps) {
  const categoryOptions = categories.map(cat => ({
    value: cat.id,
    label: cat.name,
  }));

  const typeOptions = [
    { value: 'image', label: 'Image Only' },
    { value: 'video', label: 'Video Only' },
    { value: 'image-then-video', label: 'Image then Video' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Input
          label="Template Title"
          value={template.title || ''}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g., Luxury Skincare Product"
          required
        />

        <Dropdown
          label="Category"
          options={categoryOptions}
          value={template.categoryId || ''}
          onChange={(value) => onChange({ categoryId: value })}
          required
        />
      </div>

      <Input
        label="Short Description"
        value={template.description?.short || ''}
        onChange={(e) => onChange({
          description: {
            ...template.description,
            short: e.target.value,
            long: template.description?.long || '',
          },
        })}
        placeholder="Brief one-line description for the mobile app"
        helperText="This appears in the template list on mobile"
        required
      />

      <Textarea
        label="Long Description"
        value={template.description?.long || ''}
        onChange={(e) => onChange({
          description: {
            short: template.description?.short || '',
            long: e.target.value,
          },
        })}
        placeholder="Detailed description explaining what this template does..."
        helperText="Shown on the template detail page"
        className="min-h-[120px]"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Dropdown
          label="Template Type"
          options={typeOptions}
          value={template.type || 'image'}
          onChange={(value) => onChange({ type: value as Template['type'] })}
          helperText="Determines the generation pipeline"
          required
        />

        <div>
          <label className="flex items-center gap-3 h-10">
            <input
              type="checkbox"
              checked={template.featured || false}
              onChange={(e) => onChange({ featured: e.target.checked })}
              className="w-5 h-5 rounded bg-surface border-border text-primary-purple focus:ring-2 focus:ring-primary-purple focus:ring-offset-2 focus:ring-offset-background"
            />
            <div>
              <span className="text-sm font-medium text-text-primary">Featured Template</span>
              <p className="text-xs text-text-secondary">Show prominently in the app</p>
            </div>
          </label>
        </div>
      </div>

      <div className="bg-surface-elevated rounded-lg p-4">
        <h3 className="text-sm font-medium text-text-primary mb-2">Cover Image & Preview Gallery</h3>
        <p className="text-sm text-text-secondary mb-4">
          Upload images to showcase this template in the mobile app
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Cover Image</label>
            <div className="aspect-video bg-surface rounded-lg flex items-center justify-center border-2 border-dashed border-border hover:border-primary-purple transition-colors cursor-pointer">
              <div className="text-center">
                <svg className="w-8 h-8 mx-auto text-text-secondary mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <p className="text-sm text-text-secondary">Upload Cover</p>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Preview Gallery</label>
            <div className="aspect-video bg-surface rounded-lg flex items-center justify-center border-2 border-dashed border-border hover:border-primary-purple transition-colors cursor-pointer">
              <div className="text-center">
                <svg className="w-8 h-8 mx-auto text-text-secondary mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <p className="text-sm text-text-secondary">Upload Images</p>
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-text-secondary mt-2">
          TODO: Image upload will be implemented with Vercel Blob Storage
        </p>
      </div>
    </div>
  );
}
