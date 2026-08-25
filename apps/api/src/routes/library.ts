/**
 * `/v1/library` — "My Assets", a durable per-user media library.
 *
 * WHAT IT IS NOT
 *   Not an upload endpoint. Bytes still go through `POST /v1/uploads/user`
 *   exactly as a prompt attachment does, and this route only REGISTERS the
 *   resulting object. Keeping one upload path means one place enforces MIME
 *   allowlists, size caps and content sniffing, instead of two that drift.
 *
 * WHAT IT OWNS
 *   The folder tree (three levels, enforced by the database — see 0034),
 *   the file rows, and the per-plan storage quota.
 *
 * QUOTA IS CHECKED TWICE, on purpose:
 *   - `POST /register` refuses a file that would exceed the plan. That is
 *     the enforcement.
 *   - `GET /usage` lets the client refuse BEFORE uploading, so someone on a
 *     slow connection is told at once rather than after three minutes of
 *     upload.
 *   The client check is a courtesy; the server check is the rule. Neither
 *   is redundant, because only the server sees concurrent uploads.
 */

import { Hono } from 'hono';
import { and, asc, desc, eq, inArray, isNull, sql as dsql } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { assetFolders, libraryAssets } from '@clickfy/db';
import { fitsInQuota, storageQuotaFor } from '@clickfy/types';

import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const libraryRoute = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);

/** Deepest folder level. 0-indexed, so 2 means three levels. */
const MAX_DEPTH = 2;

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

/** Bytes this user's library currently occupies. */
async function usedBytes(db: AppEnv['Variables']['db'], userId: string): Promise<number> {
  const [row] = await db
    .select({ total: dsql<string>`COALESCE(SUM(${libraryAssets.sizeBytes}), 0)` })
    .from(libraryAssets)
    .where(eq(libraryAssets.userId, userId));
  // SUM over a bigint returns numeric, which the driver hands back as a
  // STRING. `0 !== "0"` has bitten this codebase before — coerce here.
  return Number(row?.total ?? 0);
}

function publicUrl(origin: string, key: string): string {
  return `${origin}/v1/uploads/${key}`;
}

// ─── Tree + files ───────────────────────────────────────────────────

/**
 * `GET /v1/library` — the whole tree and every file.
 *
 * Returned WHOLE rather than paginated per folder. A media library is
 * browsed by moving between folders constantly, and a request per hop
 * makes that feel like a website instead of a file manager. The payload is
 * small: rows carry keys and dimensions, never bytes.
 */
libraryRoute.get('/', ...readChain, async (c) => {
  const user = c.var.user!;
  const origin = new URL(c.req.url).origin;

  const [folderRows, assetRows, used] = await Promise.all([
    c.var.db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.userId, user.id))
      .orderBy(asc(assetFolders.depth), asc(assetFolders.createdAt)),
    c.var.db
      .select()
      .from(libraryAssets)
      .where(eq(libraryAssets.userId, user.id))
      .orderBy(desc(libraryAssets.createdAt)),
    usedBytes(c.var.db, user.id),
  ]);

  const quotaBytes = storageQuotaFor(user.entitlement);

  return c.json({
    data: {
      folders: folderRows.map((f) => ({
        id: f.id,
        parentId: f.parentId,
        name: f.name,
        depth: f.depth,
        createdAt: f.createdAt.toISOString(),
      })),
      assets: assetRows.map((a) => ({
        id: a.id,
        folderId: a.folderId,
        name: a.name,
        kind: a.kind,
        url: publicUrl(origin, a.r2Key),
        r2Key: a.r2Key,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        width: a.width,
        height: a.height,
        durationSeconds: a.durationSeconds != null ? Number(a.durationSeconds) : null,
        createdAt: a.createdAt.toISOString(),
      })),
      usage: { usedBytes: used, quotaBytes },
    },
  });
});

/** `GET /v1/library/usage` — cheap enough to call before every upload. */
libraryRoute.get('/usage', ...readChain, async (c) => {
  const user = c.var.user!;
  return c.json({
    data: {
      usedBytes: await usedBytes(c.var.db, user.id),
      quotaBytes: storageQuotaFor(user.entitlement),
    },
  });
});

// ─── Folders ────────────────────────────────────────────────────────

const createFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    /** Omit or null for a top-level folder. */
    parentId: z.string().uuid().nullable().optional(),
  })
  .strict();

