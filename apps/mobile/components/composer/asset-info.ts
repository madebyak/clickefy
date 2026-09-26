/**
 * AssetInfo — everything the viewer and the details drawer need to know
 * about one generated artifact, however it was reached (masonry cell,
 * feed card). Mirrors the web's asset-detail provenance surface.
 */

import type { ComposerMode } from './sheets';

export interface AssetInfo {
  id: string;
  kind: ComposerMode;
  ratio: string;
  /** The ORIGINAL file: what the viewer opens and Save to Photos writes. */
  uri: string | number;
  /** Poster frame for a video (grid/thumb use); the viewer plays `uri`. */
  posterUri?: string;
  /** ThumbHash placeholder for the thumb. */
  thumbhash?: string;
  prompt: string;
  modelName: string;
  /** Relative creation time, preformatted ("2h ago"). */
  when: string;
  /** Quality tier label ("4K"), when the model has tiers. */
  quality?: string;
  /** Clip length in seconds — video only. */
  durationSeconds?: number;
  /** A Draft-mode preview (Seedance 2.5) and what making its final takes. */
  draft?: AssetDraft;
}

/**
 * The final made from a draft: the provider re-renders the draft's own
 * shot at `finalTier` from the draft's task id, so the request is only
 * the draft's job and model.
 */
export interface AssetDraft {
  jobId: string;
  modelKey: string;
  finalTier: string;
  finalCostCredits: number;
  /** ISO time after which no final can be made. */
  expiresAt: string;
  /** The final already queued or made from this draft, if any. */
  finalJobId: string | null;
}

/** A final can still be made: none queued or made yet, and inside the window. */
export function canMakeFinal(draft: AssetDraft): boolean {
  return draft.finalJobId == null && Date.parse(draft.expiresAt) > Date.now();
}
