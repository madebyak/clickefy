/**
 * /v1/projects, /v1/folders, /v1/assets — the web studio's projects
 * layer (Phase 1C).
 *
 *   GET    /v1/projects             folders + projects (counts, covers)
 *   POST   /v1/projects             create ({ name?, folderId? })
 *   PATCH  /v1/projects/:id         rename and/or move to folder
 *   DELETE /v1/projects/:id         delete (asset rows cascade; R2 stays)
 *   GET    /v1/projects/:id/assets  cursor-paginated assets
 *   POST   /v1/projects/:id/assets  copy assets into :id
 *   GET/POST/PATCH/DELETE /v1/folders[...]
 *   PATCH  /v1/assets               bulk move to another project
 *   DELETE /v1/assets               bulk delete rows
 *   GET    /v1/assets/favorites     the user's hearted assets (all projects)
 *   POST   /v1/assets/favorites     bulk favorite
 *   DELETE /v1/assets/favorites     bulk unfavorite
 *
 * Ownership: every query is compound-scoped `(id, user_id)` so foreign
 * ids no-op (404/204) instead of leaking existence — house convention.
 *
 * Move updates `project_id` IN PLACE so asset ids survive it — global
 * favorites reference `project_assets.id`, and the previous
 * copy-then-delete implementation minted fresh ids, silently dropping
 * every favorite on a moved asset. Rows that would violate the
 * `(project_id, job_id, output_index)` uniqueness are excluded from the
 * UPDATE and deleted instead, which is exactly what the old
 * INSERT … ON CONFLICT DO NOTHING + DELETE pair did to them.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, inArray, sql as dsql } from 'drizzle-orm';

import { favoriteAssets, folders, jobs, projectAssets, projects, templates } from '@clickfy/db';

import type { JobInputValue } from '@clickfy/types';
import {
  CREATE_PROMPT_KEY,
  CREATE_START_FRAME_KEY,
  CREATE_END_FRAME_KEY,
  createReferenceKey,
  findCapabilities,
} from '@clickfy/providers';
import type { AppEnv } from '../types';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import {
  copyAssetsSchema,
  createFolderSchema,
  createProjectSchema,
  deleteAssetsSchema,
  favoriteAssetsSchema,
  moveAssetsSchema,
  updateFolderSchema,
  updateProjectSchema,
} from '../lib/project-schemas';

export const projectsRoute = new Hono<AppEnv>();
export const foldersRoute = new Hono<AppEnv>();
export const assetsRoute = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);

/**
 * Parse a `<timestamptz-text>|<uuid>` keyset cursor. The timestamp is
 * kept as its raw string (full microsecond precision) and compared as
 * `::timestamptz` in SQL — never round-tripped through a JS Date, which
 * would truncate to milliseconds and skip rows sharing a microsecond.
 * Returns null for absent/malformed cursors (→ first page).
 */
function parseKeysetCursor(cursor: string | undefined): { ts: string; id: string } | null {
  if (!cursor) return null;
  const idx = cursor.indexOf('|');
  if (idx <= 0) return null;
  const ts = cursor.slice(0, idx);
  const id = cursor.slice(idx + 1);
  // `id` must be a uuid; `ts` must parse as a real instant (guards against
  // a client sending junk, without trusting it into the SQL as a Date).
  if (!isUuid(id) || Number.isNaN(new Date(ts).getTime())) return null;
  return { ts, id };
}

/** Mint a delivery URL for an asset r2Key against the live origin. */
const assetUrl = (origin: string, r2Key: string) => `${origin}/v1/outputs/${r2Key}`;

/**
 * URL for a key that may live in EITHER R2 bucket.
 *
 * Generated artifacts sit in OUTPUTS under `jobs/<jobId>/…` and are
 * served by `/v1/outputs`; anything a user or admin uploaded sits in
 * UPLOADS and is served by `/v1/uploads`. The two are different buckets
 * behind different routes, so serving an upload key from the outputs
 * route 404s — which is exactly what every reference image in the asset
 * info panel did.
 *
 * Reference images are always uploads in practice (attaching a generated
 * asset re-uploads its bytes to get a real `r2Key`), but this dispatches
 * on the key's own prefix rather than trusting that, so a future path
 * that references an output directly still resolves.
 */
