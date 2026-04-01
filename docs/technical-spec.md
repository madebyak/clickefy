# Clickefy Admin Dashboard - Technical Specification

## Project Overview
Admin dashboard for managing AI-generated content templates. Front-end only implementation with mock data, structured for future database integration.

## Tech Stack

### Core
- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **State Management:** Zustand
- **Data Fetching:** React Query (TanStack Query)

### AI Integration
- **Image Generation:** Google Gemini API (Vertex AI or AI Studio)
- **Models:** Gemini 3.1 Flash Image Preview, Gemini 2.5 Flash Image

### File Storage
- **Current:** Vercel Blob Storage
- **Future:** AWS S3 (migration ready)

### Deployment
- **Platform:** Vercel

## Design System

### Color Palette
```css
/* Dark Theme - No Gradients */
--background: #0a0a0f
--surface: #16161f
--surface-elevated: #1e1e2a
--primary-purple: #8b5cf6
--primary-green: #10b981
--text-primary: #ffffff
--text-secondary: #a1a1aa
--border: #27272a
--error: #ef4444
--warning: #f59e0b
--success: #10b981
```

### Design Principles
- ✅ Solid colors only (no gradients)
- ✅ No strokes, outlines, or drop shadows
- ✅ Clean spacing and typography
- ✅ Vibrant purple & green accents
- ✅ Fully responsive
- ✅ Consistent component heights
- ✅ Dark theme throughout

## Project Structure

```
my-next-app/
├── app/
│   ├── (admin)/                    # Admin routes group
│   │   ├── layout.tsx              # Admin layout with sidebar
│   │   ├── dashboard/              # Dashboard overview
│   │   ├── categories/             # Categories management
│   │   │   ├── page.tsx
│   │   │   └── [id]/edit/
│   │   ├── templates/              # Templates management
│   │   │   ├── page.tsx            # Templates list
│   │   │   ├── new/                # Create template
│   │   │   └── [id]/               # Edit template
│   │   │       ├── page.tsx        # Template editor
│   │   │       └── tabs/           # Editor tabs
│   │   ├── assets/                 # Asset library
│   │   ├── jobs/                   # Jobs/runs log
│   │   └── analytics/              # Analytics
│   └── api/                        # API routes
│       ├── gemini/                 # Gemini integration
│       └── upload/                 # File uploads
├── components/
│   ├── ui/                         # Base UI components
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── dropdown.tsx
│   │   ├── modal.tsx
│   │   ├── toast.tsx
│   │   └── ...
│   ├── layout/                     # Layout components
│   │   ├── sidebar.tsx
│   │   ├── header.tsx
│   │   └── page-header.tsx
│   ├── categories/                 # Category-specific
│   │   ├── category-list.tsx
│   │   ├── category-form.tsx
│   │   └── category-tree.tsx
│   └── templates/                  # Template-specific
│       ├── template-card.tsx
│       ├── template-form.tsx
│       ├── prompt-builder.tsx
│       └── generation-preview.tsx
├── lib/
│   ├── stores/                     # Zustand stores
│   │   ├── categories-store.ts
│   │   ├── templates-store.ts
│   │   └── ui-store.ts
│   ├── services/                   # API services
│   │   ├── gemini-service.ts
│   │   └── upload-service.ts
│   ├── hooks/                      # Custom hooks
│   │   ├── use-categories.ts
│   │   └── use-templates.ts
│   ├── utils/                      # Utilities
│   │   ├── cn.ts                   # Class name merger
│   │   └── format.ts
│   └── types/                      # TypeScript types
│       ├── template.ts
│       ├── category.ts
│       └── generation.ts
├── data/
│   └── mock/                       # Mock data (temporary)
│       ├── categories.json
│       ├── templates.json
│       └── assets.json
└── public/
    └── imgs/                       # Sample images
```

## Data Models

### Category
```typescript
interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;        // For sub-categories
  order: number;                   // For sorting
  icon?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  // Database ready - add later:
  // _id: ObjectId;
  // tenantId?: string;
}
```

