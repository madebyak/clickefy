/**
 * job-tracker — the app-wide record of generations in flight.
 *
 * The ChatGPT rule: leave the composer, switch projects, background the
 * app — a run you started keeps its "generating…" tile wherever its
 * project is shown, and the drawer says which projects have work going
 * on. That only holds if the record outlives any one screen, so it
 * lives here, in a module store the composer and the root bridge both
 * read, not in the composer's component state.
 *
 * Two sources feed it, and the server wins:
 *   • `trackJob` — the composer, the instant a submit succeeds, so the
 *     tile appears with zero latency.
 *   • `hydrateTrackedJobs` — the server's list of still-active runs, on
 *     sign-in, on app foreground and whenever the composer opens. Runs
 *     started on another device or before an app restart join the
 *     record here; runs the server no longer lists are dropped.
 *
 * ONE polling loop serves every tracked run: a single batched
 * `getJobs(ids)` per tick, backing off 1s → 2s → 4s while nothing
 * changes and snapping back to 1s when something does, paused while
 * the app is in the background. Per-job pollers at 1s each used to eat
 * the same read budget the project and asset lists need.
 *
 * Settled runs (ready / failed) stay until whoever renders them has
 * caught up — the composer prunes a ready run once its asset row is on
 * screen, a failed run stays until dismissed — with a TTL so nothing
 * lingers forever.
 */

import type { GenerationProgress, JobOutput } from '@clickfy/sdk';
import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { getSDK } from './sdk';

export interface TrackedJob {
  jobId: string;
  projectId: string;
  kind: 'image' | 'video';
  /** What the user typed — the tile's caption and Re-use source. */
  prompt: string;
  /** "3:4"-style shape for the pending tile. */
  aspectRatio: string;
  modelName?: string;
  qualityLabel?: string;
  durationSeconds?: number;
  /**
   * Set on a Draft-mode run started here: what its final costs, so a
   * fresh session (which has no asset list yet) can offer "Make final".
   */
  draft?: { modelKey: string; finalTier: string; finalCostCredits: number; validDays: number };
  /** When `trackJob` started tracking this run (ms). */
  trackedAt?: number;
  status: 'generating' | 'ready' | 'failed';
  pendingStatus?: 'queued' | 'processing';
  stageLabel?: string;
  /** 0–1 within the active stage. */
  stageProgress?: number;
  errorMessage?: string;
  /** Final outputs once ready. */
  outputs?: JobOutput[];
  /** When the run settled (ready/failed), for the TTL sweep. */
  settledAt?: number;
  /** True when learned from the server rather than started here. */
  hydrated?: boolean;
}

export type TrackJobInput = Omit<
  TrackedJob,
  | 'status'
  | 'pendingStatus'
  | 'stageLabel'
  | 'stageProgress'
  | 'errorMessage'
  | 'outputs'
  | 'settledAt'
  | 'trackedAt'
>;

/** Polling cadence: fast while things move, easing off while they don't. */
const POLL_MIN_MS = 1_000;
const POLL_MAX_MS = 4_000;
/** How long a settled run stays in the record if nobody prunes it. */
const SETTLED_TTL_MS = 10 * 60_000;
/** The batch endpoint's cap; more than this is polled in rotation. */
const BATCH_MAX = 20;

const jobs = new Map<string, TrackedJob>();
const listeners = new Set<() => void>();
let snapshot: TrackedJob[] = [];
let settledListener: ((job: TrackedJob) => void) | null = null;

let timer: ReturnType<typeof setTimeout> | null = null;
let delay = POLL_MIN_MS;
let inFlight = false;
let foreground = AppState.currentState === 'active';
let rotation = 0;