const UPLOAD_KEY_PREFIXES = ['user-uploads/', 'avatars/', 'categories/', 'templates/'];

function mediaUrl(origin: string, r2Key: string): string {
  const isUpload = UPLOAD_KEY_PREFIXES.some((p) => r2Key.startsWith(p));
  return `${origin}/v1/${isUpload ? 'uploads' : 'outputs'}/${r2Key}`;
}

/**
 * Reference slots to look for on a create job. `buildCreateStage` emits
 * `ref_0…ref_N`; the API caps submissions well below this, so scanning a
 * fixed window is cheaper than parsing every key.
 */
const MAX_LISTED_REFERENCES = 16;

/** File extension from the stored R2 key — we persist no MIME type. */
function formatFromKey(r2Key: string): string | null {
  const ext = r2Key.split('.').pop();
  return ext && ext.length <= 5 && !ext.includes('/') ? ext.toLowerCase() : null;
}

/** Provenance block on the asset-detail response. */
interface AssetGeneration {
  source: 'template' | 'user';
  /** User-typed prompt. Always null for template jobs — see the route. */
  prompt: string | null;
  templateTitle: string | null;
  modelKey: string | null;
  modelName: string | null;
  aspectRatio: string | null;
  quality: string | null;
  duration: number | null;
  sound: boolean | null;
  references: Array<{ role: 'start_frame' | 'end_frame' | 'reference'; url: string }>;
}

const readChain = [
  withAuth({ required: true }),
  withRateLimit((env: AppEnv['Bindings']) => env.RL_USER_READ, byClerkUserId),
  withCurrentUser(),
] as const;

const writeChain = [
  withAuth({ required: true }),
  withRateLimit((env: AppEnv['Bindings']) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
] as const;

// ─── GET /v1/projects ───────────────────────────────────────────────
// One call for the studio sidebar + projects browser: all folders plus
// the projects page (cursor over `updated_at DESC, id DESC`), each with
// asset count and a cover (newest asset).
projectsRoute.get('/', ...readChain, async (c) => {
  const user = c.var.user!;
  const origin = new URL(c.req.url).origin;

  const limitRaw = Number(c.req.query('limit') ?? '50');
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50));
  const keyset = parseKeysetCursor(c.req.query('cursor'));

  const folderRows = await c.var.db
    .select()
    .from(folders)
    .where(eq(folders.userId, user.id))
    .orderBy(desc(folders.createdAt));

  const projectRows = await c.var.db
    .select({
      row: projects,
      // Full-precision cursor timestamp — see the assets endpoint for why
      // a Date-built cursor loses microseconds and drops boundary rows.
      cursorTs: dsql<string>`${projects.updatedAt}::text`,
    })
    .from(projects)
    .where(
      keyset
        ? and(
            eq(projects.userId, user.id),
            dsql`(${projects.updatedAt} < ${keyset.ts}::timestamptz OR (${projects.updatedAt} = ${keyset.ts}::timestamptz AND ${projects.id} < ${keyset.id}))`,
          )
        : eq(projects.userId, user.id),
    )
    .orderBy(desc(projects.updatedAt), desc(projects.id))
    .limit(limit + 1);

  const hasMore = projectRows.length > limit;
  const pageRows = hasMore ? projectRows.slice(0, limit) : projectRows;
  const page = pageRows.map((r) => r.row);
  const nextCursor = hasMore
    ? `${pageRows[pageRows.length - 1]!.cursorTs}|${pageRows[pageRows.length - 1]!.row.id}`
    : null;

  const ids = page.map((p) => p.id);
  const counts = new Map<string, number>();
  const covers = new Map<
    string,
    { kind: 'image' | 'video'; r2Key: string; posterR2Key: string | null }
  >();
  if (ids.length > 0) {
    const countRows = await c.var.db
      .select({ projectId: projectAssets.projectId, n: dsql<number>`count(*)::int` })
      .from(projectAssets)
      .where(inArray(projectAssets.projectId, ids))
      .groupBy(projectAssets.projectId);
    for (const r of countRows) counts.set(r.projectId, r.n);

    // Cover per project: the user's pinned asset when there is one,
    // otherwise the newest — which is how this behaved before pinning
    // existed, and is still the case for every project with a null pin.
    //
    // `COALESCE(..., false)` rather than a bare equality: comparing
    // against a NULL `cover_asset_id` yields NULL, and Postgres sorts
    // NULLs FIRST under DESC, which would hand every unpinned project an
    // arbitrary asset instead of its newest one.
    const coverRows = await c.var.db.execute<{
      project_id: string;
      kind: 'image' | 'video';
      r2_key: string;
      poster_r2_key: string | null;
    }>(dsql`
      SELECT DISTINCT ON (pa.project_id)
             pa.project_id, pa.kind, pa.r2_key, pa.poster_r2_key
      FROM project_assets pa
      JOIN projects p ON p.id = pa.project_id
      WHERE pa.project_id IN (${dsql.join(
        ids.map((id) => dsql`${id}::uuid`),
        dsql`, `,
      )})
      ORDER BY pa.project_id,
               COALESCE(p.cover_asset_id = pa.id, false) DESC,
               pa.created_at DESC, pa.id DESC
    `);
    // `neon-http` execute returns the row array directly (see job-create.ts).
    const coverList = Array.isArray(coverRows)
      ? coverRows
      : ((coverRows as { rows?: typeof coverRows.rows }).rows ?? []);
    for (const r of coverList) {
      covers.set(r.project_id, { kind: r.kind, r2Key: r.r2_key, posterR2Key: r.poster_r2_key });
    }
  }

  c.header('Cache-Control', 'private, max-age=5');
  return c.json({
    data: {
      folders: folderRows.map((f) => ({
        id: f.id,
        name: f.name,
        createdAt: f.createdAt.toISOString(),
      })),
      projects: page.map((p) => {
        const cover = covers.get(p.id) ?? null;
        return {
          id: p.id,
          name: p.name,
          folderId: p.folderId,
          assetCount: counts.get(p.id) ?? 0,
          cover: cover
            ? {
                kind: cover.kind,
                url: assetUrl(origin, cover.r2Key),
                posterUrl: cover.posterR2Key ? assetUrl(origin, cover.posterR2Key) : null,
              }
            : null,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        };
      }),
      nextCursor,
    },
  });
});

