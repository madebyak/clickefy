/**
 * Rate-limiting middleware using Cloudflare's native `RateLimit` binding.
 *
 * Why the native binding (not KV/DO):
 *   - The same infrastructure that powers WAF rate-limiting rules.
 *   - `limit()` is fire-and-forget under the hood: the call awaits a
 *     locally-cached counter, not a network round-trip. No measurable
 *     latency add.
 *   - Configuration lives in `wrangler.toml` (`[[ratelimits]]`), not in
 *     code — easy to tune per-environment without redeploys.
 *
 * Locality caveat: limits are per Cloudflare data centre, not global.
 * A user hitting two POPs effectively doubles their bucket. For a
 * mobile app a single session pins to one POP, so this is moot. For
 * truly global enforcement we'd need a Durable Object — overkill at
 * our scale.
 *
 * Failure mode: if the binding is missing (dev shell without
 * `wrangler dev`, or a deploy where the binding hasn't been wired yet)
 * we fail OPEN. This is the safer choice for a guard that protects
 * against abuse but is not security-critical — false negatives are
 * tolerable; false positives that block real users are not.
 *
 * Key resolvers:
 *   - `byUserId` — uses `c.var.clerkUserId` (set by `withAuth`). Apply
 *     AFTER `withAuth` so the key is populated. Returns null for
 *     anon requests → middleware lets them through (use `byIp` for
 *     anon coverage).
 *   - `byIp` — falls back to `cf-connecting-ip`, then the first hop in
 *     `x-forwarded-for`. Use only for unauthenticated routes; per CF's
 *     own guidance, IP keys can over-block users behind shared NAT.
 */

import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';

import type { AppEnv, Bindings } from '../types';

type LimiterSelector = (env: Bindings) => RateLimit | undefined;
type KeyResolver = (c: Context<AppEnv>) => string | null;

export function withRateLimit(selectLimiter: LimiterSelector, resolveKey: KeyResolver) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const limiter = selectLimiter(c.env);
    if (!limiter) {
      return next();
    }
    const key = resolveKey(c);
    if (!key) {
      return next();
    }
    const { success } = await limiter.limit({ key });
    if (!success) {
      c.header('Retry-After', '60');
      return c.json(
        {
          error: {
            code: 'rate_limited',
            message: 'Too many requests. Please slow down and try again shortly.',
          },
        },
        429,
      );
    }
    return next();
  });
}

export const byClerkUserId: KeyResolver = (c) => c.var.clerkUserId ?? null;

export const byIp: KeyResolver = (c) => {
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf;
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
};
