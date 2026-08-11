#!/usr/bin/env node
/**
 * Safety interlock for drizzle-kit's schema-mutating commands.
 *
 * WHY THIS EXISTS
 * ---------------
 * The drizzle migration journal is DRIFTED on purpose:
 *   - drizzle/meta/_journal.json stops at 0019; everything >= 0020 is
 *     hand-written SQL applied via scripts/apply-migration.ts.
 *   - Only the 0000 snapshot exists, so `drizzle-kit generate` diffs
 *     against a schema from migration 1 and produces WRONG output.
 *   - `drizzle-kit migrate` would replay old migrations, including
 *     0001's `TRUNCATE templates/jobs/template_versions CASCADE`.
 *     That exact replay wiped production data on 2026-05-14.
 *   - `drizzle-kit push` diffs the live DB against the schema files and
 *     applies the delta directly — with the drifted snapshot it can
 *     drop constraints/columns it merely fails to recognise.
 *
 * THE SAFE WORKFLOW
 * -----------------
 *   1. Write a new hand-numbered SQL file in drizzle/ (house format:
 *      SAFETY header, IF NOT EXISTS guards, --> statement-breakpoint).
 *   2. Apply it with:  pnpm tsx scripts/apply-migration.ts drizzle/00XX_name.sql
 *   3. Register it:    pnpm tsx scripts/reconcile-migrations.ts
 *   4. Verify:         pnpm tsx scripts/check-migrations.ts
 *
 * ESCAPE HATCH
 * ------------
 * If you genuinely need drizzle-kit (e.g. a deliberate re-baseline of
 * the journal), set the env var and re-run:
 *
 *   CLICKFY_DRIZZLE_DANGER=1 pnpm db:push
 *
 * and do it against a Neon BRANCH first, never straight against main.
 */
import { spawnSync } from 'node:child_process';

const cmd = process.argv[2];
const rest = process.argv.slice(3);

const ALLOWED = new Set(['generate', 'push', 'migrate']);
if (!ALLOWED.has(cmd)) {
  console.error(`guard-drizzle: unknown command "${cmd}" (expected one of: ${[...ALLOWED].join(', ')})`);
  process.exit(2);
}

if (process.env.CLICKFY_DRIZZLE_DANGER !== '1') {
  console.error(`
╔══════════════════════════════════════════════════════════════════════╗
║  BLOCKED: drizzle-kit ${cmd.padEnd(8)} is disabled in this repo.          ║
╚══════════════════════════════════════════════════════════════════════╝

The migration journal is deliberately drifted (hand-written SQL >= 0020).
Running "${cmd}" against the production database can REPLAY DESTRUCTIVE
MIGRATIONS or apply a wrong diff — migration 0001's TRUNCATE wiped
production data this way on 2026-05-14.

Safe workflow instead:
  1. write drizzle/00XX_name.sql by hand (house format)
  2. pnpm tsx scripts/apply-migration.ts drizzle/00XX_name.sql
  3. pnpm tsx scripts/reconcile-migrations.ts
  4. pnpm tsx scripts/check-migrations.ts

If you REALLY mean it (e.g. deliberate journal re-baseline, on a Neon
branch — never main):

  CLICKFY_DRIZZLE_DANGER=1 pnpm db:${cmd}
`);
  process.exit(1);
}

console.warn(`guard-drizzle: CLICKFY_DRIZZLE_DANGER=1 set — running drizzle-kit ${cmd}. You were warned.`);
const result = spawnSync('pnpm', ['exec', 'drizzle-kit', cmd, ...rest], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
