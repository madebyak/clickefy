/**
 * Generation job data models
 * Tracks AI generation attempts and results
 * 
 * TODO: [Database Integration] Add MongoDB _id field when connecting to database
 * TODO: [User Integration] Add userId field when user authentication is implemented
 */

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface GenerationJob {
  id: string;
  templateId: string;
  status: JobStatus;

  // Input data
  inputs: Record<string, string>; // User uploaded file URLs
  options: {
    aspectRatio?: string;
    [key: string]: any;
  };

  // Output data
  result?: {
    images?: string[];
    videos?: string[];
    duration: number; // Generation time in milliseconds
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
