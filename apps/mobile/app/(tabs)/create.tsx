/**
 * Create tab — a stub. The tab bar intercepts presses on this tab and
 * presents the full-screen composer instead (see (tabs)/_layout.tsx),
 * so this screen only exists to satisfy the router and is never shown
 * for more than a frame (e.g. via deep link); it forwards immediately.
 *
 * The previous prompt-first create screen lives in git history; its
 * logic (pricing, consent, idempotency, uploads) moved into
 * app/composer.tsx.
 */

import { Redirect } from 'expo-router';

export default function CreateTabStub() {
  return <Redirect href="/composer" />;
}