// ─── POST /v1/projects ──────────────────────────────────────────────
projectsRoute.post('/', ...writeChain, zValidator('json', createProjectSchema), async (c) => {
  const user = c.var.user!;
  const body = c.req.valid('json');

  // A provided folder must belong to the caller; a foreign/unknown id
  // 404s rather than silently filing into someone else's folder.
  if (body.folderId) {
    const owned = await c.var.db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, body.folderId), eq(folders.userId, user.id)))
      .limit(1);
    if (owned.length === 0) {
      return c.json({ error: { code: 'folder_not_found', message: 'Folder not found.' } }, 404);
    }
  }

  const [row] = await c.var.db
    .insert(projects)
    .values({
      userId: user.id,
      name: body.name ?? 'Untitled project',
      folderId: body.folderId ?? null,
    })
    .returning();

  return c.json(
    {
      data: {
        id: row!.id,
        name: row!.name,
        folderId: row!.folderId,
        assetCount: 0,
        cover: null,
        createdAt: row!.createdAt.toISOString(),
        updatedAt: row!.updatedAt.toISOString(),
      },
    },
    201,
  );
});

// ─── GET /v1/projects/:id/assets/:assetId ───────────────────────────
//
// Everything the studio's info panel shows about one asset. The asset
// row carries only its own dimensions and timestamps; how it was made
// lives on the originating job, so this joins across and flattens.
//
// `jobId` is nullable (ON DELETE SET NULL) and assets can be copied
// between projects, so `generation` is optional rather than assumed —
// an asset whose job has been pruned still renders, just without the
// provenance block.
projectsRoute.get('/:id/assets/:assetId', ...readChain, async (c) => {
  const user = c.var.user!;
  const projectId = c.req.param('id');
  const assetId = c.req.param('assetId');
  if (!isUuid(projectId) || !isUuid(assetId)) {
    return c.json({ error: { code: 'invalid_id', message: 'Malformed id.' } }, 400);
  }

  // Scoped by (asset, project, owner) in one predicate — a valid asset
  // id from another user's project must 404, not leak.
  const [row] = await c.var.db
    .select({
      id: projectAssets.id,
      kind: projectAssets.kind,
      r2Key: projectAssets.r2Key,
      posterR2Key: projectAssets.posterR2Key,
      width: projectAssets.width,
      height: projectAssets.height,
      durationSec: projectAssets.durationSec,
      createdAt: projectAssets.createdAt,
      jobId: projectAssets.jobId,
      libraryAssetId: projectAssets.libraryAssetId,
      projectId: projectAssets.projectId,
      favorited: dsql<boolean>`${favoriteAssets.assetId} IS NOT NULL`,
    })
    .from(projectAssets)
    .leftJoin(
      favoriteAssets,
      and(
        eq(favoriteAssets.assetId, projectAssets.id),
        eq(favoriteAssets.userId, user.id),
      ),
    )
    .where(
      and(
        eq(projectAssets.id, assetId),
        eq(projectAssets.projectId, projectId),
        eq(projectAssets.userId, user.id),
      ),
    )
    .limit(1);

  if (!row) {
    return c.json({ error: { code: 'asset_not_found', message: 'Asset not found.' } }, 404);
  }

  const origin = new URL(c.req.url).origin;
  let generation: AssetGeneration | null = null;

  if (row.jobId) {
    const [job] = await c.var.db
      .select({
        source: jobs.source,
        modelKey: jobs.modelKey,
        inputs: jobs.inputs,
        options: jobs.options,
        templateId: jobs.templateId,
      })
      .from(jobs)
      .where(and(eq(jobs.id, row.jobId), eq(jobs.userId, user.id)))
      .limit(1);

    if (job) {
      // `options` is wider on the wire than its column annotation: the
      // create flow also persists the resolved quality tier and the
      // sound toggle.
      const opts = (job.options ?? {}) as {
        aspectRatio?: string;
        duration?: number;
        sound?: boolean;
        mode?: string;
      };
      const inputs = (job.inputs ?? {}) as Record<string, JobInputValue>;

      // Template prompts are ours, not the user's — surface the template
      // by name and withhold the prompt text itself.
      const isTemplate = job.source === 'template';
      let templateTitle: string | null = null;
      if (isTemplate && job.templateId) {
        const [tpl] = await c.var.db
          .select({ title: templates.title })
          .from(templates)
          .where(eq(templates.id, job.templateId))
          .limit(1);
        templateTitle = tpl?.title ?? null;
      }

      const promptInput = inputs[CREATE_PROMPT_KEY];
      const caps = job.modelKey ? findCapabilities(job.modelKey) : undefined;

      // Every image the user supplied, in the order the model saw it.
      const refs: AssetGeneration['references'] = [];
      const pushRef = (key: string, role: 'start_frame' | 'end_frame' | 'reference') => {
        const v = inputs[key];
        if (v && (v.kind === 'image' || v.kind === 'video') && v.r2Key) {
          refs.push({ role, url: mediaUrl(origin, v.r2Key) });
        }
      };
      pushRef(CREATE_START_FRAME_KEY, 'start_frame');
      pushRef(CREATE_END_FRAME_KEY, 'end_frame');
      for (let i = 0; i < MAX_LISTED_REFERENCES; i += 1) {
        pushRef(createReferenceKey(i), 'reference');
      }

      generation = {
        source: job.source,
        prompt:
          !isTemplate && promptInput?.kind === 'text' ? (promptInput.value ?? null) : null,
        templateTitle,
        modelKey: job.modelKey,
        modelName: caps?.displayName ?? job.modelKey,
        aspectRatio: opts.aspectRatio ?? null,
        quality: opts.mode ?? null,
        duration: opts.duration ?? null,
        sound: typeof opts.sound === 'boolean' ? opts.sound : null,
        references: refs,
      };
    }
  }

  return c.json({
    data: {
      id: row.id,
      projectId: row.projectId,
      jobId: row.jobId,
      kind: row.kind,
      url: assetUrl(origin, row.r2Key),
      posterUrl: row.posterR2Key ? assetUrl(origin, row.posterR2Key) : null,
      width: row.width,
      height: row.height,
      durationSec: row.durationSec,
      createdAt: row.createdAt.toISOString(),
      isFavorited: row.favorited,
      fromLibrary: row.libraryAssetId != null,
      // No MIME column exists; the stored key keeps its extension.
      format: formatFromKey(row.r2Key),
      generation,
    },
  });
});

