/**
 * Push notification registration + foreground handling.
 *
 * Responsibilities:
 *   1. Ask for permission (iOS shows a system prompt; Android < 13
 *      auto-grants, Android >= 13 needs a prompt too).
 *   2. Fetch the ExponentPushToken for this device.
 *   3. POST it to the API so the backend can target this user.
 *   4. Tell the OS how to render notifications received while the app
 *      is in the foreground (default behaviour is to suppress them).
 *
 * Lifecycle:
 *   - `registerForPushNotificationsAsync` is idempotent — calling it
 *     repeatedly is safe and the backend upserts by token.
 *   - On sign-out we POST `/v1/devices/unregister` so this device
 *     doesn't receive pushes meant for the previous owner. See
 *     `useSession.deleteAccount` / `signOut` for the call site.
 *
 * Expo Go notes:
 *   - Push works in Expo Go for development purposes (tokens start
 *     with `ExponentPushToken[…]` whether from Expo Go or a custom
 *     build).
 *   - For App Store / Play Store releases the same tokens flow
 *     through the same Expo Push API; no API key on the client side.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { config } from './config';

// Tell the OS how to render foreground notifications. Without this,
// receiving a push while the app is open shows… nothing — iOS in
// particular hides it entirely by default. We surface a banner + a
// sound + a list-entry, which matches what users expect from any
// chat / generation app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface RegisterResult {
  /** ExponentPushToken[...] string if the registration succeeded. */
  token: string | null;
  /** Why we failed, when token is null. */
  reason?:
    | 'simulator'
    | 'permission_denied'
    | 'no_project_id'
    | 'token_fetch_failed'
    | 'backend_register_failed';
}

/**
 * Run the full registration dance and persist the token to the API.
 * Returns the token (or null + a reason for the caller to surface).
 *
 * @param getToken — bearer-token fetcher (use Clerk's `getToken()`).
 */
export async function registerForPushNotificationsAsync(
  getToken: () => Promise<string | null>,
): Promise<RegisterResult> {
  // Simulators / web don't have a real push token issuer. Bail early
  // with a precise reason so the caller can show "push only works on a
  // physical device" rather than a generic error.
  if (!Device.isDevice) {
    return { token: null, reason: 'simulator' };
  }

  // On Android we MUST create a channel before requesting permission
  // or the system uses the default channel and our priority is
  // ignored. iOS doesn't have channels and ignores this call.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7C3AED',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let finalStatus = existing.status;
  if (finalStatus !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }
  if (finalStatus !== 'granted') {
    return { token: null, reason: 'permission_denied' };
  }

  // EAS Build embeds the projectId in the `expoConfig.extra.eas`
  // block. In Expo Go we read it from the runtime's manifest. If
  // somehow both are absent we bail cleanly — the user can still use
  // the app, they just won't get pushes.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return { token: null, reason: 'no_project_id' };
  }

  let tokenResult;
  try {
    tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
  } catch (err) {
    console.warn('[push] getExpoPushTokenAsync failed:', err);
    return { token: null, reason: 'token_fetch_failed' };
  }
  const expoPushToken = tokenResult.data;

  try {
    const bearer = await getToken();
    const res = await fetch(`${config.apiUrl}/v1/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({
        expoPushToken,
        platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'unknown',
        appVersion: Constants.expoConfig?.version ?? undefined,
        locale: undefined,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[push] backend register failed', res.status, text.slice(0, 200));
      return { token: expoPushToken, reason: 'backend_register_failed' };
    }
  } catch (err) {
    console.warn('[push] backend register threw:', err);
    return { token: expoPushToken, reason: 'backend_register_failed' };
  }

  return { token: expoPushToken };
}

/**
 * Best-effort unregister on sign-out / account deletion. Failures are
 * swallowed because the sign-out flow shouldn't be blocked on a
 * housekeeping call.
 */
export async function unregisterPushAsync(
  expoPushToken: string,
  getToken: () => Promise<string | null>,
): Promise<void> {
  try {
    const bearer = await getToken();
    await fetch(`${config.apiUrl}/v1/devices/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({ expoPushToken }),
    });
  } catch (err) {
    console.warn('[push] unregister threw:', err);
  }
}

/**
 * Subscribe to Expo push-token rotation events.
 *
 * Expo tokens are stable in 99% of cases but can rotate after device
 * restore, OS major upgrades, or app reinstalls without a fresh
 * sign-in. Without this listener a rotated token leaves us pushing
 * to a stale address — the device silently stops receiving.
 *
 * Wire this once at app start (after the first registerForPush call).
 * Returns the subscription handle so the caller can dispose it on
 * sign-out.
 */
export function subscribeToTokenRotation(
  getToken: () => Promise<string | null>,
): { remove: () => void } {
  const sub = Notifications.addPushTokenListener(async (newToken) => {
    if (!newToken?.data) return;
    console.log('[push] token rotated, re-registering…');
    try {
      const bearer = await getToken();
      const res = await fetch(`${config.apiUrl}/v1/devices/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({
          expoPushToken: newToken.data,
          platform:
            Platform.OS === 'ios'
              ? 'ios'
              : Platform.OS === 'android'
                ? 'android'
                : 'unknown',
          appVersion: Constants.expoConfig?.version ?? undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn('[push] rotation register failed', res.status, text.slice(0, 200));
      }
    } catch (err) {
      console.warn('[push] rotation register threw:', err);
    }
  });
  return sub;
}
