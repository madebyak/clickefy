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
 *
 * Ownership: every query is compound-scoped `(id, user_id)` so foreign
 * ids no-op (404/204) instead of leaking existence — house convention.
 *
 * Move is implemented as copy-then-delete (fresh rows) so the
 * `(project_id, job_id, output_index)` uniqueness can never abort a
 * bulk move; duplicates in the target dedupe silently.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, inArray, lt, or, sql as dsql } from 'drizzle-orm';

import { folders, jobs, projectAssets, projects } from '@clickfy/db';

import type { AppEnv } from '../types';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import {
  copyAssetsSchema,
  createFolderSchema,
  createProjectSchema,
  deleteAssetsSchema,
  moveAssetsSchema,
  updateFolderSchema,
  updateProjectSchema,
} from '../lib/project-schemas';

export const projectsRoute = new Hono<AppEnv>();
export const foldersRoute = new Hono<AppEnv>();
export const assetsRoute = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);

/** Mint a delivery URL for an asset r2Key against the live origin. */
const assetUrl = (origin: string, r2Key: string) => `${origin}/v1/outputs/${r2Key}`;

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
  const cursor = c.req.query('cursor');

  let cursorTs: Date | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    const idx = cursor.indexOf('|');
    if (idx > 0) {
      const ts = new Date(cursor.slice(0, idx));
      const id = cursor.slice(idx + 1);
      if (!Number.isNaN(ts.getTime()) && id) {
        cursorTs = ts;
        cursorId = id;
      }
    }
  }

  const folderRows = await c.var.db
    .select()
    .from(folders)
    .where(eq(folders.userId, user.id))
    .orderBy(desc(folders.createdAt));

  const projectRows = await c.var.db
    .select()
    .from(projects)
    .where(
      cursorTs && cursorId
        ? and(
            eq(projects.userId, user.id),
            or(
              lt(projects.updatedAt, cursorTs),
              and(eq(projects.updatedAt, cursorTs), lt(projects.id, cursorId)),
            ),
          )
        : eq(projects.userId, user.id),
    )
    .orderBy(desc(projects.updatedAt), desc(projects.id))
    .limit(limit + 1);

  const hasMore = projectRows.length > limit;
  const page = hasMore ? projectRows.slice(0, limit) : projectRows;
  const nextCursor = hasMore
    ? `${page[page.length - 1]!.updatedAt.toISOString()}|${page[page.length - 1]!.id}`
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

    // Newest asset per project (cover) — DISTINCT ON matches the
    // pagination index ordering.
    const coverRows = await c.var.db.execute<{
      project_id: string;
      kind: 'image' | 'video';
      r2_key: string;
      poster_r2_key: string | null;
    }>(dsql`
      SELECT DISTINCT ON (project_id) project_id, kind, r2_key, poster_r2_key
      FROM project_assets
      WHERE project_id IN (${dsql.join(
        ids.map((id) => dsql`${id}::uuid`),
        dsql`, `,
      )})
      ORDER BY project_id, created_at DESC, id DESC
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

  const [row] = await c.var.db
    .update(projects)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
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
  const cursor = c.req.query('cursor');
  let cursorTs: Date | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    const idx = cursor.indexOf('|');
    if (idx > 0) {
      const ts = new Date(cursor.slice(0, idx));
      const id = cursor.slice(idx + 1);
      if (!Number.isNaN(ts.getTime()) && id) {
        cursorTs = ts;
        cursorId = id;
      }
    }
  }

  const rows = await c.var.db
    .select()
    .from(projectAssets)
    .where(
      cursorTs && cursorId
        ? and(
            eq(projectAssets.projectId, projectId),
            or(
              lt(projectAssets.createdAt, cursorTs),
              and(eq(projectAssets.createdAt, cursorTs), lt(projectAssets.id, cursorId)),
            ),
          )
        : eq(projectAssets.projectId, projectId),
    )
    .orderBy(desc(projectAssets.createdAt), desc(projectAssets.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? `${page[page.length - 1]!.createdAt.toISOString()}|${page[page.length - 1]!.id}`
    : null;

  c.header('Cache-Control', 'private, max-age=5');
  return c.json({
    data: {
      items: page.map((a) => ({
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

  // Move = copy-then-delete (fresh rows) so target-side uniqueness can
  // never abort the bulk operation; colliding rows simply dedupe.
  const inserted = await c.var.db.execute<{ id: string }>(dsql`
    INSERT INTO project_assets
      (project_id, user_id, job_id, output_index, kind, r2_key, width, height, duration_sec, poster_r2_key)
    SELECT ${projectId}::uuid, user_id, job_id, output_index, kind, r2_key, width, height, duration_sec, poster_r2_key
    FROM project_assets
    WHERE id IN (${dsql.join(
      assetIds.map((id) => dsql`${id}::uuid`),
      dsql`, `,
    )}) AND user_id = ${user.id}::uuid AND project_id != ${projectId}::uuid
    ON CONFLICT (project_id, job_id, output_index) DO NOTHING
    RETURNING id
  `);

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

  const movedRows = Array.isArray(inserted)
    ? inserted
    : ((inserted as { rows?: unknown[] }).rows ?? []);
  return c.json({ data: { moved: movedRows.length } });
});

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
