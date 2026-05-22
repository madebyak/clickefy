/**
 * Recent-search persistence for the mobile search screen.
 *
 * Stored locally in AsyncStorage as a newest-first ordered list of
 * trimmed query strings. We keep it strictly local — no server round-
 * trip — for two reasons:
 *
 *   1. Privacy: search queries can be intimate ("photo of my dad" /
 *      "wedding"); not something we want to ship to the backend until
 *      we have a real reason to (e.g. cross-device recents).
 *   2. Speed: the search screen renders before the network is even
 *      reachable; recents must paint instantly.
 *
 * Cap is intentionally small (`MAX = 10`) — any more turns the
 * "recents" rail into noise. NN/g's recommended cap for recents
 * lists is 5–10; we sit at the upper end because our queries tend
 * to be short and visually compact.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@clickfy/search/recents/v1';
const MAX = 10;

/** Read the persisted recents list. Returns `[]` on first launch / corruption. */
export async function getRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX);
  } catch {
    // Treat any I/O or JSON failure as "no history". The user can
    // still search; we just won't show old queries until the next
    // successful write replaces the bad blob.
    return [];
  }
}

/**
 * Push a query onto the recents list. Trims, de-dupes (case-insensitive)
 * and bumps existing matches to the front so the list reads as MRU.
 *
 * Accepts the empty/whitespace-only case as a no-op so callers can
 * fire it on every search submit without guarding.
 */
export async function pushRecentSearch(query: string): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) return;
  try {
    const current = await getRecentSearches();
    const lower = trimmed.toLowerCase();
    const deduped = current.filter((q) => q.toLowerCase() !== lower);
    const next = [trimmed, ...deduped].slice(0, MAX);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Persistence failures are non-critical — search still works.
  }
}

/** Remove a single recent. Used by the "x" affordance per row. */
export async function removeRecentSearch(query: string): Promise<void> {
  try {
    const current = await getRecentSearches();
    const lower = query.toLowerCase();
    const next = current.filter((q) => q.toLowerCase() !== lower);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/** Clear all recents — surfaced as a "Clear" action in the recents header. */
export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