### Template
```typescript
interface Template {
  id: string;
  title: string;
  slug: string;
  description: {
    short: string;
    long: string;
  };
  categoryId: string;
  type: 'image' | 'video' | 'image-then-video';
  status: 'draft' | 'published' | 'archived';
  featured: boolean;
  
  // Visual content
  coverImage: string;
  previewGallery: string[];
  
  // User input configuration
  userInputs: TemplateInput[];
  
  // Generation configuration
  generation: {
    mode: 'image' | 'video' | 'image-then-video';
    stages: GenerationStage[];
  };
  
  // Output settings
  output: {
    type: 'image' | 'video' | 'both';
    count: number;
    format: string;
    allowRegeneration: boolean;
  };
  
  // Metadata
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  lastTested?: Date;
  
  // Database ready - add later:
  // _id: ObjectId;
  // version: number;
  // publishedBy?: string;
}

interface TemplateInput {
  id: string;
  fieldKey: string;
  label: string;
  helperText?: string;
  required: boolean;
  type: 'image' | 'video';
  acceptedFormats: string[];
  maxSize: number;
  minResolution?: { width: number; height: number };
  order: number;
}

interface GenerationStage {
  id: string;
  order: number;
  provider: 'gemini' | 'kling';
  model: string;
  actionType: 'text-to-image' | 'image-to-image' | 'image-to-video';
  
  // Prompt configuration
  prompt: string;                  // Single text field
  
  // Input mapping
  inputMapping: {
    [key: string]: string;         // Maps user input to generation input
  };
  
  // Reference images (admin-only)
  references: {
    id: string;
    url: string;
    type: 'inspiration' | 'composition' | 'style';
  }[];
  
  // Provider-specific config
  config: {
    aspectRatio?: string;
    imageSize?: string;
    numberOfOutputs?: number;
    duration?: number;
    // Gemini/Kling specific fields
    [key: string]: any;
  };
  
  // Retry logic
  retry: {
    enabled: boolean;
    maxAttempts: number;
    fallbackModel?: string;
  };
}
```

### Generation Job
```typescript
interface GenerationJob {
  id: string;
  templateId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  
  // Input
  inputs: {
    [key: string]: string;         // User uploaded files
  };
  options: {
    aspectRatio?: string;
  };
  
  // Output
  result?: {
    images?: string[];
    videos?: string[];
    duration: number;              // Generation time in ms
    cost?: number;
  };
  
  // Error handling
  error?: {
    message: string;
    stage: number;
    retryCount: number;
  };
  
  createdAt: Date;
  completedAt?: Date;
  
  // Database ready - add later:
  // _id: ObjectId;
  // userId?: string;
}
```

## API Integration Points

### Gemini API Service
```typescript
// lib/services/gemini-service.ts

/**
 * Service for interacting with Google Gemini API
 * Supports both Vertex AI and AI Studio endpoints
 * 
 * TODO: Add authentication when integrating with backend
 * TODO: Add rate limiting and retry logic
 * TODO: Add cost tracking per generation
 */

interface GeminiConfig {
  model: 'gemini-3.1-flash-image-preview' | 'gemini-2.5-flash-image';
  prompt: string;
  referenceImages?: string[];
  aspectRatio?: string;
  imageSize?: '512' | '1K' | '2K' | '4K';
  numberOfOutputs?: number;
}

async function generateImage(config: GeminiConfig): Promise<GenerationResult>
```

### Upload Service
```typescript
// lib/services/upload-service.ts

/**
 * Service for handling file uploads
 * Currently uses Vercel Blob Storage
 * 
 * TODO: Add S3 adapter for AWS migration
 * TODO: Add image optimization/compression
 * TODO: Add virus scanning
 */

async function uploadFile(file: File, folder: string): Promise<string>
async function deleteFile(url: string): Promise<void>
```

## State Management

### Zustand Stores

```typescript
// lib/stores/categories-store.ts
/**
 * Categories state management
 * 
 * TODO: Replace mock data with API calls
 * TODO: Add optimistic updates
 * TODO: Add error handling
 */
interface CategoriesStore {
  categories: Category[];
  loading: boolean;
  error: string | null;
  
  fetchCategories: () => Promise<void>;
  createCategory: (data: Partial<Category>) => Promise<void>;
  updateCategory: (id: string, data: Partial<Category>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  reorderCategories: (ids: string[]) => Promise<void>;
}

// lib/stores/templates-store.ts
/**
 * Templates state management
 * 
 * TODO: Replace mock data with API calls
 * TODO: Add template versioning
 * TODO: Add draft auto-save
 */
interface TemplatesStore {
  templates: Template[];
  currentTemplate: Template | null;
  loading: boolean;
  error: string | null;
  
  fetchTemplates: () => Promise<void>;
  fetchTemplate: (id: string) => Promise<void>;
  createTemplate: (data: Partial<Template>) => Promise<void>;
  updateTemplate: (id: string, data: Partial<Template>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  publishTemplate: (id: string) => Promise<void>;
  testGeneration: (config: GenerationStage) => Promise<GenerationResult>;
}
```

## Component Architecture

### Base UI Components
All components follow consistent styling:
- Height: 40px for inputs/buttons (h-10)
- Border radius: 8px (rounded-lg)
- Padding: Consistent spacing scale (p-4, p-6, etc.)
- Focus states: Purple ring (focus:ring-purple-500)
- Hover states: Subtle background change

### Key Components

#### Button
```typescript
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'ghost' | 'danger';
  size: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}
```