function publish(): void {
  snapshot = Array.from(jobs.values());
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every tracked run, newest submission last. Stable between changes. */
export function useTrackedJobs(): TrackedJob[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Start tracking a run this device just submitted. */
export function trackJob(input: TrackJobInput): void {
  if (jobs.has(input.jobId)) return;
  jobs.set(input.jobId, { ...input, status: 'generating', pendingStatus: 'queued', trackedAt: Date.now() });
  publish();
  delay = POLL_MIN_MS;
  schedule(0);
}

/** Drop runs from the record — a dismissed failure, or ready runs the grid has absorbed. */
export function untrackJobs(jobIds: Iterable<string>): void {
  let changed = false;
  for (const id of jobIds) changed = jobs.delete(id) || changed;
  if (changed) publish();
}

/** Forget everything — sign-out. */
export function clearTrackedJobs(): void {
  jobs.clear();
  stop();
  publish();
}

/**
 * The root bridge registers this to invalidate queries when a run
 * settles; the store itself stays ignorant of React Query.
 */
export function setJobSettledListener(fn: ((job: TrackedJob) => void) | null): void {
  settledListener = fn;
}

/**
 * Reconcile with the server's list of still-active runs: adopt the ones
 * this record does not know (started elsewhere, or before a restart)
 * and drop generating runs the server no longer lists as active — they
 * settled while we were away, and their assets arrive by refetch.
 */
export async function hydrateTrackedJobs(): Promise<void> {
  const { items } = await getSDK().library.listProjects({ limit: 50, status: 'active' });
  const active = new Set<string>();
  let changed = false;

  for (const run of items) {
    if (run.status !== 'queued' && run.status !== 'processing') continue;
    if (!run.projectId) continue; // nowhere to show a tile
    active.add(run.id);
    if (jobs.has(run.id)) continue;
    jobs.set(run.id, {
      jobId: run.id,
      projectId: run.projectId,
      kind: run.templateKind === 'video' ? 'video' : 'image',
      prompt: run.source === 'user' ? run.title : '',
      aspectRatio: run.templateKind === 'video' ? '16:9' : '1:1',
      modelName: run.source === 'user' ? run.templateName : undefined,
      status: 'generating',
      pendingStatus: run.status,
      hydrated: true,
    });
    changed = true;
  }

  for (const job of jobs.values()) {
    if (job.status === 'generating' && !active.has(job.jobId)) {
      jobs.delete(job.jobId);
      changed = true;
    }
  }

  if (changed) publish();
  if (activeIds().length > 0) {
    delay = POLL_MIN_MS;
    schedule(0);
  }
}

// ─── Polling ────────────────────────────────────────────────────────

function activeIds(): string[] {
  const ids: string[] = [];
  for (const job of jobs.values()) if (job.status === 'generating') ids.push(job.jobId);
  return ids;
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!foreground) return;
  timer = setTimeout(() => void tick(), ms);
}

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

async function tick(): Promise<void> {
  timer = null;
  if (inFlight || !foreground) return;
  sweepSettled();
  const ids = activeIds();
  if (ids.length === 0) return;

  // More than one batch: rotate so every run is refreshed in turn.
  const batch =
    ids.length <= BATCH_MAX
      ? ids
      : ids.slice(rotation % ids.length).concat(ids).slice(0, BATCH_MAX);
  rotation += BATCH_MAX;

  inFlight = true;
  let changed = false;
  try {
    const statuses = await getSDK().generation.getJobs(batch);
    for (const s of statuses) changed = apply(s) || changed;
  } catch {
    // Network blip or rate limit: back off, keep the tiles; nothing to
    // tell the user that the next tick will not resolve.
  } finally {
    inFlight = false;
  }

  delay = changed ? POLL_MIN_MS : Math.min(delay * 2, POLL_MAX_MS);
  if (changed) publish();
  if (activeIds().length > 0) schedule(delay);
}

/** Fold one status into the record; true when anything visible moved. */
function apply(s: GenerationProgress): boolean {
  const job = jobs.get(s.jobId);
  if (!job || job.status !== 'generating') return false;

  if (s.status === 'completed') {
    const next: TrackedJob = {
      ...job,
      status: 'ready',
      outputs: s.outputs,
      pendingStatus: undefined,
      stageLabel: undefined,
      stageProgress: undefined,
      settledAt: Date.now(),
    };
    jobs.set(job.jobId, next);
    settledListener?.(next);
    return true;
  }
  if (s.status === 'failed') {
    const next: TrackedJob = {
      ...job,
      status: 'failed',
      errorMessage: s.error,
      pendingStatus: undefined,
      settledAt: Date.now(),
    };
    jobs.set(job.jobId, next);
    settledListener?.(next);
    return true;
  }

  const pendingStatus = s.status;
  const moved =
    job.pendingStatus !== pendingStatus ||
    job.stageLabel !== s.stageLabel ||
    job.stageProgress !== s.stageProgress;
  if (moved) {
    jobs.set(job.jobId, {
      ...job,
      pendingStatus,
      stageLabel: s.stageLabel,
      stageProgress: s.stageProgress,
    });
  }
  return moved;
}

function sweepSettled(): void {
  const cutoff = Date.now() - SETTLED_TTL_MS;
  let changed = false;
  for (const job of jobs.values()) {
    if (job.settledAt !== undefined && job.settledAt < cutoff) {
      jobs.delete(job.jobId);
      changed = true;
    }
  }
  if (changed) publish();
}

// The loop sleeps in the background and, on return, reconciles with the
// server before polling again — a run may have settled meanwhile.
AppState.addEventListener('change', (state: AppStateStatus) => {
  const wasForeground = foreground;
  foreground = state === 'active';
  if (!foreground) {
    stop();
  } else if (!wasForeground) {
    delay = POLL_MIN_MS;
    void hydrateTrackedJobs().catch(() => undefined);
  }
});
