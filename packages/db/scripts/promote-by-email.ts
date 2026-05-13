/**
 * Promote a user to admin entitlement by email. Works whether or not
 * the user already exists in Neon — looks up Clerk first, then
 * inserts/updates the Neon row.
 *
 * Use this for users who signed in via OAuth (Google/Apple) and so
 * never had a password to bootstrap with.
 *
 * Usage:
 *   CLERK_SECRET_KEY=sk_... DATABASE_URL=postgres://... \
 *     pnpm tsx scripts/promote-by-email.ts <email>
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';

import * as schema from '../src/schema';
import { users } from '../src/schema';

const clerkSecret = process.env.CLERK_SECRET_KEY;
const dbUrl = process.env.DATABASE_URL;

if (!clerkSecret) throw new Error('CLERK_SECRET_KEY is not set');
if (!dbUrl) throw new Error('DATABASE_URL is not set');

const emailArg = process.argv[2];
if (!emailArg) {
  console.error('Usage: tsx scripts/promote-by-email.ts <email>');
  process.exit(1);
}

const email = emailArg.toLowerCase();
const sqlClient = neon(dbUrl);
const db = drizzle(sqlClient, { schema });

interface ClerkUser {
  id: string;
  email_addresses: Array<{ email_address: string }>;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
}

async function findClerkUserByEmail(): Promise<ClerkUser> {
  const url = new URL('https://api.clerk.com/v1/users');
  url.searchParams.set('email_address', email);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${clerkSecret}` } });
  if (!res.ok) throw new Error(`Clerk list ${res.status}: ${await res.text()}`);
  const list = (await res.json()) as ClerkUser[];
  const u = list.find((x) => x.email_addresses.some((e) => e.email_address === email));
  if (!u) throw new Error(`No Clerk user found with email ${email}. Sign in once first.`);
  return u;
}

async function main() {
  const clerkUser = await findClerkUserByEmail();
  const fullName =
    [clerkUser.first_name, clerkUser.last_name].filter(Boolean).join(' ') || null;

  console.log(`→ Clerk user: ${clerkUser.id}  (${fullName ?? '<no name>'})`);

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (existing) {
    await db
      .update(users)
      .set({
        clerkUserId: clerkUser.id,
        entitlement: 'admin',
        ...(fullName ? { name: fullName } : {}),
        ...(clerkUser.image_url ? { avatarUrl: clerkUser.image_url } : {}),
      })
      .where(eq(users.id, existing.id));
    console.log(`  ✓ Updated existing Neon row → admin (id: ${existing.id})`);
  } else {
    const [row] = await db
      .insert(users)
      .values({
        clerkUserId: clerkUser.id,
        email,
        name: fullName,
        avatarUrl: clerkUser.image_url ?? null,
        entitlement: 'admin',
        creditsBalance: 999,
      })
      .returning();
    console.log(`  ✓ Inserted Neon row (id: ${row.id})`);
  }

  console.log('');
  console.log(`✅ ${email} is now admin. Refresh the admin dashboard.`);
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
