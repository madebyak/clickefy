/**
 * Updates a Clerk user's password via the Backend API.
 * Uses `skip_password_checks` to bypass HIBP breach checks (admin bootstrap).
 *
 * Usage:
 *   CLERK_SECRET_KEY=sk_... pnpm tsx scripts/set-clerk-password.ts <email> <newPassword>
 */

const clerkSecret = process.env.CLERK_SECRET_KEY;
if (!clerkSecret) {
  console.error('CLERK_SECRET_KEY is not set.');
  process.exit(1);
}

const [, , emailArg, passwordArg] = process.argv;
if (!emailArg || !passwordArg) {
  console.error('Usage: tsx scripts/set-clerk-password.ts <email> <newPassword>');
  process.exit(1);
}

const email = emailArg.toLowerCase();
const password = passwordArg;

interface ClerkUser {
  id: string;
  email_addresses: Array<{ email_address: string }>;
}

async function findUser(): Promise<ClerkUser> {
  const url = new URL('https://api.clerk.com/v1/users');
  url.searchParams.set('email_address', email);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${clerkSecret}` } });
  if (!res.ok) throw new Error(`Clerk list ${res.status}: ${await res.text()}`);
  const list = (await res.json()) as ClerkUser[];
  const u = list.find((x) => x.email_addresses.some((e) => e.email_address === email));
  if (!u) throw new Error(`No Clerk user found with email ${email}`);
  return u;
}

async function main() {
  const user = await findUser();
  console.log(`→ Updating password for ${email} (${user.id})…`);

  const res = await fetch(`https://api.clerk.com/v1/users/${user.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${clerkSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      password,
      skip_password_checks: true,
      sign_out_of_other_sessions: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Clerk patch ${res.status}: ${text}`);
  }

  console.log('  ✓ Password updated.');
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
