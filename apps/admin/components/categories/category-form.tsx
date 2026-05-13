'use client';

import { useState, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch, ApiError } from '@/lib/api';
import type { Category, CategoryFormData } from '@clickfy/types';
import { Upload, Loader2, X, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CategoryFormProps {
  category?: Category;
  categories: Category[];
  onSubmit: (data: CategoryFormData) => void;
  onCancel: () => void;
}

const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 4 * 1024 * 1024; // 4MB

function deriveSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function CategoryForm({ category, categories, onSubmit, onCancel }: CategoryFormProps) {
  const { getToken } = useAuth();

  const [name, setName] = useState(category?.name ?? '');
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(category?.slug));
  const [iconUrl, setIconUrl] = useState<string | null>(category?.iconUrl ?? null);
  const [parentId, setParentId] = useState<string | null>(category?.parentId ?? null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableParents = categories.filter((cat) => {
    if (!category) return true;
    if (cat.id === category.id) return false;
    if (cat.parentId === category.id) return false;
    return true;
  });

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(deriveSlug(value));
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_MIME.includes(file.type)) {
      toast.error('Image must be a JPG, PNG, or WebP.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Image must be under 4MB.');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'categories');

      const result = await apiFetch<{ url: string; key: string }>(
        '/v1/admin/uploads',
        { method: 'POST', getToken, formData },
      );

      setIconUrl(result.url);
      toast.success('Image uploaded');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Upload failed';
      toast.error(msg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSubmit({
      name: name.trim(),
      slug: slug.trim() || deriveSlug(name),
      iconUrl,
      parentId,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cat-name">Name</Label>
        <Input
          id="cat-name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Skincare"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="cat-slug">Slug</Label>
        <Input
          id="cat-slug"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          placeholder="auto-generated from name"
          pattern="[-a-z0-9]+"
        />
        <p className="text-xs text-muted-foreground">
          Used in URLs. Lowercase letters, digits, and hyphens only.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Icon image</Label>
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'group relative flex aspect-square w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors',
              iconUrl
                ? 'border-border bg-muted/30'
                : 'border-border bg-muted/20 hover:border-primary/50',
            )}
          >
            {iconUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={iconUrl}
                  alt="Category icon"
                  className="h-full w-full object-cover"
                  onError={() => {
                    toast.error('Icon URL failed to load');
                  }}
                />
                <button
                  type="button"
                  onClick={() => setIconUrl(null)}
                  className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 shadow-md transition-opacity hover:bg-background"
                  aria-label="Remove image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex flex-col items-center justify-center gap-2 px-2 text-center text-muted-foreground hover:text-foreground"
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Upload className="h-5 w-5" />
                )}
                <span className="text-xs leading-tight">
                  {uploading ? 'Uploading…' : 'Upload image'}
                </span>
              </button>
            )}
          </div>
          <p className="flex-1 pt-1 text-xs text-muted-foreground">
            Square thumbnail shown across the app. JPG, PNG, or WebP &middot; up to 4 MB.
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="flex items-center gap-2">
          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="…or paste a remote image URL"
            value={iconUrl ?? ''}
            onChange={(e) => setIconUrl(e.target.value || null)}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Parent category</Label>
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
        <Button type="submit" disabled={uploading}>
          {category ? 'Update' : 'Create'} category
        </Button>
      </div>
    </form>
  );
}
