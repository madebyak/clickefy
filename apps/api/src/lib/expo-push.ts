/**
 * Expo Push API client.
 *
 * Wraps https://exp.host/--/api/v2/push/send and provides:
 *   - Chunking (Expo caps each request at 100 tokens).
 *   - Receipt-style error handling so dead tokens get marked inactive.
 *   - A pure function signature (no DB writes inline) so the caller
 *     decides whether/how to persist the result.
 *
 * Why Expo's hosted push service instead of APNs/FCM directly:
 *   - One transport for both iOS and Android.
 *   - Expo handles APNs auth-key rotation + FCM v1 migration.
 *   - Works in Expo Go AND custom dev/EAS Builds without code change.
 *
 * Auth posture: Expo's push API can be called anonymously (their token
 * is the auth). For our use case we add an Expo access token via
 * `EXPO_ACCESS_TOKEN` env so we get rate-limit exemption and per-
 * project metrics. The header is optional in dev.
 *
 * Receipts:
 *   - The initial /send POST returns `ticket`s (one per message).
 *   - A successful ticket is { status: 'ok', id: ReceiptId }.
 *   - A failed ticket is { status: 'error', message, details? }.
 *   - We surface failed tickets to the caller, who can update the
 *     `device_tokens.is_active` flag for DeviceNotRegistered errors.
 *
 * We do NOT poll the /receipts endpoint in this iteration — that's a
 * later phase. Tickets give us enough signal to mark obvious dead
 * tokens, which is the 80% case.
 */

export interface ExpoPushMessage {
  /** ExponentPushToken[xxx] — the device's push token. */
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  /** iOS interruption level. Defaults to 'active'. */
  priority?: 'default' | 'normal' | 'high';
  /**
   * iOS-only. When omitted Expo defaults to 'active' which respects
   * Focus modes. 'time-sensitive' bypasses; we don't want that for
   * generation completes.
   */
  _category?: 'default' | 'time-sensitive';
}

export interface ExpoPushTicket {
  /** Index into the input batch — we tag this ourselves. */
  index: number;
  /** Original token so the caller can map back to a row. */
  to: string;
  status: 'ok' | 'error';
  /** Set when status === 'ok'. Used later for receipt polling. */
  id?: string;
  /** Set when status === 'error'. */
  message?: string;
  /** Set when status === 'error'. The "DeviceNotRegistered" string
   *  here is the signal to mark a token inactive. */
  errorType?: string;
}

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const MAX_BATCH_SIZE = 100;

/**
 * Send a batch of push messages via Expo. Chunks automatically and
 * always resolves to a per-message ticket array, even on transport
 * failure (in which case every entry is `{ status: 'error',
 * message: 'transport_failed' }`).
 *
 * The function never throws — callers shouldn't have to wrap calls in
 * try/catch just to log a transient Expo outage. They get a tickets
 * array and can decide what to do with it.
 */
export async function sendExpoPush(
  messages: ExpoPushMessage[],
  opts: { accessToken?: string } = {},
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];

  const tickets: ExpoPushTicket[] = new Array(messages.length);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (opts.accessToken) {
    headers.Authorization = `Bearer ${opts.accessToken}`;
  }

  for (let start = 0; start < messages.length; start += MAX_BATCH_SIZE) {
    const slice = messages.slice(start, start + MAX_BATCH_SIZE);
    try {
      const res = await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(slice),
      });

      // Expo returns 200 with a per-message data array even when
      // individual messages fail. A non-200 means the whole batch was
      // rejected (rate limit, malformed). In both branches we still
      // populate tickets so the caller has parity with messages.length.
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error('[expo-push] batch rejected', res.status, errBody.slice(0, 200));
        for (let i = 0; i < slice.length; i++) {
          tickets[start + i] = {
            index: start + i,
            to: slice[i]!.to,
            status: 'error',
            message: `transport_${res.status}`,
          };
        }
        continue;
      }

      const json = (await res.json()) as {
        data?: Array<{
          status?: 'ok' | 'error';
          id?: string;
          message?: string;
          details?: { error?: string };
        }>;
      };
      const data = json.data ?? [];
      for (let i = 0; i < slice.length; i++) {
        const t = data[i];
        if (!t) {
          tickets[start + i] = {
            index: start + i,
            to: slice[i]!.to,
            status: 'error',
            message: 'missing_ticket',
          };
          continue;
        }
        if (t.status === 'ok' && t.id) {
          tickets[start + i] = {
            index: start + i,
            to: slice[i]!.to,
            status: 'ok',
            id: t.id,
          };
        } else {
          tickets[start + i] = {
            index: start + i,
            to: slice[i]!.to,
            status: 'error',
            message: t.message,
            errorType: t.details?.error,
          };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'transport_failed';
      console.error('[expo-push] transport failure', message);
      for (let i = 0; i < slice.length; i++) {
        tickets[start + i] = {
          index: start + i,
          to: slice[i]!.to,
          status: 'error',
          message: 'transport_failed',
        };
      }
    }
  }

  return tickets;
}

/**
 * Convenience: given a set of tickets, return the subset of tokens
 * whose ticket was a hard failure (the device should be marked
 * inactive). The two unambiguous signals from Expo are:
 *   - errorType === 'DeviceNotRegistered' (token revoked / uninstalled)
 *   - errorType === 'InvalidCredentials'  (the credentials we signed
 *      with are wrong — affects every token; surface but don't kill
 *      tokens for it).
 *
 * The caller is responsible for updating the DB.
 */
export function tokensToDeactivate(tickets: ExpoPushTicket[]): string[] {
  return tickets
    .filter((t) => t.status === 'error' && t.errorType === 'DeviceNotRegistered')
    .map((t) => t.to);
}
