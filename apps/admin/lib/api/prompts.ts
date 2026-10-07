/** Client-side wrappers for `/v1/admin/prompts/*`. */

import { apiFetch, type TokenGetter } from '@/lib/api';

export interface PromptSummary { key: string; title: string; description: string }

export interface PromptDetail {
  key: string;
  title: string;
  description: string;
  body: string;
  isDefault: boolean;
  default: string;
  maxChars: number;
  placeholders: Array<{ token: string; meaning: string }>;
  versions: Array<{ id: string; body: string; note: string | null; createdAt: string }>;
}

export function fetchPrompts(getToken: TokenGetter) {
  return apiFetch<PromptSummary[]>('/v1/admin/prompts', { getToken });
}
export function fetchPrompt(getToken: TokenGetter, key: string) {
  return apiFetch<PromptDetail>(`/v1/admin/prompts/${key}`, { getToken });
}
export function savePrompt(getToken: TokenGetter, key: string, body: string, note?: string) {
  return apiFetch<{ saved: true }>(`/v1/admin/prompts/${key}`, { method: 'PUT', json: { body, note: note || null }, getToken });
}
export function resetPrompt(getToken: TokenGetter, key: string) {
  return apiFetch<{ reset: true }>(`/v1/admin/prompts/${key}/reset`, { method: 'POST', getToken });
}
export function previewPrompt(getToken: TokenGetter, key: string, input: { body?: string; imageCount: number; notes?: string }) {
  return apiFetch<{ rendered: string; chars: number }>(`/v1/admin/prompts/${key}/preview`, { method: 'POST', json: input, getToken });
}
