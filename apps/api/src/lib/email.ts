/**
 * Transactional email, through Resend's REST API.
 *
 * The Worker has never sent email: receipts come from Stripe, and every
 * other notification is a push to the mobile app. Cancellations changed
 * that — Stripe does not email a customer when their plan is booked to
 * end, and a customer who cancelled by accident should hear about it the
 * same minute, not on renewal day.
 *
 * Plain `fetch`, no SDK: the API is one POST, and a dependency for it is
 * one more thing to keep in step with the Workers runtime.
 *
 * NOT CONFIGURED IS NOT AN ERROR. Without `RESEND_API_KEY` this logs and
 * returns 'skipped', so a webhook keeps processing money correctly on an
 * environment that has no email — local dev, a preview, or production
 * before the sending domain is verified. An email that fails to send
 * never fails the event that triggered it either: Stripe would retry the
 * whole event, and a broken email provider must not stall billing.
 *
 * Setup (once): verify `clickefy.ai` in Resend (DNS records), then
 *   pnpm --filter @clickfy/api exec wrangler secret put RESEND_API_KEY
 * `EMAIL_FROM` is an ordinary var; it defaults below.
 */

import type { AppEnv } from '../types';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative, for clients that want one. */
  text: string;
}

export type EmailOutcome = 'sent' | 'skipped' | 'failed';

const DEFAULT_FROM = 'Clickefy <billing@clickefy.ai>';
const RESEND_URL = 'https://api.resend.com/emails';

export async function sendEmail(env: AppEnv['Bindings'], msg: EmailMessage): Promise<EmailOutcome> {
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.warn('[email] RESEND_API_KEY not set — not sending', { to: msg.to, subject: msg.subject });
    return 'skipped';
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM || DEFAULT_FROM,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      console.error('[email] send failed', { status: res.status, body: await res.text().catch(() => '') });
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    console.error('[email] send threw', err);
    return 'failed';
  }
}
