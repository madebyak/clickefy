/**
 * One-off migration — move template stages off `gemini-2.5-flash-image`.
 *
 * Google shuts that model down on 2026-10-02. Every stage still pointing
 * at it would start failing at the provider on that date, and unlike the
 * `-preview` Gemini keys it has no `apiModelId` remap to fall back on.
 *
 * Nearly all of these are accidental: the admin editor defaulted every
 * NEW stage to this model (generation-tab.tsx), so a stage the author
 * never touched inherited it. That is why the replacement here is
 * "whatever this template's OTHER image stages already use" — the stray
 * stage was meant to match its siblings, not to be a cheaper outlier.
 *
 * What one upgrade does, mirroring `POST /v1/admin/templates/:id/publish`
 * exactly (see apps/api/src/routes/templates.ts) so the result is
 * indistinguishable from an admin clicking Publish:
 *
 *   1. swap the model on the affected stage(s) of `templates.generation`
 *   2. recompute `templates.cost_credits` from the new stage set, using
 *      the same rule as `computeTemplateCost` (tier = mode ?? resolution)
 *   3. snapshot the updated row into a NEW `template_versions` row —
 *      this is the step that matters, because jobs run the highest
 *      version number, NOT the live `templates` row
 *   4. stamp `status/publishedAt/updatedAt` like publish does
 *
 * SAFETY
 *   - UPDATE + INSERT only. No DELETE, no TRUNCATE, no DDL.
 *   - Every write is scoped to one template id.
 *   - `--apply` is required; the default is a dry run.
 *   - Refuses to touch a template that does not actually contain the
 *     deprecated model, or whose replacement is missing/deprecated/
 *     unpriced in `provider_models`.
 *   - Only `status = 'published'` templates get a new version. Archived
 *     and draft rows are reported, never written — republishing them is
 *     an editorial decision, not a migration.
 *   - Re-reads every row after writing instead of trusting the write.
 *   - Idempotent: a second run finds nothing to do.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/upgrade-deprecated-image-model.ts
 *   DATABASE_URL=... pnpm tsx scripts/upgrade-deprecated-image-model.ts --apply
 */

import { and, createDb, eq, templateCategories, templateVersions, templates } from '../src';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const db = createDb({ connectionString: url, runtime: 'http' });

/** The model being retired. */
const DEPRECATED = 'gemini-2.5-flash-image';

/**
 * Fallback when a template has no other image stage to copy from (e.g. a
 * single image stage feeding a video stage). The mid-tier current Gemini
 * flash model — the same default the editor now uses for new stages.
 */
const FALLBACK = 'gemini-3.1-flash-image';

const PUBLISH_NOTE =
  `Automated migration: ${DEPRECATED} → current Gemini model (provider shutdown 2026-10-02).`;

