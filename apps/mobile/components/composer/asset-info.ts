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
  uri: string | number;
  prompt: string;
  modelName: string;
  /** Relative creation time, preformatted ("2h ago"). */
  when: string;
  /** Quality tier label ("4K"), when the model has tiers. */
  quality?: string;
  /** Clip length in seconds — video only. */
  durationSeconds?: number;
}
