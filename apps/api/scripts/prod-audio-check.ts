/**
 * Create ONE speech job for the founder's own account so the production
 * worker can be checked after the ElevenLabs key is set. Charges that
 * account 3 credits like any other speech job. Dispatch is done
 * separately (Trigger MCP / dashboard) because no production Trigger key
 * lives on this machine.
 *
 * Usage (from apps/api):
 *   DATABASE_URL=<prod> pnpm tsx scripts/prod-audio-check.ts <email> --yes
 */
import { eq } from 'drizzle-orm';
import { createDb, providerModels, users } from '@clickfy/db';
import { resolveCreditCost } from '@clickfy/types';
import { createUserJobAtomically } from '../src/lib/job-create';

const url = process.env.DATABASE_URL!;
const email = process.argv[2];
if (!email || !process.argv.includes('--yes')) { console.error('usage: <email> --yes'); process.exit(1); }
const VOICE_ID = 'hpp4J3VqNfWAUOO0d1Us'; // Bella (premade, on the account)
const TEXT = 'Clickefy production check: speech is working.';
const db = createDb({ connectionString: url, runtime: 'http' });

async function main() {
  const user = await db.query.users.findFirst({ where: eq(users.email, email), columns: { id: true, creditsBalance: true, adminRole: true } });
  if (!user || !user.adminRole) throw new Error('refusing: not a staff account');
  const row = await db.query.providerModels.findFirst({ where: eq(providerModels.modelKey, 'eleven-tts') });
  if (!row) throw new Error('eleven-tts row missing');
  const cost = resolveCreditCost({ baseCredits: row.costCredits, tierPricing: row.tierPricing ?? null, textChars: TEXT.length });
  const result = await createUserJobAtomically(db, {
    userId: user.id,
    cost,
    modelKey: 'eleven-tts',
    inputs: { prompt: { kind: 'text', value: TEXT } },
    options: { audio: { voiceId: VOICE_ID, voiceName: 'Bella', stability: 0.5, similarity: 0.75 }, textChars: TEXT.length },
    idempotencyKey: null,
    origin: 'create',
  });
  if (!result) throw new Error('job create returned null (balance?)');
  console.log(JSON.stringify({ host: new URL(url).host, userId: user.id, jobId: result.jobId, cost, creditsRemaining: result.creditsRemaining }));
}
main().catch((e) => { console.error(e); process.exit(1); });