// ─── PATCH /v1/projects/:id ─────────────────────────────────────────
projectsRoute.patch('/:id', ...writeChain, zValidator('json', updateProjectSchema), async (c) => {
  const user = c.var.user!;
  const projectId = c.req.param('id');
  if (!isUuid(projectId)) {
    return c.json({ error: { code: 'invalid_project_id', message: 'Malformed project id.' } }, 400);
  }
  const body = c.req.valid('json');

  if (body.folderId) {
    const owned = await c.var.db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, body.folderId), eq(folders.userId, user.id)))
      .limit(1);
    if (owned.length === 0) {
      return c.json({ error: { code: 'folder_not_found', message: 'Folder not found.' } }, 404);
    }
  }

  // The pinned cover must be an asset that lives in THIS project —
  // otherwise a valid uuid from someone else's project would render as
  // this project's thumbnail. Scoped by project, and the project itself
  // is scoped by owner in the UPDATE below.
  if (body.coverAssetId) {
    const owned = await c.var.db
      .select({ id: projectAssets.id })
      .from(projectAssets)
      .where(
        and(eq(projectAssets.id, body.coverAssetId), eq(projectAssets.projectId, projectId)),
      )
      .limit(1);
    if (owned.length === 0) {
      return c.json(
        { error: { code: 'asset_not_found', message: 'Asset not found in this project.' } },
        404,
      );
    }
  }

  const [row] = await c.var.db
    .update(projects)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
      ...(body.coverAssetId !== undefined ? { coverAssetId: body.coverAssetId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .returning();

  if (!row) {
    return c.json({ error: { code: 'project_not_found', message: 'Project not found.' } }, 404);
  }
  return c.json({
    data: {
      id: row.id,
      name: row.name,
      folderId: row.folderId,
      updatedAt: row.updatedAt.toISOString(),
    },
  });
});

