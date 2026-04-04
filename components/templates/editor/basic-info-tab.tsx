'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Template } from '@/lib/types/template';
import { Category } from '@/lib/types/category';
import { ImagePlus, ImageIcon, Film, Clapperboard } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BasicInfoTabProps {
  template: Partial<Template>;
  categories: Category[];
  onChange: (data: Partial<Template>) => void;
}

const templateTypes = [
  { value: 'image', label: 'Image Only', description: 'Generate still images', icon: ImageIcon },
  { value: 'video', label: 'Video Only', description: 'Generate video clips', icon: Film },
  { value: 'image-then-video', label: 'Image → Video', description: 'Generate image then animate', icon: Clapperboard },
] as const;

export function BasicInfoTab({ template, categories, onChange }: BasicInfoTabProps) {
  return (
    <div className="space-y-6">
      {/* Title & Category */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="title">Template Title</Label>
          <Input
            id="title"
            value={template.title || ''}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="e.g., Luxury Skincare Product"
          />
        </div>

        <div className="space-y-2">
          <Label>Category</Label>
          <Select
            value={template.categoryId || undefined}
            onValueChange={(value) => onChange({ categoryId: value || undefined })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Descriptions */}
      <div className="space-y-2">
        <Label htmlFor="short-desc">Short Description</Label>
        <Input
          id="short-desc"
          value={template.description?.short || ''}
          onChange={(e) =>
            onChange({
              description: {
                ...template.description,
                short: e.target.value,
                long: template.description?.long || '',
              },
            })
          }
          placeholder="Brief one-line description for the mobile app"
        />
        <p className="text-xs text-muted-foreground">Appears in the template list on mobile</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="long-desc">Long Description</Label>
        <Textarea
          id="long-desc"
          value={template.description?.long || ''}
          onChange={(e) =>
            onChange({
              description: {
                short: template.description?.short || '',
                long: e.target.value,
              },
            })
          }
          placeholder="Detailed description explaining what this template does..."
          className="min-h-[100px]"
        />
        <p className="text-xs text-muted-foreground">Shown on the template detail page in the app</p>
      </div>

      <Separator />

      {/* Template Type — visual selector */}
      <div className="space-y-3">
        <Label>Template Type</Label>
        <div className="grid grid-cols-3 gap-3">
          {templateTypes.map(({ value, label, description, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ type: value })}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center',
                template.type === value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/30 bg-transparent'
              )}
            >
              <Icon className={cn('h-6 w-6', template.type === value ? 'text-primary' : 'text-muted-foreground')} />
              <div>
                <p className={cn('text-sm font-medium', template.type === value ? 'text-foreground' : 'text-muted-foreground')}>
                  {label}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Settings row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            id="featured"
            checked={template.featured || false}
            onChange={(e) => onChange({ featured: e.target.checked })}
            className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-ring"
          />
          <div>
            <Label htmlFor="featured" className="cursor-pointer">Featured Template</Label>
            <p className="text-xs text-muted-foreground">Highlighted in the mobile app homepage</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            id="aspect-ratio-toggle"
            checked={template.userCanChooseAspectRatio || false}
            onChange={(e) => onChange({ userCanChooseAspectRatio: e.target.checked })}
            className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-ring"
          />
          <div>
            <Label htmlFor="aspect-ratio-toggle" className="cursor-pointer">User Aspect Ratio</Label>
            <p className="text-xs text-muted-foreground">Let users pick aspect ratio in the app</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Cover Image & Preview */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Cover Image & Preview Gallery</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload images to showcase this template in the mobile app
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-2 block text-xs text-muted-foreground">Cover Image</Label>
            <div className="aspect-video bg-muted/30 rounded-xl flex items-center justify-center border-2 border-dashed border-border hover:border-primary/50 transition-colors cursor-pointer">
              <div className="text-center">
                <ImagePlus className="h-7 w-7 mx-auto text-muted-foreground mb-1.5" />
                <p className="text-xs text-muted-foreground">Upload Cover</p>
              </div>
            </div>
          </div>
          <div>
            <Label className="mb-2 block text-xs text-muted-foreground">Preview Gallery</Label>
            <div className="aspect-video bg-muted/30 rounded-xl flex items-center justify-center border-2 border-dashed border-border hover:border-primary/50 transition-colors cursor-pointer">
              <div className="text-center">
                <ImagePlus className="h-7 w-7 mx-auto text-muted-foreground mb-1.5" />
                <p className="text-xs text-muted-foreground">Upload Images</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
