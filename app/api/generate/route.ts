/**
 * POST /api/generate — Run an AI generation stage.
 *
 * @integration React Native
 *   The mobile app should NOT call this directly. Instead, create a
 *   generation job via POST /api/jobs (to be built), which orchestrates
 *   the full multi-stage pipeline server-side and stores results in MongoDB.
 *
 *   This endpoint is currently used by the admin Playground tab for testing.
 *
 * @integration MongoDB
 *   When the jobs API is built, each call to this endpoint should be logged
 *   as a step inside the GenerationJob document for audit/cost tracking.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateWithGemini, generateWithImagen } from '@/lib/services/gemini';
import { createKlingVideoTask } from '@/lib/services/kling';

interface GenerateRequest {
  provider: 'gemini' | 'kling';
  model: string;
  actionType: 'text-to-image' | 'image-to-image' | 'image-to-video';
  prompt: string;
  referenceImages?: { base64: string; mimeType: string; role: string; label: string }[];
  inputImages?: { base64: string; mimeType: string; label?: string }[];
  config?: {
    aspectRatio?: string;
    numberOfOutputs?: number;
    duration?: number;
    mode?: 'std' | 'pro';
    negativePrompt?: string;
    cfgScale?: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();
    const { provider, model, actionType, prompt, referenceImages, inputImages, config } = body;

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // --- GEMINI ---
    if (provider === 'gemini') {
      const isImagenModel = model.startsWith('imagen');

      if (isImagenModel && actionType === 'text-to-image') {
        const result = await generateWithImagen({
          model,
          prompt,
          aspectRatio: config?.aspectRatio,
          numberOfOutputs: config?.numberOfOutputs,
        });

        return NextResponse.json({
          status: 'completed',
          outputs: result.images.map((img) => ({
            type: 'image',
            base64: img.base64,
            mimeType: img.mimeType,
          })),
        });
      }

      const result = await generateWithGemini({
        model,
        prompt,
        referenceImages,
        inputImages,
        aspectRatio: config?.aspectRatio,
        numberOfOutputs: config?.numberOfOutputs,
      });

      return NextResponse.json({
        status: 'completed',
        outputs: result.images.map((img) => ({
          type: 'image',
          base64: img.base64,
          mimeType: img.mimeType,
        })),
      });
    }

    // --- KLING ---
    if (provider === 'kling') {
      if (!inputImages?.length) {
        return NextResponse.json(
          { error: 'Kling image-to-video requires an input image' },
          { status: 400 }
        );
      }

      const taskResult = await createKlingVideoTask({
        model,
        mode: config?.mode || 'std',
        prompt,
        negativePrompt: config?.negativePrompt,
        imageBase64: inputImages[0].base64,
        imageMimeType: inputImages[0].mimeType,
        duration: config?.duration,
        aspectRatio: config?.aspectRatio,
        cfgScale: config?.cfgScale,
      });

      return NextResponse.json({
        status: 'processing',
        taskId: taskResult.taskId,
        provider: 'kling',
      });
    }

    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed';
    console.error('Generation error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