// ─── DELETE /v1/projects/:id ────────────────────────────────────────
// Hard delete; `project_assets` rows cascade, `jobs.project_id` nulls.
// R2 objects are untouched (retention crons own storage cleanup).
projectsRoute.delete('/:id', ...writeChain, async (c) => {
  const user = c.var.user!;
  const projectId = c.req.param('id');
  if (!isUuid(projectId)) {
    return c.json({ error: { code: 'invalid_project_id', message: 'Malformed project id.' } }, 400);
  }
  await c.var.db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));
  return c.body(null, 204);
});

// ─── GET /v1/projects/:id/assets ────────────────────────────────────
projectsRoute.get('/:id/assets', ...readChain, async (c) => {
  const user = c.var.user!;
  const origin = new URL(c.req.url).origin;
  const projectId = c.req.param('id');
  if (!isUuid(projectId)) {
    return c.json({ error: { code: 'invalid_project_id', message: 'Malformed project id.' } }, 400);
  }

  const owned = await c.var.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (owned.length === 0) {
    return c.json({ error: { code: 'project_not_found', message: 'Project not found.' } }, 404);
  }

  const limitRaw = Number(c.req.query('limit') ?? '50');
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50));
  const keyset = parseKeysetCursor(c.req.query('cursor'));

  const rows = await c.var.db
    .select({
      row: projectAssets,
      // Full-precision cursor timestamp. A JS Date (what Drizzle parses
      // created_at into) truncates to milliseconds, but the column holds
      // microseconds — so a Date-built cursor's `= cursorTs` tie-break can
      // never match rows that share a microsecond (e.g. a bulk copyAssets
      // INSERT), silently dropping them at the page boundary. Emit the raw
      // text and compare against it as timestamptz to preserve precision.
      cursorTs: dsql<string>`${projectAssets.createdAt}::text`,
      // Heart state for THIS caller. A LEFT JOIN on the favorites PK is
      // an index probe per row; without it every heart renders empty on
      // load and only corrects itself after a toggle.
      favorited: dsql<boolean>`${favoriteAssets.assetId} IS NOT NULL`,
    })
    .from(projectAssets)
    .leftJoin(
      favoriteAssets,
      and(
        eq(favoriteAssets.assetId, projectAssets.id),
        eq(favoriteAssets.userId, user.id),
      ),
    )
    .where(
      keyset
        ? and(
            eq(projectAssets.projectId, projectId),
            dsql`(${projectAssets.createdAt} < ${keyset.ts}::timestamptz OR (${projectAssets.createdAt} = ${keyset.ts}::timestamptz AND ${projectAssets.id} < ${keyset.id}))`,
          )
        : eq(projectAssets.projectId, projectId),
    )
    .orderBy(desc(projectAssets.createdAt), desc(projectAssets.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? `${pageRows[pageRows.length - 1]!.cursorTs}|${pageRows[pageRows.length - 1]!.row.id}`
    : null;

  c.header('Cache-Control', 'private, max-age=5');
  return c.json({
    data: {
      items: pageRows.map(({ row: a, favorited }) => ({
        id: a.id,
        projectId: a.projectId,
        jobId: a.jobId,
        kind: a.kind,
        url: assetUrl(origin, a.r2Key),
        posterUrl: a.posterR2Key ? assetUrl(origin, a.posterR2Key) : null,
        width: a.width,
        height: a.height,
        durationSec: a.durationSec,
        createdAt: a.createdAt.toISOString(),
        isFavorited: favorited,
        // Placed from "My Assets" rather than generated. The canvas uses
        // this to label the tile and to hide Re-use, which has no meaning
        // without a prompt behind it.
        fromLibrary: a.libraryAssetId != null,
      })),
      nextCursor,
    },
  });
});

