#!/usr/bin/env node
/**
 * Regenerate `.expo/types/router.d.ts` — the typed-routes declaration
 * that `expo-router` produces for `experiments.typedRoutes`.
 *
 * WHY THIS EXISTS
 * ---------------
 * That file is what makes `router.push('/buy-credits')` typecheck, but:
 *
 *   1. it is generated ONLY by the Expo dev server (a Metro watch
 *      handler regenerates it as route files change), and
 *   2. `.expo/` is gitignored, so it does not exist at all on a fresh
 *      clone or in CI.
 *
 * The result was a `pnpm typecheck` that depended on whether someone had
 * recently run `expo start` on that machine. Ours had gone stale on
 * 2026-06-17 and was missing `/buy-credits` and `/notifications` — real,
 * shipped routes — so typecheck failed on valid code.
 *
 * This calls the same generator the dev server uses, headlessly, with no
 * Metro and no bundling. Since SDK 57 that generator lives in
 * `@expo/router-server` (it left `expo-router/build/typed-routes` when
 * the router went universal); `regenerateDeclarations` is exactly what
 * `expo customize tsconfig.json` runs, minus the tsconfig rewrite.
 * Wired to `pretypecheck` so the declarations are always current before
 * `tsc` reads them.
 *
 * Usage:  node scripts/gen-router-types.mjs
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(projectRoot, 'app');
const outDir = resolve(projectRoot, '.expo/types');
const outFile = resolve(outDir, 'router.d.ts');

// The generator reads the app directory through a `require.context`
// ponyfill rooted at this env var; it must be set before importing.
process.env.EXPO_ROUTER_APP_ROOT = appRoot;

const { regenerateDeclarations } = require('@expo/router-server/build/typed-routes');

mkdirSync(outDir, { recursive: true });
regenerateDeclarations(outDir);

if (!existsSync(outFile)) {
  console.error('[gen-router-types] generator produced no router.d.ts — is app/ present?');
  process.exit(1);
}

// Distinct concrete pathnames, for a log line that means something.
const declaration = readFileSync(outFile, 'utf8');
const routes = new Set(
  [...declaration.matchAll(/pathname: `([^`$]+)`/g)].map((m) => m[1]),
);
console.log(
  `[gen-router-types] wrote .expo/types/router.d.ts (${routes.size} routes)`,
);
