/**
 * Zod schemas for the projects/folders surface (`/v1/projects`,
 * `/v1/folders`, `/v1/assets`). Same pattern as `job-schemas.ts`:
 * object schemas + inferred types, consumed via `zValidator('json', …)`.
 */

import { z } from 'zod';

const nameSchema = z.string().trim().min(1).max(120);

export const createProjectSchema = z.object({
  /** Defaults server-side to "Untitled project" when omitted. */
  name: nameSchema.optional(),
  folderId: z.string().uuid().nullish(),
});
export type CreateProjectBody = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: nameSchema.optional(),
    /** `null` explicitly unfiles the project. */
    folderId: z.string().uuid().nullable().optional(),
    /**
     * Pinned cover asset. `null` clears the pin and returns the project
     * to deriving its cover from the newest asset. Ownership of the
     * asset is verified in the handler.
     */
    coverAssetId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.folderId !== undefined || v.coverAssetId !== undefined,
    { message: 'Provide name, folderId and/or coverAssetId.' },
  );
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;

export const createFolderSchema = z.object({ name: nameSchema });
export type CreateFolderBody = z.infer<typeof createFolderSchema>;

export const updateFolderSchema = z.object({ name: nameSchema });
export type UpdateFolderBody = z.infer<typeof updateFolderSchema>;

const assetIdsSchema = z.array(z.string().uuid()).min(1).max(100);

export const copyAssetsSchema = z.object({ assetIds: assetIdsSchema });
export type CopyAssetsBody = z.infer<typeof copyAssetsSchema>;

export const moveAssetsSchema = z.object({
  assetIds: assetIdsSchema,
  projectId: z.string().uuid(),
});
export type MoveAssetsBody = z.infer<typeof moveAssetsSchema>;

export const deleteAssetsSchema = z.object({ assetIds: assetIdsSchema });
export type DeleteAssetsBody = z.infer<typeof deleteAssetsSchema>;
