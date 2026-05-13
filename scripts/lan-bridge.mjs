/**
 * LAN → loopback TCP bridge for `wrangler dev`.
 *
 * Why this exists
 * ───────────────
 * macOS Sequoia tightened Local Network privacy. Executables that
 * live inside `~/Documents`, `~/Desktop`, or `~/Downloads` are not
 * allowed to accept inbound connections from non-loopback addresses,
 * even when the user is the same human running the process. The TCP
 * handshake still completes (that happens in the kernel), but macOS
 * silently drops the application's read of the request bytes, so the
 * client sees `Empty reply from server`.
 *
 * Our `workerd` binary ships under
 * `node_modules/@cloudflare/workerd-darwin-64/bin/workerd`, which
 * is inside `~/Documents` for this repo. That makes wrangler dev
 * unreachable from a physical iPhone over Wi-Fi — even though
 * curl from the same Mac to its own LAN IP fails identically.
 *
 * This bridge runs the standard Node binary (`/usr/local/bin/node`)
 * which is NOT under the Documents restriction. It accepts inbound
 * LAN connections on the configured listen address and pipes them
 * raw to `127.0.0.1:8787`, where wrangler is happily listening on
 * loopback only.
 *
 *      iPhone ──Wi-Fi──▶  <Mac LAN IP>:8788   (this script)
 *                                  │
 *                                  └──TCP loopback──▶  127.0.0.1:8787   (wrangler / workerd)
 *
 * Usage
 * ─────
 *   pnpm --filter @clickfy/api dev          # terminal 1: wrangler on localhost
 *   pnpm --filter @clickfy/api dev:bridge   # terminal 2: this script
 *
 * Then point the mobile app at the bridge:
 *   EXPO_PUBLIC_API_URL=http://<Mac-LAN-IP>:8788
 *
 * Stop with Ctrl+C.
 */

import net from 'node:net';

const LISTEN_HOST = process.env.LAN_BRIDGE_HOST ?? '0.0.0.0';
const LISTEN_PORT = Number(process.env.LAN_BRIDGE_PORT ?? 8788);
const TARGET_HOST = process.env.LAN_BRIDGE_TARGET_HOST ?? '127.0.0.1';
const TARGET_PORT = Number(process.env.LAN_BRIDGE_TARGET_PORT ?? 8787);

const server = net.createServer((client) => {
  const upstream = net.connect(TARGET_PORT, TARGET_HOST, () => {
    client.pipe(upstream);
    upstream.pipe(client);
  });

  // Both sides must be torn down together to avoid leaking half-open
  // sockets when one end errors. Logging is intentionally terse —
  // every flaky cellular handoff produces an `ECONNRESET` and we
  // don't want that to spam the dev console.
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
});

server.on('error', (err) => {
  console.error(`[lan-bridge] listen error: ${err.message}`);
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `[lan-bridge] forwarding ${LISTEN_HOST}:${LISTEN_PORT} → ${TARGET_HOST}:${TARGET_PORT}`,
  );
  console.log('[lan-bridge] point mobile EXPO_PUBLIC_API_URL at this address.');
});
