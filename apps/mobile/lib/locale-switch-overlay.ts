/**
 * Tiny external store for the language-switch overlay.
 *
 * The switch is triggered from a hook (`useLocaleSwitch`) but the overlay is
 * rendered once at the root (so it sits above every screen and survives until
 * the app reloads). A module-level pub/sub lets the two talk without threading
 * props or context through the whole tree.
 */

import { useSyncExternalStore } from 'react';

export interface LocaleSwitchOverlayState {
  active: boolean;
  /** Localized "Switching to …" message shown under the spinner. */
  label: string;
}

let state: LocaleSwitchOverlayState = { active: false, label: '' };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Show the full-screen overlay with the given message. */
export function showLocaleSwitchOverlay(label: string): void {
  state = { active: true, label };
  emit();
}

/** Hide the overlay (only needed on the rare non-reload paths). */
export function hideLocaleSwitchOverlay(): void {
  if (!state.active) return;
  state = { active: false, label: '' };
  emit();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): LocaleSwitchOverlayState {
  return state;
}

export function useLocaleSwitchOverlay(): LocaleSwitchOverlayState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
