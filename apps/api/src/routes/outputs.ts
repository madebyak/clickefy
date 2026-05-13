/**
 * /v1/outputs/:key — serve AI-generated artifacts from the OUTPUTS
 * R2 bucket.
 *
 * Reads only. Trigger.dev tasks write to R2 directly via the S3 API
 * (see apps/jobs-worker/src/lib/r2.ts); the Worker is the only path
 * mobile and the admin app should ever fetch outputs through. Going
 * via the Worker (vs r2.dev) gives us:
 *
 *   - Long-lived edge caching with `immutable` (outputs never change)
 *   - One canonical origin that survives bucket renames / migrations
 *   - A single chokepoint to add per-user access checks later if we
 *     ever want signed URLs (e.g. for private templates / 1:1 jobs)
 *
 * For now the route is unauthenticated — the only way an outsider
 * learns a valid key is by guessing a UUID inside a UUID, which is
 * cryptographically equivalent to a password. Same posture as our
 * upload-serving route. If we ever support private templates we'll
 * either swap to signed URLs or require an auth header here.
 *
 * Keys carry their path prefix verbatim (e.g. `jobs/<jobId>/stage1-0.png`).
 * Hono's `:key{.+}` pattern captures slashes so the URL is round-tripped
 * cleanly without per-segment escaping.
 *
 * Local-dev fallback: the R2 binding `OUTPUTS` runs against a local
 * Miniflare emulator in `wrangler dev`. The Trigger.dev orchestrator
 * always writes to the REAL cloud bucket via the S3 API, so the
 * local emulator stays empty even after a successful job. We detect
 * a miss on the binding and try the S3 endpoint with the same
 * credentials Trigger.dev uses, returning the object straight from
 * the cloud bucket. In production the binding IS the cloud bucket
 * and the fallback never fires.
 */

import { Hono } from 'hono';

import type { AppEnv } from '../types';

export const outputsRoute = new Hono<AppEnv>();

