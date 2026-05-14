/**
 * `/v1/reports` — user-facing content flag endpoint.
 *
 * One POST per "this content is bad" tap from mobile. Returns 202
 * Accepted because the report is intentionally fire-and-forget from
 * the user's perspective: we never tell the reporter what we did
 * with it. Telling them "we removed it" would deanonymise the
 * reporting flow and tip off the reporter when reports were
 * dismissed.
 *
 * Admin-side triage lives in `routes/admin-reports.ts`.
 *
 * Auth: required. We never want anonymous reports — they're useless
 * for rate-limiting abuse and offer no follow-up path. Clerk session
 * is enough; we do NOT require the reporter to own the target.
 *
 * Rate-limit: user-write. A user firing 100 reports/min is either
 * abusing the queue or running a script. 30/min (the global write
 * tier) is plenty for a real human flagging a few pieces of content
 * in one session.
 *
 * Idempotency: the database has no uniqueness constraint on
 * (reporter, target, reason) — a determined user can submit
 * duplicates. We accept this trade-off because (a) duplicates are
 * cheap to ignore at triage time and (b) sometimes a user adds new
 * context with `notes` after seeing the content again. Admin UI
 * collapses duplicates in the queue view.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { reports } from '@clickfy/db';

import { byClerkUserId, withRateLimit } from './../middleware/with-rate-limit';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
import type { AppEnv } from '../types';

export const reportsRoute = new Hono<AppEnv>();

const ReportInputSchema = z.object({
  targetType: z.enum(['job_output', 'template', 'user']),
  // For job_output the format is `${jobId}:${outputIndex}` so the
  // admin queue can deep-link to one specific image in a multi-output
  // job. For template/user it's a bare uuid. We don't enforce the
  // shape here because targetType + targetId is treated as an opaque
  // tuple downstream.
  targetId: z.string().min(1).max(200),
  reason: z.enum([
    'csam',
    'sexual_content',
    'violence_or_threats',
    'hate_speech',
    'harassment',
    'spam',
    'copyright',
    'other',
  ]),
  // Soft cap. The DB column is unbounded text, but anything over a
  // page of context is more useful in a support ticket than a report.
  notes: z.string().max(2000).optional(),
});

reportsRoute.post(
  '/',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const parsed = ReportInputSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'invalid_input',
            message: 'Report payload failed validation.',
            details: parsed.error.flatten(),
          },
        },
        400,
      );
    }

    const user = c.var.user!;
    const input = parsed.data;

    await c.var.db.insert(reports).values({
      reporterUserId: user.id,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      notes: input.notes ?? null,
    });

    // CSAM reports get a special log line so the on-call sweep can
    // grep for them in production logs. Eventually this should hook
    // into a NCMEC reporting workflow; for now an immediate page is
    // the bar to clear.
    if (input.reason === 'csam') {
      console.warn('[reports] CSAM report received', {
        reporterUserId: user.id,
        targetType: input.targetType,
        targetId: input.targetId,
      });
    }

    return c.body(null, 202);
  },
);
