/**
 * Bootstrap a new admin user end-to-end:
 *   1. Creates the user in Clerk (via the Backend API).
 *   2. Inserts a matching row in Neon `users` with `entitlement = 'admin'`.
 *
 * This is the only way to get the very first admin into the system —
 * the regular self-signup path lands users with `entitlement = 'free'`.
 *
 * Usage:
 *   CLERK_SECRET_KEY=sk_... DATABASE_URL=postgres://... \
 *     pnpm tsx scripts/bootstrap-admin.ts <email> <password> [name]
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';

import * as schema from '../src/schema';
import { users } from '../src/schema';

const clerkSecret = process.env.CLERK_SECRET_KEY;
const dbUrl = process.env.DATABASE_URL;

if (!clerkSecret) {
  console.error('CLERK_SECRET_KEY is not set.');
  process.exit(1);
}
if (!dbUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const [, , emailArg, passwordArg, nameArg] = process.argv;
if (!emailArg || !passwordArg) {
  console.error('Usage: tsx scripts/bootstrap-admin.ts <email> <password> [name]');
  process.exit(1);
}

const email = emailArg.toLowerCase();
const password = passwordArg;
const fullName = nameArg ?? 'Clickefy Admin';
const [firstName, ...rest] = fullName.split(' ');
const lastName = rest.join(' ') || 'Admin';

const sql = neon(dbUrl);
const db = drizzle(sql, { schema });

interface ClerkUser {
  id: string;
  email_addresses: Array<{ email_address: string }>;
}

interface ClerkError {
  errors?: Array<{ code: string; message: string; long_message?: string }>;
}

async function createClerkUser(): Promise<ClerkUser> {
  const res = await fetch('https://api.clerk.com/v1/users', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${clerkSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email_address: [email],
      password,
      first_name: firstName,
      last_name: lastName,
      // Admin bootstrap is a controlled internal flow — we trust the
      // caller's password choice. Self-signup still enforces all checks.
      skip_password_checks: true,
      skip_password_requirement: false,
    }),
  });

  const payload = (await res.json()) as ClerkUser & ClerkError;

  if (!res.ok) {
    const first = payload.errors?.[0];
    throw new Error(
      `Clerk API ${res.status}: ${first?.long_message ?? first?.message ?? JSON.stringify(payload)}`,
    );
  }

  return payload;
}

async function findClerkUserByEmail(): Promise<ClerkUser | null> {
  const url = new URL('https://api.clerk.com/v1/users');
  url.searchParams.set('email_address', email);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${clerkSecret}` },
  });
  if (!res.ok) return null;
  const list = (await res.json()) as ClerkUser[];
  return list.find((u) => u.email_addresses.some((e) => e.email_address === email)) ?? null;
}

async function main() {
  console.log(`→ Creating Clerk user for ${email}…`);

  let clerkUser: ClerkUser;
  try {
    clerkUser = await createClerkUser();
    console.log(`  ✓ Clerk user created: ${clerkUser.id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('email_address') && msg.toLowerCase().includes('taken')) {
      console.log('  · Email already exists in Clerk — fetching existing user…');
      const existing = await findClerkUserByEmail();
      if (!existing) throw err;
      clerkUser = existing;
      console.log(`  ✓ Found Clerk user: ${clerkUser.id}`);
    } else {
      throw err;
    }
  }

  console.log(`→ Upserting Neon row…`);
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (existing) {
    await db
      .update(users)
      .set({
        clerkUserId: clerkUser.id,
        name: fullName,
        entitlement: 'admin',
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
        entitlement: 'admin',
        creditsBalance: 999,
      })
      .returning();
    console.log(`  ✓ Inserted Neon row (id: ${row.id})`);
  }

  console.log('');
  console.log('✅ Admin ready. Sign in at http://localhost:3000 with:');
  console.log(`   email:    ${email}`);
  console.log(`   password: (the one you provided)`);
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
