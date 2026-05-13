/**
 * Haptics — single source of truth for tactile feedback across the app.
 *
 * Why a helper instead of calling expo-haptics directly:
 *   1. Respects iOS "Reduce Motion" accessibility setting automatically.
 *   2. Respects a per-user toggle persisted in AsyncStorage (Profile screen).
 *   3. Provides a `choreograph()` helper for splash / reveal moments where
 *      multiple haptic ticks need to fire on a timeline.
 *   4. Keeps the surface small: 7 named "kinds" cover everything we need.
 *
 * Design rules (iOS HIG):
 *   - Tie each tick to a visual beat, not to a fixed clock.
 *   - Crescendo, never staccato — light/selection ticks first, end on one
 *     impact or success. Never two heavy impacts back-to-back.
 *   - Total ≤ 500 ms of perceived haptic activity per moment.
 *   - On Reduce Motion: collapse choreographed sequences to one final tick.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { AccessibilityInfo } from 'react-native';

const STORAGE_KEY = 'clickefy:haptics:enabled';
const DEFAULT_ENABLED = true;

export type HapticKind =
  | 'selection'
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error';

let userEnabled = DEFAULT_ENABLED;
let reduceMotion = false;
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored !== null) userEnabled = stored === '1';
  } catch {
    // Storage failure is non-fatal — fall back to default.
  }
  try {
    reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
  } catch {
    reduceMotion = false;
  }
  AccessibilityInfo.addEventListener('reduceMotionChanged', (next) => {
    reduceMotion = next;
  });
}

// Kick off hydration on import — no await needed by callers.
void hydrate();

/** Whether haptics should actually fire right now. */
export function areHapticsEnabled(): boolean {
  return userEnabled && !reduceMotion;
}

/** Toggle the user preference + persist. Call from Profile / Settings. */
export async function setHapticsEnabled(enabled: boolean): Promise<void> {
  userEnabled = enabled;
  await AsyncStorage.setItem(STORAGE_KEY, enabled ? '1' : '0').catch(() => {});
}

/**
 * Fire one haptic immediately.
 * No-op if haptics are disabled or Reduce Motion is on.
 */
export function tap(kind: HapticKind = 'light'): void {
  if (!areHapticsEnabled()) return;
  switch (kind) {
    case 'selection':
      void Haptics.selectionAsync();
      return;
    case 'light':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    case 'medium':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    case 'heavy':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    case 'success':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    case 'warning':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    case 'error':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
  }
}

export interface ChoreographStep {
  /** Milliseconds from when choreograph() is called. */
  at: number;
  kind: HapticKind;
}

/**
 * Schedule a sequence of haptic ticks at relative timestamps.
 *
 * Usage:
 *   const cancel = choreograph([
 *     { at: 120, kind: 'selection' },
 *     { at: 240, kind: 'selection' },
 *     { at: 880, kind: 'medium' },
 *   ]);
 *   // Optionally call cancel() on unmount.
 *
 * If Reduce Motion is on (or haptics disabled), the sequence collapses to a
 * single final tick at the last step's `at` time — so the moment still
 * registers without flooding the user.
 *
 * Returns a cancel function. Safe to call multiple times.
 */
export function choreograph(steps: ReadonlyArray<ChoreographStep>): () => void {
  if (steps.length === 0) return () => {};

  // Reduce-motion collapse: single tick at the end of the sequence.
  if (!userEnabled) return () => {};
  if (reduceMotion) {
    const last = steps[steps.length - 1]!;
    const t = setTimeout(() => tap(last.kind), last.at);
    return () => clearTimeout(t);
  }

  const timers = steps.map((s) => setTimeout(() => tap(s.kind), s.at));
  return () => timers.forEach(clearTimeout);
}