// ─── POST /v1/projects/:id/assets (copy) ────────────────────────────
projectsRoute.post(
  '/:id/assets',
  ...writeChain,
  zValidator('json', copyAssetsSchema),
  async (c) => {
    const user = c.var.user!;
    const projectId = c.req.param('id');
    if (!isUuid(projectId)) {
      return c.json(
        { error: { code: 'invalid_project_id', message: 'Malformed project id.' } },
        400,
      );
    }
    const { assetIds } = c.req.valid('json');

    const owned = await c.var.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);
    if (owned.length === 0) {
      return c.json({ error: { code: 'project_not_found', message: 'Project not found.' } }, 404);
    }

    // Copy = INSERT…SELECT of caller-owned source rows; duplicates in
    // the target (same job output already filed there) dedupe via the
    // unique triple — a no-op, not an error.
    const inserted = await c.var.db.execute<{ id: string }>(dsql`
      INSERT INTO project_assets
        (project_id, user_id, job_id, output_index, kind, r2_key, width, height, duration_sec, poster_r2_key)
      SELECT ${projectId}::uuid, user_id, job_id, output_index, kind, r2_key, width, height, duration_sec, poster_r2_key
      FROM project_assets
      WHERE id IN (${dsql.join(
        assetIds.map((id) => dsql`${id}::uuid`),
        dsql`, `,
      )}) AND user_id = ${user.id}::uuid
      ON CONFLICT (project_id, job_id, output_index) DO NOTHING
      RETURNING id
    `);

    await c.var.db
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    const copiedRows = Array.isArray(inserted)
      ? inserted
      : ((inserted as { rows?: unknown[] }).rows ?? []);
    return c.json({ data: { copied: copiedRows.length } }, 201);
  },
);

