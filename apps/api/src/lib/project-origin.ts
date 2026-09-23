/**
 * A project is born the moment its FIRST job is filed into it.
 *
 * Clients create the project row before they submit (the studio and the
 * mobile composer alike), so the row itself knows nothing about what it
 * is for. The first job does: a template run makes a template-born
 * project, a tool run a tool-born one, and the composer's prompt jobs
 * leave the default 'create' in place. Later jobs never relabel — the
 * origin is about birth, not contents.
 *
 * Template-born projects also take the template's title while they
 * still carry the server default name, the same courtesy the create
 * path extends with `titleFromPrompt`. A name the user chose survives.
 *
 * Runs AFTER the job is committed and is cosmetic by contract: a paid
 * generation is never failed over a label.
 */

import { and, eq, ne, not, exists, sql } from 'drizzle-orm';

import { jobs, projects, type Db } from '@clickfy/db';
import type { JobOrigin } from '@clickfy/types';

import { DEFAULT_PROJECT_NAME } from './project-title';

export async function adoptProjectOrigin(
  db: Db,
  args: {
    projectId: string;
    userId: string;
    /** The job just filed — the only one allowed to exist for this to apply. */
    jobId: string;
    origin: JobOrigin;
    templateId?: string | null;
    templateTitle?: string | null;
  },
): Promise<void> {
  const { projectId, userId, jobId, origin, templateId, templateTitle } = args;
  const rename = origin === 'template' && templateTitle ? templateTitle : null;
  try {
    await db
      .update(projects)
      .set({
        origin,
        originTemplateId: origin === 'template' ? (templateId ?? null) : null,
        // Only the default name yields; anything else was the user's choice.
        ...(rename
          ? { name: sql`CASE WHEN ${projects.name} = ${DEFAULT_PROJECT_NAME} THEN ${rename} ELSE ${projects.name} END` }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.userId, userId),
          // First job only: no OTHER job may already be filed here.
          not(
            exists(
              db
                .select({ one: sql`1` })
                .from(jobs)
                .where(and(eq(jobs.projectId, projectId), ne(jobs.id, jobId))),
            ),
          ),
        ),
      );
  } catch (err) {
    console.error('adoptProjectOrigin failed:', err);
  }
}
