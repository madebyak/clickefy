/**
 * Generation job — tracks a single AI generation request from a mobile user.
 *
 * @integration MongoDB
 *   - Replace `id` with MongoDB `_id: ObjectId`.
 *   - Add `userId: ObjectId` to tie jobs to authenticated users.
 *   - Store `inputs` file URLs as S3/GCS references, not raw base64.
 *   - Index on `userId + createdAt` for user history, `status` for queue processing.
 *
 * @integration React Native
 *   - Mobile submits POST /api/jobs with templateId, inputs, and options.
 *   - Poll GET /api/jobs/:id until status is 'completed' or 'failed'.
 *   - Display `result.images` / `result.videos` URLs in the results screen.
 */

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface GenerationJob {
  id: string;
  templateId: string;
  status: JobStatus;

  inputs: Record<string, string>;
  options: {
    aspectRatio?: string;
    [key: string]: unknown;
  };

  result?: {
    images?: string[];
    videos?: string[];
    duration: number;
    cost?: number;
  };

  error?: {
    message: string;
    stage: number;
    retryCount: number;
  };

  createdAt: Date;
  completedAt?: Date;
}

export interface GenerationResult {
  success: boolean;
  images?: string[];
  videos?: string[];
  duration: number;
  cost?: number;
  error?: string;
}

export interface TestGenerationRequest {
  prompt: string;
  model: string;
  provider: 'gemini' | 'kling';
  config: {
    aspectRatio?: string;
    imageSize?: string;
    numberOfOutputs?: number;
  };
  referenceImages?: string[];
}
