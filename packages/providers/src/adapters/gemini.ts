/**
 * Gemini adapter — turns a `GeminiCompiledRequest` into a real call
 * against `@google/genai` and normalises the response into
 * `ExecuteResult`.
 *
 * Two variants:
 *   - `generateContent` for the Nano Banana family (multimodal image
 *     generation). Requires `responseModalities: ['IMAGE']` and the
 *     full `contents` array prepared by the compiler.
 *   - `generateImages` for Imagen (pure text-to-image). No `contents`;
 *     prompt + `config.numberOfImages` + `config.aspectRatio` only.
 *
 * Environment is passed in (rather than read from `process.env`) so
 * the same code runs in the admin Next.js route, in a Cloudflare
 * Worker, or in a Trigger.dev task without rewiring.
 */

import { GoogleGenAI } from '@google/genai';

import type { ExecuteResult } from '../execute';
import type { GeminiCompiledRequest } from '../compile-types';

export interface GeminiEnv {
  apiKey: string;
}

interface GeminiInlinePart {
  inlineData?: { data?: string; mimeType?: string };
  text?: string;
}

/**
 * Coerce the compiler's `responseModalities` (`'TEXT' | 'IMAGE'`) into
 * the SDK enum strings. The SDK accepts the lowercase variants too in
 * recent versions but the uppercase form is what the Gemini 3 docs
 * show across every example, so we mirror that.
 */
function buildConfig(request: GeminiCompiledRequest): Record<string, unknown> {
  const config: Record<string, unknown> = {
    responseModalities: request.responseModalities,
  };
  if (request.imageConfig?.aspectRatio || request.imageConfig?.imageSize) {
    const imageConfig: Record<string, string> = {};
    if (request.imageConfig.aspectRatio) imageConfig.aspectRatio = request.imageConfig.aspectRatio;
    if (request.imageConfig.imageSize) imageConfig.imageSize = request.imageConfig.imageSize;
    config.imageConfig = imageConfig;
  }
  return config;
}

export async function executeGemini(
  request: GeminiCompiledRequest,
  env: GeminiEnv,
): Promise<ExecuteResult> {
  if (!env.apiKey) {
    throw new Error('Gemini adapter requires `env.apiKey`. Set GEMINI_API_KEY.');
  }
  const ai = new GoogleGenAI({ apiKey: env.apiKey });

  if (request.variant === 'generateImages') {
    // Imagen — pure text-to-image. No reference images, no contents.
    const response = await ai.models.generateImages({
      model: request.model,
      prompt: request.prompt,
      config: {
        numberOfImages: request.numberOfOutputs,
        // The SDK's aspectRatio enum is narrower than Gemini's; we cast
        // because the compiler already validated against the model's
        // capability set, and the SDK rejects invalid values at runtime
        // with a clear error if we get this wrong.
        aspectRatio: request.imageConfig?.aspectRatio as
          | '1:1'
          | '3:4'
          | '4:3'
          | '9:16'
          | '16:9'
          | undefined,
      },
    });

    const outputs: ExecuteResult & { status: 'completed' } = {
      status: 'completed',
      outputs: [],
    };
    for (const gen of response.generatedImages ?? []) {
      if (gen.image?.imageBytes) {
        outputs.outputs.push({
          type: 'image',
          base64: gen.image.imageBytes,
          mimeType: 'image/png',
        });
      }
    }
    if (outputs.outputs.length === 0) {
      throw new Error('Imagen returned no images. Check prompt content policy / quota.');
    }
    return outputs;
  }

  // Multimodal Nano Banana family.
  const response = await ai.models.generateContent({
    model: request.model,
    contents: request.contents as Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    >,
    config: buildConfig(request),
  });

  const images: { base64: string; mimeType: string }[] = [];
  const candidates = response.candidates ?? [];
  for (const candidate of candidates) {
    const parts = (candidate.content?.parts ?? []) as GeminiInlinePart[];
    for (const part of parts) {
      const data = part.inlineData?.data;
      const mime = part.inlineData?.mimeType;
      if (data && mime?.startsWith('image/')) {
        images.push({ base64: data, mimeType: mime });
      }
    }
  }

  if (images.length === 0) {
    // Surface any text the model returned — Gemini sometimes refuses
    // with a textual rationale when content policy is triggered.
    let textReason = '';
    for (const candidate of candidates) {
      const parts = (candidate.content?.parts ?? []) as GeminiInlinePart[];
      for (const part of parts) {
        if (part.text) textReason += part.text;
      }
    }
    throw new Error(
      textReason
        ? `Gemini returned no images. Model said: ${textReason.slice(0, 500)}`
        : 'Gemini returned no images. The model may have filtered the output.',
    );
  }

  return {
    status: 'completed',
    outputs: images.map((img) => ({
      type: 'image',
      base64: img.base64,
      mimeType: img.mimeType,
    })),
  };
}
