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
import { adminUsersRoute } from './routes/admin-users';
import { usersRoute } from './routes/users';
import { outputsRoute } from './routes/outputs';
import { uploadsAdminRoute, uploadsPublicRoute, uploadsUserRoute } from './routes/uploads';
import { clerkWebhookRoute } from './routes/webhooks/clerk';
import type { AppEnv } from './types';

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
app.route('/v1/jobs', jobsRoute);
app.route('/v1/library', libraryRoute);
app.route('/v1/users', usersRoute);
// `/v1/uploads/user` MUST be registered before the public GET route
// below, because Hono matches in registration order and the public
// route's `/:key{.+}` would otherwise swallow the literal `/user` path.
app.route('/v1/uploads/user', uploadsUserRoute);
app.route('/v1/uploads', uploadsPublicRoute);
app.route('/v1/admin/uploads', uploadsAdminRoute);
app.route('/v1/outputs', outputsRoute);
app.route('/v1/webhooks/clerk', clerkWebhookRoute);

app.notFound((c) =>
  c.json({ error: { code: 'not_found', message: `Route ${c.req.path} not found` } }, 404),
);

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    { error: { code: 'internal_error', message: err.message ?? 'Something went wrong' } },
    500,
  );
});

export default app;
