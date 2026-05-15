-- 0012_cover_media_nullable.sql
--
-- Relax `templates.cover_media` to nullable so admins can save a
-- template as a draft before they've uploaded a cover. The publish
-- handler enforces "must have a cover" at the API layer, so the
-- production mobile feed never sees a null — only in-progress
-- drafts do.
--
-- One-statement migration. Zero data risk: changing NOT NULL → NULL
-- does not touch existing rows or indexes.

ALTER TABLE "templates" ALTER COLUMN "cover_media" DROP NOT NULL;