libraryRoute.post('/folders', ...writeChain, zValidator('json', createFolderSchema), async (c) => {
  const user = c.var.user!;
  const { name, parentId } = c.req.valid('json');

  let depth = 0;
  if (parentId) {
    const parent = await c.var.db.query.assetFolders.findFirst({
      where: and(eq(assetFolders.id, parentId), eq(assetFolders.userId, user.id)),
    });
    if (!parent) {
      return c.json({ error: { code: 'parent_not_found', message: 'Folder not found.' } }, 404);
    }
    if (parent.depth >= MAX_DEPTH) {
      // The database would refuse this too — the composite FK makes a
      // fourth level unrepresentable. Answering here turns a constraint
      // violation into a message the UI can actually show.
      return c.json(
        {
          error: {
            code: 'max_depth',
            message: 'Folders can only be three levels deep.',
          },
        },
        409,
      );
    }
    depth = parent.depth + 1;
  }

  const [row] = await c.var.db
    .insert(assetFolders)
    .values({ userId: user.id, parentId: parentId ?? null, name, depth })
    .returning();

  return c.json(
    {
      data: {
        id: row!.id,
        parentId: row!.parentId,
        name: row!.name,
        depth: row!.depth,
        createdAt: row!.createdAt.toISOString(),
      },
    },
    201,
  );
});

const updateFolderSchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();

/**
 * Rename only. MOVING a folder is deliberately not offered: a move changes
 * the depth of the folder AND everything beneath it, which is a recursive
 * rewrite that the composite foreign key will reject halfway through if any
 * descendant would land below the limit. Renaming covers the need people
 * actually have; moving can come with the sub-tree rewrite it requires.
 */
libraryRoute.patch('/folders/:id', ...writeChain, zValidator('json', updateFolderSchema), async (c) => {
  const user = c.var.user!;
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404);

  const [row] = await c.var.db
    .update(assetFolders)
    .set({ name: c.req.valid('json').name, updatedAt: new Date() })
    .where(and(eq(assetFolders.id, id), eq(assetFolders.userId, user.id)))
    .returning();

  if (!row) return c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
  return c.json({ data: { id: row.id, name: row.name } });
});

/**
 * Delete a folder.
 *
 * Sub-folders cascade; their FILES do not. `library_assets.folder_id` is
 * ON DELETE SET NULL, so everything inside reappears at the library root.
 * Deleting a folder is a filing decision, not a decision to destroy the
 * media — and a user who wanted the files gone can select and delete them.
 */
libraryRoute.delete('/folders/:id', ...writeChain, async (c) => {
  const user = c.var.user!;
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404);

  const [row] = await c.var.db
    .delete(assetFolders)
    .where(and(eq(assetFolders.id, id), eq(assetFolders.userId, user.id)))
    .returning();

  if (!row) return c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
  return c.json({ data: { id: row.id } });
});

// ─── Files ──────────────────────────────────────────────────────────

const registerSchema = z
  .object({
    r2Key: z.string().min(1).max(400),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(['image', 'video']),
    mimeType: z.string().min(1).max(120),
    sizeBytes: z.number().int().positive(),
    folderId: z.string().uuid().nullable().optional(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
    durationSeconds: z.number().nonnegative().nullable().optional(),
  })
  .strict();

/**
 * `POST /v1/library/register` — file an already-uploaded object.
 *
 * The key must live under this user's own upload prefix. Without that check
 * a caller could register someone else's object and both see it and count
 * it against their own quota.
 */
libraryRoute.post('/register', ...writeChain, zValidator('json', registerSchema), async (c) => {
  const user = c.var.user!;
  const body = c.req.valid('json');
  const origin = new URL(c.req.url).origin;

  const expectedPrefix = `user-uploads/${user.id}/`;
  if (!body.r2Key.startsWith(expectedPrefix)) {
    return c.json(
      { error: { code: 'foreign_key_prefix', message: 'That upload does not belong to you.' } },
      403,
    );
  }

  if (body.folderId) {
    const folder = await c.var.db.query.assetFolders.findFirst({
      where: and(eq(assetFolders.id, body.folderId), eq(assetFolders.userId, user.id)),
    });
    if (!folder) {
      return c.json({ error: { code: 'folder_not_found', message: 'Folder not found.' } }, 404);
    }
  }

  const quotaBytes = storageQuotaFor(user.entitlement);
  const used = await usedBytes(c.var.db, user.id);
  if (!fitsInQuota(used, quotaBytes, body.sizeBytes)) {
    return c.json(
      {
        error: {
          code: 'quota_exceeded',
          message: 'This upload would exceed your storage allowance.',
          details: { usedBytes: used, quotaBytes, incomingBytes: body.sizeBytes },
        },
      },
      409,
    );
  }

  const [row] = await c.var.db
    .insert(libraryAssets)
    .values({
      userId: user.id,
      folderId: body.folderId ?? null,
      name: body.name,
      kind: body.kind,
      r2Key: body.r2Key,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      width: body.width ?? null,
      height: body.height ?? null,
      durationSeconds: body.durationSeconds != null ? String(body.durationSeconds) : null,
    })
    // Re-registering the same object is a no-op rather than a second row
    // silently double-counting against the quota.
    .onConflictDoNothing({ target: libraryAssets.r2Key })
    .returning();

  if (!row) {
    return c.json(
      { error: { code: 'already_registered', message: 'That file is already in your library.' } },
      409,
    );
  }

  return c.json(
    {
      data: {
        id: row.id,
        folderId: row.folderId,
        name: row.name,
        kind: row.kind,
        url: publicUrl(origin, row.r2Key),
        r2Key: row.r2Key,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        width: row.width,
        height: row.height,
        durationSeconds: row.durationSeconds != null ? Number(row.durationSeconds) : null,
        createdAt: row.createdAt.toISOString(),
      },
    },
    201,
  );
});

const updateAssetSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    /** `null` moves it back to the library root. */
    folderId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.folderId !== undefined, {
    message: 'Nothing to update.',
  });

