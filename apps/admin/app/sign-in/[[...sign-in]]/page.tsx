/**
 * Catch-all sign-in route used by Clerk's hosted-component flow.
 *
 * The `<SignIn>` component automatically handles:
 *   - normal email/password / OAuth flows,
 *   - sign-in tickets via `?__clerk_ticket=<token>` (admin bootstrap),
 *   - new-device verification, MFA, etc.
 */
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <SignIn />
    </div>
  );
}
