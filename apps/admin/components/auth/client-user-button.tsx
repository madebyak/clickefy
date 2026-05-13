'use client';

import { useEffect, useState } from 'react';
import { UserButton } from '@clerk/nextjs';

/**
 * Clerk's `<UserButton />` SSRs as an empty
 * `<div data-clerk-component="UserButton" />` placeholder, then
 * hydrates client-side once `clerk.load()` finishes. Next 16's
 * stricter hydration checker (and Turbopack in dev) flag the diff
 * between the SSR placeholder and the client-side tree as a
 * mismatch even though Clerk regenerates the subtree on the client
 * intentionally.
 *
 * Skipping SSR for the button removes the false-positive without
 * touching app behaviour: server renders nothing in this slot, and
 * the button mounts post-hydration. Layout stays stable because we
 * keep an avatar-sized placeholder during SSR.
 */
export function ClientUserButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Avatar-sized placeholder so the header doesn't reflow when the
    // real button hydrates a tick later.
    return <span aria-hidden className="block h-7 w-7 rounded-full bg-muted/40" />;
  }
  return <UserButton />;
}
