/**
 * Tiny HS256 JWT helper that runs anywhere `crypto.subtle` exists —
 * Cloudflare Workers, Node ≥18, modern browsers, Trigger.dev's runtime.
 *
 * We avoid `node:crypto` here so this file stays portable. The Kling
 * adapter is the only consumer today; if more providers need JWTs we
 * can keep extending this module instead of pulling in `jose` (which
 * is heavier than what we need).
 */

const TEXT_ENCODER = new TextEncoder();

/** Base64URL-encode a Uint8Array without padding (per RFC 7515). */
function base64UrlEncodeBytes(bytes: Uint8Array): string {
  // btoa needs binary string input. Manual chunked loop avoids the
  // string-too-long failure mode on very large buffers (irrelevant for
  // JWT headers/payloads in practice but cheap insurance).
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Base64URL-encode a JSON-serialisable object. */
function base64UrlEncodeJson(obj: unknown): string {
  return base64UrlEncodeBytes(TEXT_ENCODER.encode(JSON.stringify(obj)));
}

/**
 * Mint an HS256-signed JWT. Returns the three-segment compact form.
 *
 * `secretKey` is the raw shared secret as a string — exactly what the
 * provider gives you. We import it as raw bytes (not base64-decoded)
 * to match the convention every provider doc uses.
 */
export async function signJwtHs256(
  payload: Record<string, unknown>,
  secretKey: string,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64UrlEncodeJson(header);
  const payloadB64 = base64UrlEncodeJson(payload);
  const data = TEXT_ENCODER.encode(`${headerB64}.${payloadB64}`);

  const key = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, data);
  const signature = base64UrlEncodeBytes(new Uint8Array(signatureBuffer));

  return `${headerB64}.${payloadB64}.${signature}`;
}
