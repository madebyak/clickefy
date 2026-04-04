'use client';

import Image from 'next/image';
import { Template } from '@/lib/types/template';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ImageIcon, MoreVertical, Pencil, Copy, Globe, Trash2, Star } from 'lucide-react';

interface TemplateCardProps {
  template: Template;
  onEdit: (template: Template) => void;
  onDelete: (template: Template) => void;
  onDuplicate: (template: Template) => void;
  onPublish: (template: Template) => void;
}

/**
 * Template card component
 * Displays template info in a grid card format
 */
export function TemplateCard({ template, onEdit, onDelete, onDuplicate, onPublish }: TemplateCardProps) {
  const statusVariant = {
    draft: 'secondary' as const,
    published: 'default' as const,
    archived: 'destructive' as const,
  };

  const typeLabels = {
    image: 'Image',
    video: 'Video',
    'image-then-video': 'Image → Video',
  };

  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors group">
      {/* Cover Image */}
      <div className="aspect-video bg-muted relative">
        {template.coverImage ? (
          <Image
            src={template.coverImage}
            alt={template.title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon className="h-12 w-12" />
          </div>
        )}

        {/* Status Badge */}
        <div className="absolute top-3 left-3 flex gap-1.5">
          <Badge variant={statusVariant[template.status]}>
            {template.status.charAt(0).toUpperCase() + template.status.slice(1)}
          </Badge>
          {template.featured && (
            <Badge className="bg-warning text-white border-warning">
              <Star className="h-3 w-3 mr-1" />
              Featured
            </Badge>
          )}
        </div>
      </div>

      {/* Card Body */}
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium text-primary">
            {typeLabels[template.type]}
          </span>
          <span className="text-xs text-muted-foreground">•</span>
          <span className="text-xs text-muted-foreground">
            {template.generation.stages.length} stage{template.generation.stages.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold truncate">{template.title}</h3>
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
              {template.description.short}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" />}>
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(template)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(template)}>
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onPublish(template)}>
                <Globe className="h-4 w-4 mr-2" />
                {template.status === 'published' ? 'Unpublish' : 'Publish'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(template)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
