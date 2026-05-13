/**
 * Drizzle Kit config — drives `db:generate`, `db:push`, `db:studio`.
 *
 * Reads the connection string from `DATABASE_URL` in the environment.
 * For local dev, populate it via the api app's `.dev.vars`:
 *
 *   cd packages/db
 *   DATABASE_URL="$(grep '^DATABASE_URL=' ../../apps/api/.dev.vars | cut -d= -f2-)" pnpm db:push
 *
 * Or set it inline once at the shell.
 */

import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) {
  // Print, don't throw — `drizzle-kit` runs `import` of this file even
  // for help commands. We let it proceed; commands that actually need
  // a connection will surface a clearer error themselves.
  console.warn(
    '[drizzle.config] DATABASE_URL is not set. Migration commands will fail until you export it.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: url ?? 'postgresql://placeholder',
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
