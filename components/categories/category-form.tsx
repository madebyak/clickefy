'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Category, CategoryFormData } from '@/lib/types/category';
import {
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
import { cn } from '@/lib/utils';

const availableIcons: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'droplet', label: 'Droplet', icon: Droplet },
  { key: 'coffee', label: 'Coffee', icon: Coffee },
  { key: 'pill', label: 'Pill', icon: Pill },
  { key: 'shirt', label: 'Shirt', icon: Shirt },
  { key: 'smartphone', label: 'Smartphone', icon: Smartphone },
  { key: 'gem', label: 'Gem', icon: Gem },
  { key: 'sparkles', label: 'Sparkles', icon: Sparkles },
  { key: 'shopping-bag', label: 'Shopping Bag', icon: ShoppingBag },
  { key: 'camera', label: 'Camera', icon: Camera },
  { key: 'palette', label: 'Palette', icon: Palette },
  { key: 'utensils', label: 'Utensils', icon: Utensils },
  { key: 'heart', label: 'Heart', icon: Heart },
  { key: 'star', label: 'Star', icon: Star },
  { key: 'zap', label: 'Zap', icon: Zap },
];

interface CategoryFormProps {
  category?: Category;
  categories: Category[];
  onSubmit: (data: CategoryFormData) => void;
  onCancel: () => void;
}

/**
 * Category form component
 * Used for creating and editing categories
 */
export function CategoryForm({ category, categories, onSubmit, onCancel }: CategoryFormProps) {
  const [name, setName] = useState(category?.name || '');
  const [description, setDescription] = useState(category?.description || '');
  const [icon, setIcon] = useState(category?.icon || '');
  const [parentId, setParentId] = useState<string | null>(category?.parentId ?? null);

  // Filter out the current category and its children to prevent circular references
  const availableParents = categories.filter((cat) => {
    if (!category) return true;
    if (cat.id === category.id) return false;
    if (cat.parentId === category.id) return false;
    return true;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      icon: icon || undefined,
      parentId: parentId || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cat-name">Name</Label>
        <Input
          id="cat-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="cat-desc">Description</Label>
        <Textarea
          id="cat-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          className="min-h-[80px]"
        />
      </div>

      <div className="space-y-2">
        <Label>Icon</Label>
        <div className="grid grid-cols-7 gap-2">
          {availableIcons.map(({ key, label, icon: IconComp }) => (
            <button
              key={key}
              type="button"
              onClick={() => setIcon(icon === key ? '' : key)}
              className={cn(
                'flex h-10 w-full items-center justify-center rounded-lg border transition-colors',
                icon === key
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground'
              )}
              title={label}
            >
              <IconComp className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Parent Category</Label>
        <Select
          value={parentId || '__none__'}
          onValueChange={(value) => setParentId(!value || value === '__none__' ? null : value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="None (top-level)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None (top-level)</SelectItem>
            {availableParents
              .filter((cat) => !cat.parentId)
              .map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{category ? 'Update' : 'Create'} Category</Button>
      </div>
    </form>
  );
}
