/** READ ONLY: print `GET /jobs/:id` for the newest failed job and newest completed template job. */
import { createDb } from '@clickfy/db';
import { sql } from 'drizzle-orm';
import { assetUrl } from '../src/lib/asset-url';
import { jobDetail, rowsOf } from '../src/lib/analytics-sql';

const url = process.env.DATABASE_URL!;
const db = createDb({ connectionString: url, runtime: 'http' });
async function main() {
  const ids = rowsOf<{ id: string }>(await db.execute(sql`
    (SELECT id FROM jobs WHERE status='failed' AND error->>'code'='provider_error' ORDER BY created_at DESC LIMIT 1)
    UNION ALL (SELECT id FROM jobs WHERE status='completed' AND source='template' ORDER BY created_at DESC LIMIT 1)
    UNION ALL (SELECT id FROM jobs WHERE status='completed' AND result->'videos'->0 IS NOT NULL ORDER BY created_at DESC LIMIT 1)`));
  for (const { id } of ids) {
    const t = Date.now();
    const d = await jobDetail(db, id, 'https://api.clickefy.ai', assetUrl);
    console.log(`\n== ${id} (${Date.now() - t} ms)`);
    console.log(JSON.stringify({ ...d, billedUnits: d?.billedUnits?.length, ledger: d?.ledger.map((l) => `${l.reason} ${l.delta} ${l.bucket}`) }, null, 1).slice(0, 2500));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
