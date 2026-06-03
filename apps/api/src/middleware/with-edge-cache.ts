/**
 * withEdgeCache — store public GET responses in Cloudflare's edge cache
 * (the Cache API) so repeat reads are served from a PoP in ~10ms instead
 * of re-running the handler (and its Neon queries) every time.
 *
 * Why this is needed: a Worker's own `c.json()` response is NOT cached by
 * Cloudflare automatically — setting `Cache-Control: s-maxage` only hints
 * downstream/browser caches. To get edge caching for Worker-generated
 * responses you must explicitly `caches.default.put(...)`. That's the 0%
 * edge-hit-rate we saw on `/v1/catalog/*`.
 *
 * Safety posture (important):
 *   - READ-ONLY. This only caches responses; it never touches the DB,
 *     R2, or any user data.
 *   - ANONYMOUS ONLY. Any request carrying an `Authorization` header
 *     bypasses the shared cache entirely, so personalised bodies (e.g.
 *     `isFavorited` on a template) are never stored or served to the
 *     wrong user.
 *   - Only `GET` + only `200` responses are stored. Errors, redirects,
 *     and `private`/`no-store` responses are passed through untouched.
 *   - The cache key is the normalised URL only (method GET, no request
 *     headers), so entries are deterministic and Vary/Origin quirks
 *     can't fragment or leak the cache.
 *
 * Mounted as the FIRST middleware on a public route so a cache HIT short-
 * circuits before rate-limiting and the DB middleware run — which also
 * relieves origin load (and the 429s) under traffic spikes.
 */

import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../types';

export interface EdgeCacheOptions {
  /**
   * Edge freshness window in seconds, applied as a fallback when the
   * handler didn't already set an `s-maxage`. Handlers that set their
   * own `Cache-Control` (e.g. the catalog routes) keep theirs.
   */
  ttlSeconds: number;
}

export function withEdgeCache(opts: EdgeCacheOptions): MiddlewareHandler<AppEnv> {
  const { ttlSeconds } = opts;

  return async (c, next) => {
    // Never share-cache anything non-GET or anything personalised.
    if (c.req.method !== 'GET' || c.req.header('authorization')) {
      return next();
    }

    // `caches` is absent in some non-Workers test contexts — degrade to
    // a plain pass-through rather than throwing.
    const cache = typeof caches !== 'undefined' ? caches.default : undefined;
    if (!cache) return next();

    // Deterministic key: normalised URL, GET, no request headers.
    const cacheKey = new Request(new URL(c.req.url).toString(), { method: 'GET' });

    const hit = await cache.match(cacheKey);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set('x-edge-cache', 'HIT');
      c.res = res;
      return;
    }

    await next();

    const res = c.res;
    if (!res || res.status !== 200) return;

    const cc = res.headers.get('cache-control') ?? '';
    // Respect explicit opt-outs from the handler.
    if (/\b(private|no-store|no-cache)\b/i.test(cc)) return;

    // Ensure the edge has a TTL even if the handler only set max-age (or
    // nothing). Handlers that already specified s-maxage keep theirs.
    if (!/s-maxage=/i.test(cc)) {
      res.headers.set(
        'Cache-Control',
        `public, s-maxage=${ttlSeconds}, stale-while-revalidate=300`,
      );
    }
    res.headers.set('x-edge-cache', 'MISS');

    // Store a clone; the original streams back to the client. `waitUntil`
    // keeps the write off the response's critical path.
    const toStore = res.clone();
    try {
      c.executionCtx.waitUntil(cache.put(cacheKey, toStore));
    } catch {
      // No execution context (e.g. tests) — store inline.
      await cache.put(cacheKey, toStore);
    }
  };
}
