import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const applied = await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`;
  console.log('Applied migrations:', applied.length);
  for (const r of applied) {
    console.log(' ', String(r.hash).slice(0, 24), new Date(Number(r.created_at)).toISOString());
  }

  // Probe key objects from each migration
  const checks = [
    { name: '0001 template_kind enum', q: sql`SELECT 1 FROM pg_type WHERE typname='template_kind'` },
    { name: '0002 users.preferences col', q: sql`SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='preferences'` },
    { name: '0003 credit_ledger.note col', q: sql`SELECT 1 FROM information_schema.columns WHERE table_name='credit_ledger' AND column_name='note'` },
    { name: '0004 saved_templates table', q: sql`SELECT 1 FROM information_schema.tables WHERE table_name='saved_templates'` },
    { name: '0005 jobs_user_pagination_idx', q: sql`SELECT 1 FROM pg_indexes WHERE indexname='jobs_user_pagination_idx'` },
    { name: '0006 admin_audit_log table', q: sql`SELECT 1 FROM information_schema.tables WHERE table_name='admin_audit_log'` },
    { name: '0007 reports table', q: sql`SELECT 1 FROM information_schema.tables WHERE table_name='reports'` },
  ];

  console.log('\nSchema state:');
  for (const c of checks) {
    const rows = await c.q;
    console.log(`  ${rows.length > 0 ? '✓' : '✗'} ${c.name}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
