-- Give project assets their grid renditions: a preview clip and a placeholder.
--
-- WHY
--   Every video the worker has ever filed carries the video's OWN key in
--   `poster_r2_key` (generate-job.ts copied `r2Key` across as a stand-in
--   for a Cloudflare Stream poster that never arrived). A browser <video>
--   hides that by painting its own first frame; a native image view cannot
--   decode an mp4, so every video thumbnail on mobile has been blank.
--
--   The worker now extracts a real poster frame per video and, alongside
--   it, two renditions the grids were missing:
--
--     preview_r2_key  a muted, ~360p, low-bitrate H.264 clip that grids
--                     autoplay instead of decoding the full original
--     thumbhash       a ThumbHash placeholder (base64) so a cell paints
--                     its colours and shape before any bytes arrive —
--                     images and video posters alike
--
--   The original file is untouched and remains what the viewer plays and
--   the download saves.
--
-- EXISTING ROWS
--   Nothing here rewrites them. `poster_r2_key` keeps its (wrong) value
--   until the `backfill-asset-renditions` Trigger.dev task replaces it row
--   by row; until then the API reads `poster_r2_key = r2_key` as "no
--   poster" and every client falls back to the placeholder.
--
-- SAFETY
--   - Two nullable columns on one table. No existing row is rewritten.
--   - No credit column is touched. Balances cannot move.
--   - Idempotent: IF NOT EXISTS.

ALTER TABLE "project_assets"
  ADD COLUMN IF NOT EXISTS "preview_r2_key" text;
--> statement-breakpoint

ALTER TABLE "project_assets"
  ADD COLUMN IF NOT EXISTS "thumbhash" text;
