/**
 * Promote a user to admin by email.
 *
 * The user must already exist in Neon — sign in on the mobile app first
 * so the row gets created (via the Clerk webhook in production, or via
 * the lazy upsert in `withCurrentUser` middleware in dev).
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/promote-admin.ts you@example.com
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';

import * as schema from '../src/schema';
import { users } from '../src/schema';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: pnpm tsx scripts/promote-admin.ts <email>');
  process.exit(1);
}

const sql = neon(url);
const db = drizzle(sql, { schema });

async function main() {
  const before = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!before) {
    console.error(`No user found with email: ${email}`);
    console.error('Sign in on the mobile app first, then re-run this script.');
    process.exit(1);
  }

  if (before.entitlement === 'admin') {
    console.log(`${email} is already an admin.`);
    return;
  }

  await db.update(users).set({ entitlement: 'admin' }).where(eq(users.id, before.id));
  console.log(`Promoted ${email} → admin.`);
  console.log(`  id:           ${before.id}`);
  console.log(`  clerkUserId:  ${before.clerkUserId}`);
  console.log(`  was:          ${before.entitlement}`);
  console.log(`  now:          admin`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
