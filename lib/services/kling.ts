import { createHmac } from 'crypto';

const KLING_API_BASE = 'https://api.klingai.com';

/**
 * Generate JWT for Kling API authentication.
 * Uses HMAC-SHA256 with access_key as issuer and secret_key for signing.
 */
function createKlingToken(): string {
  const accessKey = process.env.KLING_ACCESS_KEY!;
  const secretKey = process.env.KLING_SECRET_KEY!;

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: accessKey,
    exp: now + 1800,
    nbf: now - 5,
    iat: now,
  };

  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signature = createHmac('sha256', secretKey)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

export interface KlingVideoRequest {
  model?: string;
  mode?: 'std' | 'pro';
  prompt: string;
  negativePrompt?: string;
  imageBase64: string;
  imageMimeType?: string;
  duration?: number;
  aspectRatio?: string;
  cfgScale?: number;
}

export interface KlingVideoResult {
  taskId: string;
  status: string;
  videoUrl?: string;
  duration?: number;
}

/**
 * Submit an image-to-video generation task to Kling.
 * Returns a task ID that must be polled for completion.
 *
 * Supported models: kling-v2-6, kling-v2-5-turbo, kling-v2-master, kling-v2-1
 * Modes: "std" (fast ~30s) or "pro" (high quality ~60s)
 */
export async function createKlingVideoTask(
  request: KlingVideoRequest
): Promise<KlingVideoResult> {
  const token = createKlingToken();

  // Strip data URI prefix if present — Kling expects raw base64 only
  let rawBase64 = request.imageBase64;
  if (rawBase64.includes(',')) {
    rawBase64 = rawBase64.split(',')[1];
  }

  const modelName = request.model || 'kling-v2-6';

  const body: Record<string, unknown> = {
    model_name: modelName,
    mode: request.mode || 'std',
    image: rawBase64,
    prompt: request.prompt,
    duration: String(request.duration || 5),
  };

  // cfg_scale is only supported for V1.x models, not V2+
  if (!modelName.startsWith('kling-v2')) {
    body.cfg_scale = request.cfgScale ?? 0.5;
  }

  if (request.negativePrompt) {
    body.negative_prompt = request.negativePrompt;
  }

  const response = await fetch(`${KLING_API_BASE}/v1/videos/image2video`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kling API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (data.code !== 0) {
    throw new Error(`Kling API error: ${data.message || 'Unknown error'}`);
  }

  return {
    taskId: data.data.task_id,
    status: data.data.task_status,
  };
}

/**
 * Poll a Kling video task for completion.
 * Task statuses: submitted → processing → succeed | failed
 */
export async function getKlingVideoTask(taskId: string): Promise<KlingVideoResult> {
  const token = createKlingToken();

  const response = await fetch(
    `${KLING_API_BASE}/v1/videos/image2video/${taskId}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kling API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (data.code !== 0) {
    throw new Error(`Kling API error: ${data.message || 'Unknown error'}`);
  }

  const task = data.data;
  const result: KlingVideoResult = {
    taskId: task.task_id,
    status: task.task_status,
  };

  if (task.task_status === 'succeed' && task.task_result?.videos?.length) {
    result.videoUrl = task.task_result.videos[0].url;
    result.duration = task.task_result.videos[0].duration;
  }

  return result;
}

/**
 * Poll until the video task completes or fails.
 * Default timeout: 5 minutes, polling every 5 seconds.
 */
export async function waitForKlingVideo(
  taskId: string,
  maxWaitMs = 300000,
  pollIntervalMs = 5000
): Promise<KlingVideoResult> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const result = await getKlingVideoTask(taskId);

    if (result.status === 'succeed') return result;
    if (result.status === 'failed') throw new Error('Kling video generation failed');

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Kling video generation timed out');
}
