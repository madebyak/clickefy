/**
 * Mints a one-shot Clerk sign-in token for the given email and prints
 * a magic URL. Opening the URL signs the user in instantly, bypassing
 * MFA / new-device verification. Useful for admin bootstrap when you
 * don't have access to the destination mailbox.
 *
 * Usage:
 *   CLERK_SECRET_KEY=sk_... NEXT_PUBLIC_APP_URL=http://localhost:3000 \
 *     pnpm tsx scripts/clerk-sign-in-link.ts <email>
 */

const clerkSecret = process.env.CLERK_SECRET_KEY;
if (!clerkSecret) {
  console.error('CLERK_SECRET_KEY is not set.');
  process.exit(1);
}

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const email = process.argv[2]?.toLowerCase();
if (!email) {
  console.error('Usage: tsx scripts/clerk-sign-in-link.ts <email>');
  process.exit(1);
}

interface ClerkUser {
  id: string;
  email_addresses: Array<{ email_address: string }>;
}

interface SignInToken {
  token: string;
  url?: string;
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

async function mintToken(userId: string): Promise<SignInToken> {
  const res = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${clerkSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 600 }),
  });
  if (!res.ok) throw new Error(`Mint token ${res.status}: ${await res.text()}`);
  return (await res.json()) as SignInToken;
}

async function main() {
  const user = await findUser();
  const tok = await mintToken(user.id);

  // The ticket flow on the front-end side: Clerk redirects to the
  // application's sign-in URL with `__clerk_ticket=<token>`.
  const url = new URL('/sign-in', appUrl);
  url.searchParams.set('__clerk_ticket', tok.token);
  url.searchParams.set('redirect_url', '/admin/categories');

  console.log('');
  console.log('✅ Sign-in ticket minted. Open this URL in your browser:');
  console.log('');
  console.log(`   ${url.toString()}`);
  console.log('');
  console.log('   (Valid for 10 minutes. One-time use.)');
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