// ─── PATCH /v1/assets (bulk move) ───────────────────────────────────
assetsRoute.patch('/', ...writeChain, zValidator('json', moveAssetsSchema), async (c) => {
  const user = c.var.user!;
  const { assetIds, projectId } = c.req.valid('json');

  const owned = await c.var.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (owned.length === 0) {
    return c.json({ error: { code: 'project_not_found', message: 'Project not found.' } }, 404);
  }

  // Move = in-place `project_id` UPDATE, so the asset keeps its id.
  // That matters beyond tidiness: `favorite_assets.asset_id` references
  // it, and the previous copy-then-delete implementation minted a fresh
  // row per move — silently un-favoriting everything the user moved.
  //
  // The NOT EXISTS guard mirrors the `(project_id, job_id, output_index)`
  // unique index exactly, including its NULL semantics: `t.job_id =
  // src.job_id` yields NULL (not true) for job-less rows, which is
  // precisely when Postgres also treats them as non-conflicting. Rows the
  // guard excludes are true duplicates of something already in the target
  // and are deleted below — the same fate the old ON CONFLICT DO NOTHING
  // + unconditional DELETE gave them.
  const idList = dsql.join(
    assetIds.map((id) => dsql`${id}::uuid`),
    dsql`, `,
  );

  const updated = await c.var.db.execute<{ id: string }>(dsql`
    UPDATE project_assets AS src
    SET project_id = ${projectId}::uuid
    WHERE src.id IN (${idList})
      AND src.user_id = ${user.id}::uuid
      AND src.project_id != ${projectId}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM project_assets AS t
        WHERE t.project_id = ${projectId}::uuid
          AND t.job_id = src.job_id
          AND t.output_index = src.output_index
      )
    RETURNING src.id
  `);

  // A pinned cover follows the asset out of its old project. The FK's
  // ON DELETE SET NULL used to handle this for free, because the move
  // deleted the source row; an in-place move never fires it, so the
  // source project would keep a pin pointing at an asset it no longer
  // holds. (The cover query joins on `project_id`, so a stale pin can
  // only ever mean "fall back to newest" — never show a foreign asset —
  // but leaving it is still a lie in the data.)
  await c.var.db
    .update(projects)
    .set({ coverAssetId: null })
    .where(
      and(
        eq(projects.userId, user.id),
        inArray(projects.coverAssetId, assetIds),
        dsql`${projects.id} != ${projectId}::uuid`,
      ),
    );

  // Whatever is still outside the target after the UPDATE is a duplicate
  // of a row already filed there.
  await c.var.db
    .delete(projectAssets)
    .where(
      and(
        inArray(projectAssets.id, assetIds),
        eq(projectAssets.userId, user.id),
        dsql`${projectAssets.projectId} != ${projectId}::uuid`,
      ),
    );

  await c.var.db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

  const movedRows = Array.isArray(updated)
    ? updated
    : ((updated as { rows?: unknown[] }).rows ?? []);
  return c.json({ data: { moved: movedRows.length } });
});

// ─── Favorites (global, cross-project) ──────────────────────────────
//
// GET    /v1/assets/favorites   the caller's hearted assets, newest
//                               FAVORITE first (not newest asset —
//                               hearting something old should put it at
//                               the top of the shelf you just put it on)
// POST   /v1/assets/favorites   { assetIds } → favorite
// DELETE /v1/assets/favorites   { assetIds } → unfavorite
//
// Both writes are bulk-only and idempotent: the composite PK on
// `favorite_assets` makes a re-favorite a no-op insert, and unfavoriting
// something that was never favorited deletes zero rows rather than
// erroring. `assetIds` is filtered by `user_id` in the same statement, so
// a foreign id silently contributes nothing instead of 404-ing and
// leaking whether it exists.

assetsRoute.get('/favorites', ...readChain, async (c) => {
  const user = c.var.user!;
  const origin = new URL(c.req.url).origin;

  const limitRaw = Number(c.req.query('limit') ?? '50');
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50));
  // Keyset over the FAVORITE's timestamp, not the asset's — same
  // full-precision `::text` cursor as everywhere else in this file.
  const keyset = parseKeysetCursor(c.req.query('cursor'));

  const rows = await c.var.db
    .select({
      row: projectAssets,
      projectName: projects.name,
      cursorTs: dsql<string>`${favoriteAssets.createdAt}::text`,
    })
    .from(favoriteAssets)
    .innerJoin(projectAssets, eq(projectAssets.id, favoriteAssets.assetId))
    .innerJoin(projects, eq(projects.id, projectAssets.projectId))
    .where(
      keyset
        ? and(
            eq(favoriteAssets.userId, user.id),
            dsql`(${favoriteAssets.createdAt} < ${keyset.ts}::timestamptz OR (${favoriteAssets.createdAt} = ${keyset.ts}::timestamptz AND ${favoriteAssets.assetId} < ${keyset.id}))`,
          )
        : eq(favoriteAssets.userId, user.id),
    )
    .orderBy(desc(favoriteAssets.createdAt), desc(favoriteAssets.assetId))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? `${pageRows[pageRows.length - 1]!.cursorTs}|${pageRows[pageRows.length - 1]!.row.id}`
    : null;

  c.header('Cache-Control', 'private, max-age=5');
  return c.json({
    data: {
      items: pageRows.map(({ row: a, projectName }) => ({
        id: a.id,
        projectId: a.projectId,
        jobId: a.jobId,
        kind: a.kind,
        url: assetUrl(origin, a.r2Key),
        posterUrl: a.posterR2Key ? assetUrl(origin, a.posterR2Key) : null,
        width: a.width,
        height: a.height,
        durationSec: a.durationSec,
        createdAt: a.createdAt.toISOString(),
        // Every row here is favorited by definition; sent anyway so the
        // DTO is identical to the project asset list and the studio can
        // render both through one component.
        isFavorited: true,
          // Same reason as the project list: a favourited library file
          // has no prompt behind it either, so this view hides Re-use too.
          fromLibrary: a.libraryAssetId != null,
        // Cross-project view, so each tile says where it came from.
        projectName,
      })),
      nextCursor,
    },
  });
});

