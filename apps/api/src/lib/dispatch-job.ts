/**
 * `dispatchJob()` — fire a Trigger.dev run for a freshly-queued job.
 *
 * The Worker can't use `@trigger.dev/sdk` directly (it imports
 * `node:crypto` and a few other Node-only modules that Cloudflare's
 * `nodejs_compat` flag does not polyfill). Instead, we hit
 * Trigger.dev's HTTP API straight with `fetch` — the API is small,
 * stable, and avoids dragging the SDK's bundle weight into the
 * Worker.
 *
 * Endpoint shape (v3):
 *
 *   POST https://api.trigger.dev/api/v1/tasks/{taskIdentifier}/trigger
 *   Authorization: Bearer <TRIGGER_SECRET_KEY>
 *   Content-Type: application/json
 *
 *   { "payload": { ... task input ... } }
 *
 * Returns `{ id: "run_..." }` on success which we persist onto the
 * job row so the polling endpoint (B4) can look it up later.
 *
 * Errors are wrapped in a typed result rather than thrown — the
 * caller decides whether to surface a 5xx (Trigger.dev outage), let
 * the job sit `queued` for a recovery cron, or refund credits
 * immediately. For B3 we just propagate the error code; B3 follow-up
 * adds the recovery cron.
 */

const TRIGGER_TASK_ID = 'generate-job';

export interface DispatchJobInput {
  jobId: string;
  triggerSecretKey: string;
  /**
   * Optional API base. Defaults to Trigger.dev cloud. Self-hosted
   * deployments can pass `https://my-trigger-host.example.com`.
   */
  apiBase?: string;
}

export type DispatchJobResult =
  | { ok: true; runId: string }
  | { ok: false; status: number; message: string };

export async function dispatchJob(args: DispatchJobInput): Promise<DispatchJobResult> {
  const apiBase = args.apiBase ?? 'https://api.trigger.dev';
  const url = `${apiBase}/api/v1/tasks/${TRIGGER_TASK_ID}/trigger`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.triggerSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { jobId: args.jobId } }),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : 'Network error',
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      status: res.status,
      message: text.slice(0, 280) || `Trigger.dev returned ${res.status}`,
    };
  }

  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!json || typeof json.id !== 'string') {
    return {
      ok: false,
      status: res.status,
      message: 'Trigger.dev response missing run id.',
    };
  }
  return { ok: true, runId: json.id };
}
