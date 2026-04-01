'use client';

import Link from 'next/link';
import { Template } from '@/lib/types/template';
import { cn } from '@/lib/utils/cn';

interface TemplateCardProps {
  template: Template;
  onEdit: (template: Template) => void;
  onDelete: (template: Template) => void;
  onDuplicate: (template: Template) => void;
  onPublish: (template: Template) => void;
}

/**
 * Template card component
 * Displays template info in grid/list view
 */
export function TemplateCard({ template, onEdit, onDelete, onDuplicate, onPublish }: TemplateCardProps) {
  const statusColors = {
    draft: 'bg-text-secondary',
    published: 'bg-primary-green',
    archived: 'bg-error',
  };

  const typeIcons = {
    image: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    video: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
    'image-then-video': (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
      </svg>
    ),
  };

  return (
    <div className="bg-surface rounded-lg overflow-hidden hover:bg-surface-elevated transition-colors group">
      {/* Cover Image */}
      <div className="relative aspect-video bg-surface-elevated">
        {template.coverImage ? (
          <img
            src={template.coverImage}
            alt={template.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-16 h-16 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        
        {/* Badges */}
        <div className="absolute top-3 left-3 flex gap-2">
          <span className={cn('px-2 py-1 text-xs font-medium rounded text-white', statusColors[template.status])}>
            {template.status}
          </span>
          {template.featured && (
            <span className="px-2 py-1 text-xs font-medium rounded bg-primary-purple text-white">
              Featured
            </span>
          )}
        </div>

        {/* Type Icon */}
        <div className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-black/50 backdrop-blur-sm flex items-center justify-center text-white">
          {typeIcons[template.type]}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-text-primary mb-1 line-clamp-1">{template.title}</h3>
        <p className="text-sm text-text-secondary line-clamp-2 mb-3">{template.description.short}</p>

        {/* Meta Info */}
        <div className="flex items-center gap-4 text-xs text-text-secondary mb-4">
          <span className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {new Date(template.updatedAt).toLocaleDateString()}
          </span>
          {template.lastTested && (
            <span className="flex items-center gap-1 text-primary-green">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Tested
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link
            href={`/admin/templates/${template.id}`}
            className="flex-1 h-9 px-3 rounded-lg bg-primary-purple text-white text-sm font-medium flex items-center justify-center hover:bg-purple-600 transition-colors"
          >
            Edit
          </Link>
          <button
            onClick={() => onDuplicate(template)}
            className="h-9 px-3 rounded-lg bg-surface-elevated text-text-primary text-sm font-medium hover:bg-[#252532] transition-colors"
            title="Duplicate"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          {template.status === 'draft' ? (
            <button
              onClick={() => onPublish(template)}
              className="h-9 px-3 rounded-lg bg-primary-green text-white text-sm font-medium hover:bg-green-600 transition-colors"
              title="Publish"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          ) : (
            <button
              onClick={() => onDelete(template)}
              className="h-9 px-3 rounded-lg bg-error text-white text-sm font-medium hover:bg-red-600 transition-colors"
              title="Delete"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
