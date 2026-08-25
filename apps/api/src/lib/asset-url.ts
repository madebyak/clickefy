/**
 * Turn an R2 key into the URL that serves it.
 *
 * THE PROBLEM THIS EXISTS TO STOP
 *   R2 holds our media in TWO physically separate buckets, each with its
 *   own read route bound to it:
 *
 *     /v1/outputs/:key  → OUTPUTS bucket — what the models generated
 *     /v1/uploads/:key  → UPLOADS bucket — what users and admins uploaded
 *
 *   Ask the wrong route for a key and you get a 404, because the object
 *   genuinely is not in that bucket. Which bucket a key belongs to has
 *   always been decided by its first path segment, but that mapping was
 *   never written down anywhere — it just lived in whichever route each
 *   caller happened to hard-code.
 *
 *   That held for as long as an unwritten invariant held with it: every
 *   `project_assets` row came from a generation, so every key in that
 *   table started `jobs/` and `/v1/outputs/` was always right. "Add from
 *   My Assets" is the first thing to file a `user-uploads/` key into that
 *   table — deliberately sharing the object rather than copying it, so a
 *   placed image costs no extra storage — and the hard-coded route in
 *   `projects.ts` started 404ing on exactly those rows. Blank tiles on the
 *   canvas, blank covers in the sidebar, while the very same key rendered
 *   fine in the My Assets modal, which builds its URLs somewhere else.
 *
 *   So the mapping lives here now, once, and callers ask rather than
 *   assume.
 *
 * ADDING A NAMESPACE
 *   Add it to the table below. A key whose prefix is not listed is served
 *   from OUTPUTS — the historical default, so an omission can never be
 *   worse than the behaviour before this file existed — and logged, so it
 *   shows up in Worker logs instead of only as a broken image someone
 *   eventually reports.
 */

/** First path segment → the route that serves that bucket. */
const NAMESPACE_ROUTE: Record<string, 'outputs' | 'uploads'> = {
  // OUTPUTS — written by the Trigger.dev worker via the S3 API.
  jobs: 'outputs',
  // UPLOADS — written through /v1/uploads/{presign,finalize} or by the
  // internal/admin write routes (see INTERNAL_WRITE_PREFIXES in uploads.ts).
  'user-uploads': 'uploads',
  templates: 'uploads',
  avatars: 'uploads',
  categories: 'uploads',
  banners: 'uploads',
};

/** Prefixes already reported, so one bad row cannot flood the logs. */
const warned = new Set<string>();

/**
 * The public URL for an R2 key.
 *
 * `origin` is the API origin, not the web one — these are served by the
 * Worker so a bucket rename or a move to signed URLs stays invisible to
 * every client.
 */
export function assetUrl(origin: string, r2Key: string): string {
  const namespace = r2Key.split('/', 1)[0] ?? '';
  const route = NAMESPACE_ROUTE[namespace];

  if (!route) {
    if (!warned.has(namespace)) {
      warned.add(namespace);
      console.error(
        `[asset-url] unknown R2 namespace "${namespace}" (key: ${r2Key}) — ` +
          'serving from OUTPUTS. Add it to NAMESPACE_ROUTE in lib/asset-url.ts.',
      );
    }
    return `${origin}/v1/outputs/${r2Key}`;
  }

  return `${origin}/v1/${route}/${r2Key}`;
}