outputsRoute.get('/:key{.+}', async (c) => {
  const bucket = c.env.OUTPUTS;
  if (!bucket) {
    return c.json(
      { error: { code: 'r2_not_configured', message: 'Outputs bucket binding missing.' } },
      503,
    );
  }

  const key = c.req.param('key');

  // ── Range support ──────────────────────────────────────────────
  // The Range header looks like `bytes=0-1023` or `bytes=1024-` or
  // (rarely) `bytes=-512`. We honour the simple `start-end` /
  // `start-` forms — those cover every player we care about
  // (AVPlayer, ExoPlayer, browser <video>). Multipart ranges
  // (`bytes=0-100,200-300`) are skipped: R2's binding API doesn't
  // express them and no player we ship to needs them.
  const rangeHeader = c.req.header('range');
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match) {
      // We need the total size to compute the closed end and the
      // Content-Range header. A cheap HEAD-equivalent is fine; R2's
      // binding gives us size on either `head()` or as part of the
      // ranged get's result, but `head()` is the simpler shape.
      const head = await bucket.head(key);
      if (!head) {
        return c.json({ error: { code: 'not_found', message: 'Output not found.' } }, 404);
      }
      const totalSize = head.size;

      let start = match[1] === '' ? NaN : Number(match[1]);
      let end = match[2] === '' ? NaN : Number(match[2]);
      if (Number.isNaN(start) && !Number.isNaN(end)) {
        // Suffix range: `bytes=-N` → last N bytes
        start = Math.max(0, totalSize - end);
        end = totalSize - 1;
      } else if (!Number.isNaN(start) && Number.isNaN(end)) {
        end = totalSize - 1;
      }
      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start < 0 ||
        end >= totalSize ||
        start > end
      ) {
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${totalSize}` },
        });
      }

      const length = end - start + 1;
      const ranged = await bucket.get(key, {
        range: { offset: start, length },
      });
      if (!ranged) {
        return c.json({ error: { code: 'not_found', message: 'Output not found.' } }, 404);
      }
      const headers = new Headers();
      ranged.writeHttpMetadata(headers);
      headers.set('etag', ranged.httpEtag);
      headers.set('content-length', String(length));
      headers.set('content-range', `bytes ${start}-${end}/${totalSize}`);
      headers.set('accept-ranges', 'bytes');
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      headers.set('cross-origin-resource-policy', 'cross-origin');
      headers.set('access-control-allow-origin', '*');
      return new Response(ranged.body, { status: 206, headers });
    }
  }

  // ── Full GET ───────────────────────────────────────────────────
  const obj = await bucket.get(key);
  if (!obj) {
    return c.json({ error: { code: 'not_found', message: 'Output not found.' } }, 404);
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // `accept-ranges: bytes` advertises range support so range-capable
  // clients (notably iOS AVPlayer) know they can request slices on
  // subsequent connections. Without this header the player treats
  // the response as non-seekable and may refuse to play long videos.
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(obj.size));
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('cross-origin-resource-policy', 'cross-origin');
  headers.set('access-control-allow-origin', '*');

  return new Response(obj.body, { headers });
});

// Explicit HEAD route — Hono doesn't auto-route HEAD to GET handlers.
outputsRoute.on('HEAD', '/:key{.+}', async (c) => {
  const bucket = c.env.OUTPUTS;
  if (!bucket) return c.body(null, 503);
  const key = c.req.param('key');
  const head = await bucket.head(key);
  if (!head) return c.body(null, 404);
  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set('etag', head.httpEtag);
  headers.set('content-length', String(head.size));
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('cross-origin-resource-policy', 'cross-origin');
  headers.set('access-control-allow-origin', '*');
  return new Response(null, { status: 200, headers });
});

/**
 * POST /v1/outputs/internal/:key — Trigger.dev → Worker handoff for
 * generated artifacts.
 *
 * The orchestrator can't use `c.env.OUTPUTS` directly because it runs
 * in a separate Node process (Trigger.dev's worker pool). Going via
 * the Worker — instead of straight to R2 via S3 — gives us:
 *
 *   1. ONE place that talks to R2 (the binding). No S3 credentials
 *      in the jobs-worker process at all → smaller blast radius.
 *   2. Local dev parity. The Worker's binding is Miniflare in dev
 *      and the real cloud bucket in prod; the orchestrator doesn't
 *      know or care which.
 *   3. Centralised lifecycle controls (CORS, cache, lifecycle policy
 *      tagging) at the Worker layer rather than scattered across
 *      services.
 *
 * Auth: a shared `INTERNAL_API_SECRET` header. NOT user-facing —
 * the secret never appears in mobile traffic; only the Worker and
 * jobs-worker know it. We compare with a constant-time check to
 * dodge timing side-channels even though the attack surface is small.
 */
outputsRoute.put('/internal/:key{.+}', async (c) => {
  const secret = c.env.INTERNAL_API_SECRET;
  if (!secret) {
    return c.json(
      { error: { code: 'not_configured', message: 'INTERNAL_API_SECRET missing on Worker.' } },
      503,
    );
  }
  const provided = c.req.header('x-internal-secret');
  if (!provided || !timingSafeEq(provided, secret)) {
    return c.json({ error: { code: 'unauthorized', message: 'Invalid internal secret.' } }, 401);
  }

  const bucket = c.env.OUTPUTS;
  if (!bucket) {
    return c.json(
      { error: { code: 'r2_not_configured', message: 'Outputs bucket binding missing.' } },
      503,
    );
  }

  const key = c.req.param('key');
  const contentType = c.req.header('content-type') ?? 'application/octet-stream';
  // Stream the body straight into R2 rather than buffering — Workers
  // have a 128MB ceiling and most images are < 10MB, but streaming
  // is correct hygiene regardless and lets us grow into video later.
  const body = c.req.raw.body;
  if (!body) {
    return c.json({ error: { code: 'empty_body', message: 'No body provided.' } }, 400);
  }

  await bucket.put(key, body, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: { source: 'jobs-worker' },
  });

  return c.json({ data: { key } }, 201);
});

/** Constant-time string compare. Only safe for equal-length inputs. */
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