libraryRoute.patch('/assets/:id', ...writeChain, zValidator('json', updateAssetSchema), async (c) => {
  const user = c.var.user!;
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
  const body = c.req.valid('json');

  if (body.folderId) {
    const folder = await c.var.db.query.assetFolders.findFirst({
      where: and(eq(assetFolders.id, body.folderId), eq(assetFolders.userId, user.id)),
    });
    if (!folder) {
      return c.json({ error: { code: 'folder_not_found', message: 'Folder not found.' } }, 404);
    }
  }

  const [row] = await c.var.db
    .update(libraryAssets)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(libraryAssets.id, id), eq(libraryAssets.userId, user.id)))
    .returning();

  if (!row) return c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
  return c.json({ data: { id: row.id, name: row.name, folderId: row.folderId } });
});

const deleteAssetsSchema = z
  .object({ assetIds: z.array(z.string().uuid()).min(1).max(200) })
  .strict();

/**
 * Delete files, and the R2 objects behind them.
 *
 * THE ROW GOES FIRST. If R2 fails afterwards the object is orphaned, which
 * costs storage nobody is charged for; if the object went first and the row
 * delete failed, the library would list a file that 404s. An invisible
 * cost beats a visible lie, and orphans are sweepable later.
 *
 * NOTE a past generation that used one of these as a reference keeps the
 * key recorded in its job input. Deleting here breaks that thumbnail — the
 * same as deleting any upload does today.
 */
libraryRoute.post('/assets/delete', ...writeChain, zValidator('json', deleteAssetsSchema), async (c) => {
  const user = c.var.user!;
  const { assetIds } = c.req.valid('json');

  const rows = await c.var.db
    .delete(libraryAssets)
    .where(and(eq(libraryAssets.userId, user.id), inArray(libraryAssets.id, assetIds)))
    .returning();

  // The rows are already gone, so a missing binding costs storage rather
  // than correctness — log it and let the caller succeed.
  const bucket = c.env.UPLOADS;
  if (bucket) {
    await Promise.all(
      rows.map((r) =>
        bucket.delete(r.r2Key).catch((err) => {
          console.error('[library] R2 delete failed, object orphaned', r.r2Key, err);
        }),
      ),
    );
  } else {
    console.error('[library] UPLOADS binding missing — orphaned', rows.length, 'object(s)');
  }

  return c.json({ data: { deleted: rows.length } });
});

// ─── Root listing helper ────────────────────────────────────────────

/**
 * `GET /v1/library/root` — files with no folder.
 *
 * Exists so a client that only wants the unfiled tray does not have to
 * fetch the whole library to find it.
 */
libraryRoute.get('/root', ...readChain, async (c) => {
  const user = c.var.user!;
  const origin = new URL(c.req.url).origin;
  const rows = await c.var.db
    .select()
    .from(libraryAssets)
    .where(and(eq(libraryAssets.userId, user.id), isNull(libraryAssets.folderId)))
    .orderBy(desc(libraryAssets.createdAt));

  return c.json({
    data: rows.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      url: publicUrl(origin, a.r2Key),
      r2Key: a.r2Key,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});