#### Dropdown
```typescript
interface DropdownProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}
```

#### Modal
```typescript
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  children: React.ReactNode;
}
```

## Pages Implementation

### 1. Dashboard (Overview)
- Total templates count
- Published/draft/archived stats
- Recent activity
- Quick actions

### 2. Categories Management ⭐ Priority
Features:
- List all categories with sub-categories
- Create new category/sub-category
- Edit category name
- Drag-and-drop reordering
- Delete category (with confirmation)
- Nested tree view

### 3. Templates List ⭐ Priority
Features:
- Grid/list view toggle
- Filter by category, status, type
- Search by title
- Sort by date, name, status
- Quick actions (edit, duplicate, delete, publish)
- Template cards with preview

### 4. Template Editor ⭐ Priority
Tabs:
1. **Basic Info** - Title, description, category, cover image, previews
2. **User Input** - Define what users upload
3. **Generation Setup** - Prompt, model, settings, references
4. **Creative Playground** - Live testing with Gemini API
5. **Output Settings** - Output format, count, permissions
6. **Publish** - Status, featured, visibility

### 5. Asset Library
- Upload images
- Grid view with filters
- Link assets to templates
- Delete unused assets

### 6. Jobs/Runs Log
- List all generation attempts
- Filter by status, template
- View details (inputs, outputs, errors)
- Retry failed jobs

### 7. Analytics
- Template performance metrics
- Success/failure rates
- Popular categories
- Charts and graphs

## Development Workflow

### Phase 1: Setup & Foundation (Current)
- [x] Next.js project initialized
- [ ] Design system & base components
- [ ] Layout structure (sidebar, header)
- [ ] Mock data structure
- [ ] Zustand stores setup

### Phase 2: Categories Management
- [ ] Categories list page
- [ ] Category form (create/edit)
- [ ] Drag-and-drop reordering
- [ ] Sub-category support
- [ ] Delete with confirmation

### Phase 3: Templates Management
- [ ] Templates list page
- [ ] Template card component
- [ ] Filters and search
- [ ] Template editor layout
- [ ] Basic Info tab
- [ ] User Input tab

### Phase 4: AI Integration
- [ ] Gemini API service
- [ ] Generation Setup tab
- [ ] Creative Playground tab
- [ ] Real-time generation
- [ ] Result preview with modal
- [ ] Error handling

### Phase 5: Additional Features
- [ ] Output Settings tab
- [ ] Publish controls
- [ ] Asset Library
- [ ] Jobs Log
- [ ] Dashboard widgets

### Phase 6: Polish
- [ ] Loading states
- [ ] Error states
- [ ] Toast notifications
- [ ] Responsive design
- [ ] Performance optimization

## Code Standards

### TypeScript
- Strict mode enabled
- No `any` types (use `unknown` if needed)
- Proper interface definitions
- JSDoc comments for complex functions

### React
- Functional components only
- Custom hooks for reusable logic
- Proper dependency arrays
- Error boundaries

### Styling
- Tailwind utility classes
- No inline styles
- Consistent spacing scale
- Mobile-first responsive

### Comments
```typescript
// TODO: [Database Integration] Replace with API call to MongoDB
// TODO: [AWS Migration] Update to use S3 instead of Vercel Blob
// TODO: [Auth] Add authentication check
```

## Environment Variables

```env
# Gemini API
NEXT_PUBLIC_GEMINI_API_KEY=your_api_key_here
NEXT_PUBLIC_GEMINI_ENDPOINT=vertex_or_ai_studio

# Vercel Blob Storage
BLOB_READ_WRITE_TOKEN=your_token_here

# Future: AWS S3
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_REGION=
# AWS_S3_BUCKET=
```

## Testing Strategy

### Current (Demo Phase)
- Manual testing
- Browser console for debugging
- Mock data validation

### Future (Production)
- Unit tests (Jest + React Testing Library)
- Integration tests (Playwright)
- E2E tests for critical flows
- API contract tests

## Deployment

### Vercel Configuration
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "env": {
    "NEXT_PUBLIC_GEMINI_API_KEY": "@gemini-api-key"
  }
}
```

## Migration Path (Future)

### Database Integration
1. Set up MongoDB Atlas
2. Create Mongoose schemas matching TypeScript interfaces
3. Replace Zustand stores with API calls
4. Add authentication middleware
5. Implement CRUD endpoints

### AWS Migration
1. Set up S3 bucket
2. Create upload service adapter
3. Update environment variables
4. Migrate existing files
5. Update CDN configuration

## Notes

- All code structured for easy database integration
- Comments indicate future integration points
- Mock data mimics real database structure
- API services ready for backend connection
- File uploads work but can be swapped to S3
- No authentication for demo, but structure supports it
