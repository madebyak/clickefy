import * as Sentry from '@sentry/cloudflare';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { withDb } from './middleware/with-db';
import { health } from './routes/health';
import { catalog } from './routes/catalog';
import { categoriesRoute } from './routes/categories';
import { jobsRoute } from './routes/jobs';
import { libraryRoute } from './routes/library';
import { templatesRoute } from './routes/templates';
import { adminPushRoute } from './routes/admin-push';
import { adminReportsRoute } from './routes/admin-reports';
import { adminStatsRoute } from './routes/admin-stats';
import { adminUsersRoute } from './routes/admin-users';
import { devicesRoute } from './routes/devices';
import { internalPushRoute } from './routes/internal-push';
import { reportsRoute } from './routes/reports';
import { usersRoute } from './routes/users';
import { outputsRoute } from './routes/outputs';
import { uploadsAdminRoute, uploadsPublicRoute, uploadsUserRoute } from './routes/uploads';
import { clerkWebhookRoute } from './routes/webhooks/clerk';
import { revenuecatWebhookRoute } from './routes/webhooks/revenuecat';
import type { AppEnv, Bindings } from './types';

const app = new Hono<AppEnv>();

app.use('*', logger());
app.use(
  '*',
  secureHeaders({
    // This API serves browser clients on other origins (admin on
    // localhost:3000, mobile app, etc.) — `same-origin` (the default)
    // would block <img> and <video> embeds. CORS still gates the
    // actual request paths.
    crossOriginResourcePolicy: 'cross-origin',
  }),
);
app.use(
  '*',
  cors({
    origin: (origin) => origin ?? '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    maxAge: 86400,
  }),
);
app.use('/v1/*', withDb());

app.get('/', (c) =>
  c.json({
    name: 'clickfy-api',
    status: 'ok',
    version: 'v1',
    docs: 'https://github.com/clickfy/clickfy/blob/main/docs/ARCHITECTURE.md',
  }),
);

app.route('/v1/health', health);
app.route('/v1/catalog', catalog);
app.route('/v1/categories', categoriesRoute);
app.route('/v1/admin/templates', templatesRoute);
app.route('/v1/admin/users', adminUsersRoute);
app.route('/v1/admin/reports', adminReportsRoute);
app.route('/v1/admin/stats', adminStatsRoute);
app.route('/v1/admin/push', adminPushRoute);
app.route('/v1/devices', devicesRoute);
app.route('/v1/internal/push', internalPushRoute);
app.route('/v1/jobs', jobsRoute);
app.route('/v1/library', libraryRoute);
app.route('/v1/reports', reportsRoute);
app.route('/v1/users', usersRoute);
// `/v1/uploads/user` MUST be registered before the public GET route
// below, because Hono matches in registration order and the public
// route's `/:key{.+}` would otherwise swallow the literal `/user` path.
app.route('/v1/uploads/user', uploadsUserRoute);
app.route('/v1/uploads', uploadsPublicRoute);
app.route('/v1/admin/uploads', uploadsAdminRoute);
app.route('/v1/outputs', outputsRoute);
app.route('/v1/webhooks/clerk', clerkWebhookRoute);
app.route('/v1/webhooks/revenuecat', revenuecatWebhookRoute);

app.notFound((c) =>
  c.json({ error: { code: 'not_found', message: `Route ${c.req.path} not found` } }, 404),
);

app.onError((err, c) => {
  // Surface to Sentry. `withSentry` would catch *uncaught* errors, but
  // Hono's `onError` rescues them first and returns a 500 JSON body, so
  // we forward explicitly. Tag the user when known so the issue page
  // can show who tripped it.
  const clerkUserId = c.get('clerkUserId');
  if (clerkUserId) {
    Sentry.setUser({ id: clerkUserId });
  }
  Sentry.captureException(err, {
    tags: {
      route: c.req.path,
      method: c.req.method,
    },
  });
  console.error('Unhandled error:', err);
  return c.json(
    { error: { code: 'internal_error', message: err.message ?? 'Something went wrong' } },
    500,
  );
});

/**
 * Wrap the Hono handler with Sentry's Cloudflare SDK so the Worker
 * lifecycle (fetch, scheduled, queue) gets automatic error capture and
 * tracing. `withSentry` runs *before* any of our middleware, so it sees
 * every request — including ones rejected by CORS or rate limiting.
 *
 * The DSN is sourced from the `SENTRY_DSN` Worker secret. When unset
 * (e.g. local dev with `pnpm dev`), the wrapper short-circuits to a
 * no-op so you don't pollute the dashboard with test traffic.
 *
 * `tracesSampleRate: 0.1` keeps traces cheap while still giving us a
 * representative sample of real production latency.
 */
const handler = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Bindings>;

export default Sentry.withSentry(
  (env: Bindings) => ({
    dsn: env.SENTRY_DSN,
    environment: env.ENVIRONMENT,
    // We tag users manually from withCurrentUser; IPs add little signal
    // for a JSON API and put us closer to PII regulations than we want
    // to be by default.
    sendDefaultPii: false,
    tracesSampleRate: env.ENVIRONMENT === 'production' ? 0.1 : 1.0,
  }),
  handler,
);
