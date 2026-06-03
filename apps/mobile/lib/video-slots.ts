/**
 * video-slots — global concurrency limiter for autoplay preview players.
 *
 * The home feed can mount dozens of `TemplateCard`s, each of which would
 * otherwise spin up its own native video decoder (`ExoPlayer` on Android /
 * `AVPlayer` on iOS) the instant it renders. On real devices a handful of
 * simultaneous hardware decoders is fine, but a long feed blows past the
 * codec limit and triggers the fatal `OutOfMemoryError` / MediaCodec
 * crashes (and the device heat / lag) we saw in Sentry.
 *
 * This module is a tiny external store (no React tree, no context) that
 * hands out a bounded number of "play slots". A card asks for a slot when
 * it mounts; only the first `MAX_ACTIVE` holders are allowed to actually
 * decode video. Everyone else shows their static poster image until a slot
 * frees up (i.e. another card scrolls off and unmounts).
 *
 * Cards are keyed by a caller-supplied id and ref-counted, so the same
 * template appearing in two rails shares a single slot instead of
 * double-spending the budget.
 */

import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';

/**
 * Max number of preview videos allowed to decode at once across the whole
 * app. Tuned conservatively for low-end Android where the MediaCodec
 * budget is smallest. Bump cautiously — every extra slot is another live
 * hardware decoder + buffers.
 */
const MAX_ACTIVE = 4;

const active = new Set<string>();
const waiting: string[] = [];
/** How many mounted consumers reference each id (handles duplicates). */
const refCount = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Fill any free slots from the head of the waiting queue. */
function promote(): void {
  while (active.size < MAX_ACTIVE && waiting.length > 0) {
    const next = waiting.shift();
    if (next && !active.has(next)) active.add(next);
  }
}

/** Register interest in a play slot for `id` (call on mount). */
export function acquireSlot(id: string): void {
  refCount.set(id, (refCount.get(id) ?? 0) + 1);
  // Already accounted for (active or queued) — nothing to schedule.
  if (active.has(id) || waiting.includes(id)) {
    emit();
    return;
  }
  if (active.size < MAX_ACTIVE) {
    active.add(id);
  } else {
    waiting.push(id);
  }
  emit();
}

/** Drop interest in a play slot for `id` (call on unmount). */
export function releaseSlot(id: string): void {
  const remaining = (refCount.get(id) ?? 1) - 1;
  if (remaining > 0) {
    // Another mounted instance still wants this id — keep the slot.
    refCount.set(id, remaining);
    return;
  }
  refCount.delete(id);
  active.delete(id);
  const queuedAt = waiting.indexOf(id);
  if (queuedAt >= 0) waiting.splice(queuedAt, 1);
  promote();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Returns whether the card identified by `id` currently holds a play slot.
 *
 * When `id` is `undefined` the consumer opts out of the limiter entirely
 * and is always considered active (used by one-off players like the banner
 * and the template-detail hero, where there's only ever a single instance
 * on screen).
 */
export function useVideoSlot(id: string | undefined): boolean {
  const isActive = useSyncExternalStore(
    subscribe,
    () => (id ? active.has(id) : true),
    () => (id ? active.has(id) : true),
  );

  useEffect(() => {
    if (!id) return;
    acquireSlot(id);
    return () => releaseSlot(id);
  }, [id]);

  return id ? isActive : true;
}