interface StageJson {
  provider?: string;
  model?: string;
  config?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Mirrors `computeTemplateCost` in apps/api/src/lib/template-cost.ts:
 * the tier is `config.mode`, falling back to the legacy `config.resolution`;
 * a tiered model bills `tier_pricing[tier]`, otherwise the flat base; a
 * model with no `provider_models` row contributes 0.
 */
function stageCost(
  stage: StageJson,
  priceByKey: Map<string, { costCredits: number; tierPricing: Record<string, number> | null }>,
): number {
  const row = priceByKey.get(`${stage.provider}/${stage.model}`);
  if (!row) return 0;
  const cfg = stage.config ?? {};
  const tier =
    typeof cfg.mode === 'string'
      ? cfg.mode
      : typeof cfg.resolution === 'string'
        ? cfg.resolution
        : undefined;
  return (tier ? row.tierPricing?.[tier] : undefined) ?? row.costCredits;
}

/**
 * The model a stray stage should become: whatever the template's other
 * Gemini image stages already use, preferring the most common one, and
 * normalised to a non-deprecated key. Falls back to `FALLBACK` when the
 * stage has no siblings to learn from.
 */
function chooseReplacement(
  stages: StageJson[],
  activeKeys: Set<string>,
  gaFor: Map<string, string>,
): string {
  const tally = new Map<string, number>();
  for (const s of stages) {
    if (s.provider !== 'gemini' || s.model === DEPRECATED || !s.model) continue;
    // A sibling on a deprecated `-preview` key still tells us the intent;
    // map it to its GA equivalent rather than copying a dying key.
    const key = gaFor.get(s.model) ?? s.model;
    if (!activeKeys.has(key)) continue;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of tally) if (n > bestN) ((best = k), (bestN = n));
  return best ?? FALLBACK;
}

async function main() {
  const host = new URL(url!.replace('postgresql://', 'https://')).hostname;
  console.log(`Target: ${host}`);
  console.log(apply ? 'Mode:   APPLY\n' : 'Mode:   DRY RUN (pass --apply to write)\n');

  const models = await db.query.providerModels.findMany();
  const priceByKey = new Map(
    models.map((m) => [
      `${m.provider}/${m.modelKey}`,
      { costCredits: m.costCredits, tierPricing: m.tierPricing ?? null },
    ]),
  );
  const activeKeys = new Set(
    models.filter((m) => m.status !== 'deprecated' && m.costCredits > 0).map((m) => m.modelKey),
  );
  // `-preview` → GA, so a sibling on a legacy key still resolves to a
  // model we are happy to write into a fresh snapshot.
  const gaFor = new Map<string, string>([
    ['gemini-3-pro-image-preview', 'gemini-3-pro-image'],
    ['gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image'],
  ]);

  const all = await db.query.templates.findMany();
  const affected = all.filter((t) =>
    (t.generation?.stages ?? []).some((s) => (s as StageJson).model === DEPRECATED),
  );

  if (affected.length === 0) {
    console.log(`Nothing to do — no template references ${DEPRECATED}.`);
    return;
  }

  let published = 0;
  let skipped = 0;

  for (const row of affected) {
    const stages = (row.generation?.stages ?? []) as unknown as StageJson[];
    const replacement = chooseReplacement(stages, activeKeys, gaFor);

    // Guard: never write a model we cannot price or that is itself dying.
    const rep = priceByKey.get(`gemini/${replacement}`);
    if (!rep || !activeKeys.has(replacement)) {
      console.log(`  ✗  ${row.title} — replacement "${replacement}" is missing/deprecated/unpriced; skipped`);
      skipped += 1;
      continue;
    }

    const nextStages = stages.map((s) => (s.model === DEPRECATED ? { ...s, model: replacement } : s));
    const swapped = nextStages.filter((s, i) => s.model !== stages[i]!.model).length;
    const nextCost = nextStages.reduce((n, s) => n + stageCost(s, priceByKey), 0);

    console.log(`  ${row.status === 'published' ? '▸' : '·'}  ${row.title}  [${row.status}]`);
    console.log(
      `       ${swapped} stage(s): ${DEPRECATED} → ${replacement}   cost ${row.costCredits}cr → ${nextCost}cr`,
    );

    if (row.status !== 'published') {
      console.log(`       skipped — only published templates get a new version`);
      skipped += 1;
      continue;
    }

    if (!apply) {
      published += 1;
      continue;
    }

    // ── 1+2. live row: new stages + recomputed cost ─────────────────
    const nextGeneration = { ...row.generation, stages: nextStages } as typeof row.generation;
    await db
      .update(templates)
      .set({ generation: nextGeneration, costCredits: nextCost, updatedAt: new Date() })
      .where(eq(templates.id, row.id));

    // ── 3. snapshot the UPDATED row into a new version ──────────────
    // Re-read so the snapshot is the row as stored, not as intended.
    const updated = await db.query.templates.findFirst({ where: eq(templates.id, row.id) });
    if (!updated) {
      console.log(`       ✗ row vanished after update — aborting this template`);
      skipped += 1;
      continue;
    }

    const cats = await db
      .select({
        categoryId: templateCategories.categoryId,
        isPrimary: templateCategories.isPrimary,
        sortOrder: templateCategories.sortOrder,
      })
      .from(templateCategories)
      .where(eq(templateCategories.templateId, row.id));
    const primary = cats.find((c) => c.isPrimary)?.categoryId ?? '';
    const extras = cats
      .filter((c) => !c.isPrimary)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => c.categoryId);

    const existing = await db.query.templateVersions.findMany({
      where: eq(templateVersions.templateId, row.id),
      columns: { versionNumber: true },
    });
    const nextVersion = existing.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;

    const publishedAt = new Date();
    await db.insert(templateVersions).values({
      templateId: row.id,
      versionNumber: nextVersion,
      snapshot: {
        ...updated,
        primaryCategoryId: primary,
        extraCategoryIds: extras,
        categoryIds: primary ? [primary, ...extras] : extras,
      },
      // No admin clicked Publish; leaving this NULL and explaining in the
      // note is honest provenance. The column is nullable by design.
      publishedBy: null,
      publishNote: PUBLISH_NOTE,
      publishedAt,
    });

    // ── 4. same status stamp publish applies ────────────────────────
    await db
      .update(templates)
      .set({ status: 'published', publishedAt, updatedAt: publishedAt })
      .where(eq(templates.id, row.id));

    // ── verify by reading back, rather than trusting the writes ──────
    const after = await db.query.templates.findFirst({ where: eq(templates.id, row.id) });
    const stillDeprecated = ((after?.generation?.stages ?? []) as unknown as StageJson[]).some(
      (s) => s.model === DEPRECATED,
    );
    const newVersion = await db.query.templateVersions.findFirst({
      where: and(
        eq(templateVersions.templateId, row.id),
        eq(templateVersions.versionNumber, nextVersion),
      ),
    });
    const snapStages =
      ((newVersion?.snapshot as { generation?: { stages?: StageJson[] } })?.generation?.stages ??
        []) as StageJson[];
    const snapshotClean = snapStages.length > 0 && !snapStages.some((s) => s.model === DEPRECATED);

    const ok =
      !stillDeprecated && after?.costCredits === nextCost && !!newVersion && snapshotClean;
    console.log(
      `       ${ok ? '✓' : '✗ MISMATCH'} live row clean=${!stillDeprecated} cost=${after?.costCredits}cr  v${nextVersion} snapshot clean=${snapshotClean}`,
    );
    published += ok ? 1 : 0;
    if (!ok) skipped += 1;
  }

  console.log(
    `\n${apply ? 'Published' : 'Would publish'} ${published} new version(s); ${skipped} skipped.`,
  );
  if (!apply) console.log('Re-run with --apply to write.');
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
