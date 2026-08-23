/**
 * Stripe client, built per request.
 *
 * Cloudflare Workers reuse an isolate across requests but the SDK is cheap
 * to construct and holds no connection state, so a per-request instance
 * avoids leaking anything between unrelated callers — the same reasoning
 * as `withDb`.
 *
 * `httpClient` is the load-bearing part. The SDK defaults to Node's `http`
 * module, which does not exist in Workers; `createFetchHttpClient()` swaps
 * in the platform's own `fetch`. Without it every Stripe call throws at
 * runtime rather than at build time, so it would look fine until the first
 * real checkout.
 */

import Stripe from 'stripe';

export function makeStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    // Workers have no Node http stack — use fetch.
    httpClient: Stripe.createFetchHttpClient(),
    // Retry transient failures rather than surfacing them as a failed
    // checkout to someone with their card already out.
    maxNetworkRetries: 2,
    appInfo: { name: 'clickefy', url: 'https://clickefy.ai' },
  });
}

/**
 * Verify a webhook signature.
 *
 * MUST be `constructEventAsync` with a SubtleCrypto provider: the
 * synchronous `constructEvent` uses Node crypto and throws outright on
 * Workers. This is the single most common way a Stripe integration passes
 * local tests and then rejects every live delivery.
 *
 * `rawBody` must be the EXACT bytes Stripe sent — read once as text,
 * before anything parses it. Re-serialising the parsed JSON changes the
 * bytes and the signature will not match.
 */
export async function verifyStripeEvent(
  stripe: Stripe,
  rawBody: string,
  signature: string,
  webhookSecret: string,
): Promise<Stripe.Event> {
  return stripe.webhooks.constructEventAsync(
    rawBody,
    signature,
    webhookSecret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}