assetsRoute.post(
  '/favorites',
  ...writeChain,
  zValidator('json', favoriteAssetsSchema),
  async (c) => {
    const user = c.var.user!;
    const { assetIds } = c.req.valid('json');

    // INSERT … SELECT rather than a client-side values list: ownership is
    // enforced by the same statement that writes, so there is no window
    // between checking and inserting.
    await c.var.db.execute(dsql`
      INSERT INTO favorite_assets (user_id, asset_id)
      SELECT user_id, id FROM project_assets
      WHERE id IN (${dsql.join(
        assetIds.map((id) => dsql`${id}::uuid`),
        dsql`, `,
      )}) AND user_id = ${user.id}::uuid
      ON CONFLICT (user_id, asset_id) DO NOTHING
    `);

    return c.json({ data: { assetIds, isFavorited: true } });
  },
);

assetsRoute.delete(
  '/favorites',
  ...writeChain,
  zValidator('json', favoriteAssetsSchema),
  async (c) => {
    const user = c.var.user!;
    const { assetIds } = c.req.valid('json');

    await c.var.db
      .delete(favoriteAssets)
      .where(
        and(eq(favoriteAssets.userId, user.id), inArray(favoriteAssets.assetId, assetIds)),
      );

    return c.json({ data: { assetIds, isFavorited: false } });
  },
);

// ─── DELETE /v1/assets (bulk) ───────────────────────────────────────
assetsRoute.delete('/', ...writeChain, zValidator('json', deleteAssetsSchema), async (c) => {
  const user = c.var.user!;
  const { assetIds } = c.req.valid('json');
  await c.var.db
    .delete(projectAssets)
    .where(and(inArray(projectAssets.id, assetIds), eq(projectAssets.userId, user.id)));
  return c.body(null, 204);
});

// ─── Folders ────────────────────────────────────────────────────────

foldersRoute.post('/', ...writeChain, zValidator('json', createFolderSchema), async (c) => {
  const user = c.var.user!;
  const { name } = c.req.valid('json');
  const [row] = await c.var.db.insert(folders).values({ userId: user.id, name }).returning();
  return c.json(
    { data: { id: row!.id, name: row!.name, createdAt: row!.createdAt.toISOString() } },
    201,
  );
});

foldersRoute.patch('/:id', ...writeChain, zValidator('json', updateFolderSchema), async (c) => {
  const user = c.var.user!;
  const folderId = c.req.param('id');
  if (!isUuid(folderId)) {
    return c.json({ error: { code: 'invalid_folder_id', message: 'Malformed folder id.' } }, 400);
  }
  const { name } = c.req.valid('json');
  const [row] = await c.var.db
    .update(folders)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(folders.id, folderId), eq(folders.userId, user.id)))
    .returning();
  if (!row) {
    return c.json({ error: { code: 'folder_not_found', message: 'Folder not found.' } }, 404);
  }
  return c.json({ data: { id: row.id, name: row.name } });
});

// Projects inside fall back to "unfiled" (FK SET NULL) — never deleted.
foldersRoute.delete('/:id', ...writeChain, async (c) => {
  const user = c.var.user!;
  const folderId = c.req.param('id');
  if (!isUuid(folderId)) {
    return c.json({ error: { code: 'invalid_folder_id', message: 'Malformed folder id.' } }, 400);
  }
  await c.var.db
    .delete(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, user.id)));
  return c.body(null, 204);
});
