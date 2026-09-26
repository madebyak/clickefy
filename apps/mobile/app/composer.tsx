/**
 * Composer — the Create surface. Full-screen over the tabs (launched
 * from the Create tab, dismissed with ✕), structured as a conversation
 * with the generator:
 *
 *   ☰  Create / <project>       [total credits] ✕
 *   ───────────────────────────────────────────
 *   ONE content surface: a web-style masonry — the session's own
 *   generations (skeleton → media in place), plus the open project's
 *   assets when one is selected from the drawer.
 *   ───────────────────────────────────────────
 *   (Image)(Model)(Ratio)(Quality)(Duration)(Sound)   ← pills → sheets
 *   [ attachments / prompt / + / Generate · N cr ]
 *
 * WIRED. Contracts verified against the web studio's source (see the
 * composer-wiring notes): submit payload mirrors prompt-bar's, the
 * idempotency key is a header rotated only after confirmed success,
 * fresh sessions file into a server-created project that auto-titles
 * from the first prompt, polling caps concurrency to respect
 * RL_USER_READ, and failures never promise refunds (the server refunds
 * infra failures on its own; we just refresh the balance).
 */

import { accents, useTheme } from '@clickfy/ui';
import { useAuth, useUser } from '@clerk/expo';
import { JobSubmissionError, type CreateGenerationInput, type GenModel } from '@clickfy/sdk';
import { resolveCreditCost } from '@clickfy/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiConsentSheet } from '@/components/AiConsentSheet';
import { AssetDetailsDrawer } from '@/components/composer/AssetDetailsDrawer';
import { AssetViewer } from '@/components/composer/AssetViewer';
import { AttachSheet, type AttachAction } from '@/components/composer/AttachSheet';
import { ComposerHeader } from '@/components/composer/ComposerHeader';
import {
  ProjectMasonry,
  type MasonryCell,
  type MasonryLabels,
} from '@/components/composer/ProjectMasonry';
import { PromptDock, type DockAttachment } from '@/components/composer/PromptDock';
import {
  RecentsDrawer,
  type DrawerFolder,
  type DrawerRecentRef,
} from '@/components/composer/RecentsDrawer';
import { OptionPillsRow, type PillSpec } from '@/components/composer/pills';
import {
  DurationSheet,
  ModeSheet,
  OptionsSheet,
  RatioSheet,
  type ComposerMode,
} from '@/components/composer/sheets';
import type { AssetDraft, AssetInfo } from '@/components/composer/asset-info';
import { MODE_TINT } from '@/components/composer/mode-colors';
import { ModelLogo } from '@/components/create/ModelLogo';
import { useToast } from '@/components/shared/Toast';
import { hasAiConsent, setAiConsent } from '@/lib/ai-consent';
import { downloadOutput } from '@/lib/download';
import { outputThumbnailUrl } from '@/lib/image-url';
import {
  hydrateTrackedJobs,
  trackJob,
  untrackJobs,
  useTrackedJobs,
  type TrackedJob,
} from '@/lib/job-tracker';
import { useRelativeTime } from '@/lib/relative-time';
import { getSDK } from '@/lib/sdk';
import { ME_QUERY_KEY, useSession } from '@/lib/use-session';
import {
  uploadRemoteUrl,
  useImageUpload,
  type PickedUpload,
} from '@/lib/use-image-upload';
import type { UploadedMedia } from '@/components/use-template/InputField';

type SheetName = 'mode' | 'model' | 'ratio' | 'quality' | 'duration' | 'input' | 'attach' | null;

/** One in-flight or finished generation from THIS session. */
/**
 * A generation shown as a session card: the app-wide tracker's record
 * (see lib/job-tracker.ts — it outlives this screen, which is what keeps
 * a tile alive across navigation). Its first output, once ready, is the
 * card's media: the original for the viewer and Save to Photos, the
 * poster/preview/thumbhash renditions for the grid.
 */
type Artifact = TrackedJob;

/** The quality sheet's Draft-mode row — not a tier key any model uses. */
const DRAFT_OPTION_ID = '__draft__';

/**
 * A submission's credit cost: the resolver the server bills with, over
 * the model's tier map including its `${tier}_audio` keys.
 */
function creditCost(
  model: GenModel,
  opts: { mode: string | undefined; sound: boolean; duration: number | undefined },
): number {
  return resolveCreditCost({
    baseCredits: model.costCredits,
    tierPricing: model.tiers
      ? Object.fromEntries(
          model.tiers.flatMap((x) => [
            [x.mode, x.costCredits] as [string, number],
            ...(x.soundCostCredits != null
              ? [[`${x.mode}_audio`, x.soundCostCredits] as [string, number]]
              : []),
          ]),
        )
      : null,
    mode: opts.mode,
    sound: opts.sound,
    duration: model.kind === 'video' ? opts.duration : undefined,
    defaultDuration: model.defaultDuration,
  });
}

/** One attachment in the dock: preview + its persisted upload (null while in flight). */
interface ComposerAttachment {
  id: string;
  previewUri: string | number;
  media: UploadedMedia | null;
}

/** RL_USER_READ (240/min) affords ~4 jobs polling at 1s; cap below that. */
const MAX_CONCURRENT_JOBS = 3;

function idempotencyKey(): string {
  const hex = (n: number) =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}

/**
 * Drawer cover at its 38pt slot: an image resized for the row, a video's
 * poster frame, and the ThumbHash that paints before either arrives (or
 * alone, for a video filed before it had a poster).
 */
function coverThumb(
  cover: { kind: 'image' | 'video'; url: string; posterUrl: string | null; thumbhash?: string | null } | null,
): { coverUri?: string; coverThumbhash?: string } {
  if (!cover) return {};
  const still = cover.kind === 'video' ? cover.posterUrl : cover.url;
  return {
    coverUri: still ? outputThumbnailUrl(still, { width: 38 }) : undefined,
    coverThumbhash: cover.thumbhash ?? undefined,
  };
}

/** Masonry cell shape from real dimensions, clamped like web's grid. */
function ratioFrom(width: number | null, height: number | null, kind: 'image' | 'video'): string {
  const raw = width && height && height > 0 ? width / height : kind === 'video' ? 16 / 9 : 1;
  const clamped = Math.min(2.4, Math.max(0.45, raw));
  return `${Math.round(clamped * 100)}:100`;
}

// ─── Screen ─────────────────────────────────────────────────────────

export default function ComposerScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation('create');
  const { plan } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const sdk = getSDK();
  const { user: clerkUser } = useUser();
  const consentUserId = clerkUser?.id ?? '';
  // Authed queries wait for a session to sign with — an early
  // unauthenticated fetch fails and used to render as an empty project.
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const authReady = authLoaded && !!isSignedIn;
  const { pickFromSource } = useImageUpload();

  // ── Entry params (Projects tab / result screen) ────────────────────
  // `projectId` opens that project; `mode=video` + `attachUrl` is
  // "Turn into video": the image rides along as the clip's start frame
  // with an empty prompt, exactly like the in-composer action. The
  // composer is pushed fresh for every entry, so these seed initial
  // state rather than being reapplied.
  const params = useLocalSearchParams<{ projectId?: string; mode?: string; attachUrl?: string }>();

  const [mode, setMode] = useState<ComposerMode>(params.mode === 'video' ? 'video' : 'image');

  // ── Roster (same query + rules as web / the old tab) ─────────────
  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: () => sdk.models.listModels(),
    staleTime: 5 * 60_000,
  });
  const models = useMemo(
    () => (modelsQuery.data ?? []).filter((m) => !m.toolOnly),
    [modelsQuery.data],
  );
  const modeModels = useMemo(
    () => models.filter((m) => (m.kind === 'video' ? 'video' : 'image') === mode),
    [models, mode],
  );

  // `null` = "no explicit pick yet": the default DERIVES from the
  // roster, so a refetch can't clobber a user's choice.
  const [modelByMode, setModelByMode] = useState<Record<ComposerMode, string | null>>({
    image: null,
    video: null,
  });
  const model = useMemo<GenModel | undefined>(
    () => modeModels.find((m) => m.modelKey === modelByMode[mode]) ?? modeModels[0],
    [modeModels, modelByMode, mode],
  );

  // ── Option state ──────────────────────────────────────────────────
  const [ratio, setRatio] = useState<string | undefined>(undefined);
  const [tier, setTier] = useState<string | undefined>(undefined);
  // Draft mode (Seedance 2.5): a cheap preview; the final is made from it.
  const [draft, setDraft] = useState(false);
  // Frames ⇄ References on models that offer both; `null` = the model's
  // default. "Turn into video" arrives wanting its image as the START
  // frame, so it opens in Frames.
  const [attachChoice, setAttachChoice] = useState<'frames' | 'references' | null>(
    params.attachUrl ? 'frames' : null,
  );
  const [duration, setDuration] = useState<number | undefined>(undefined);
  // Web parity: sound defaults ON for sound-capable models; `null`
  // means "no explicit choice yet" so the default derives per model.
  const [soundChoice, setSoundChoice] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const trackedJobs = useTrackedJobs();
  const [sheet, setSheetState] = useState<SheetName>(null);
  // Opening any sheet retires the keyboard first — a sheet sliding up
  // under an open keyboard reads as two stacked surfaces fighting.
  const setSheet = (next: SheetName) => {
    if (next !== null) Keyboard.dismiss();
    setSheetState(next);
  };
  // iOS drops a picker presented while a modal is dismissing — a tapped
  // attach action waits for the sheet's onDismissed before launching.
  const pendingPickRef = useRef<'camera' | 'photos' | null>(null);
  const [drawer, setDrawer] = useState(false);
  // The dock's bottom spacing: the home-indicator inset while resting,
  // nearly nothing while the keyboard supplies its own bottom edge —
  // otherwise the inset is double-counted as a floating gap.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEvt, () => setKeyboardUp(true));
    const s2 = Keyboard.addListener(hideEvt, () => setKeyboardUp(false));
    return () => {
      s1.remove();
      s2.remove();
    };
  }, []);
  const [showConsent, setShowConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // The ChatGPT-style context: null = fresh session (chat feed); an id
  // = that project is open, its media fills the content area and new
  // generations file into it.
  const [openProjectId, setOpenProjectId] = useState<string | null>(params.projectId ?? null);
  const [viewerAsset, setViewerAsset] = useState<AssetInfo | null>(null);
  const [detailsAsset, setDetailsAsset] = useState<AssetInfo | null>(null);

  // A fresh session's server project, created lazily on the first
  // generate (never named client-side — the server auto-titles it from
  // the prompt, matching web). Reset by "New session".
  const sessionProjectRef = useRef<string | null>(null);
  // The ref guards two rapid generates from creating two projects; the
  // state mirror is what the render reads to scope the session's cards.
  const [sessionProjectId, setSessionProjectId] = useState<string | null>(null);
  // One idempotency key per submission attempt-sequence: a retry after
  // a timeout re-sends the SAME key so the server dedupes instead of
  // charging twice. Rotated only after a confirmed success.
  const submitKeyRef = useRef(idempotencyKey());

  // The cards this screen shows: the tracker's runs for the context in
  // front of the user — the open project, or the fresh session's own
  // project once its first generate created one. Runs from other
  // projects stay in the tracker (the drawer marks them) but off this
  // surface, ChatGPT-style. Reconcile with the server on open so runs
  // started elsewhere, or before a restart, show their tiles too.
  const scopeProjectId = openProjectId ?? sessionProjectId;
  const artifacts = useMemo(
    () => (scopeProjectId ? trackedJobs.filter((j) => j.projectId === scopeProjectId) : []),
    [trackedJobs, scopeProjectId],
  );
  useEffect(() => {
    void hydrateTrackedJobs().catch(() => undefined);
  }, []);

  // ── Projects (drawer + open-project content) ─────────────────────
  const projectsQuery = useQuery({
    queryKey: ['studio-projects'],
    queryFn: () => sdk.projects.list({ limit: 50 }),
    enabled: authReady,
    staleTime: 15_000,
  });
  const assetsQuery = useQuery({
    queryKey: ['project-assets', openProjectId],
    queryFn: () => sdk.projects.listAssets(openProjectId!, { limit: 50 }),
    enabled: authReady && openProjectId !== null,
    staleTime: 15_000,
  });

  const relTime = useRelativeTime();

  // Which projects have work in flight — the server's count for runs
  // started anywhere, plus the tracker's for what this device just
  // submitted (ahead of the next list refetch).
  const generatingProjects = useMemo(() => {
    const set = new Set<string>();
    for (const p of projectsQuery.data?.projects ?? []) {
      if ((p.activeJobCount ?? 0) > 0) set.add(p.id);
    }
    for (const j of trackedJobs) if (j.status === 'generating') set.add(j.projectId);
    return set;
  }, [projectsQuery.data, trackedJobs]);

  const drawerFolders = useMemo<DrawerFolder[]>(() => {
    const data = projectsQuery.data;
    if (!data) return [];
    return data.folders.map((f) => ({
      id: f.id,
      name: f.name,
      projects: data.projects
        .filter((p) => p.folderId === f.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          countLabel: t('composer.items', { count: p.assetCount }),
          generating: generatingProjects.has(p.id),
          ...coverThumb(p.cover),
        })),
    }));
  }, [projectsQuery.data, generatingProjects, t]);

  // "Recent" = the server's updated_at ordering, folder-filed or not —
  // the flat "pick up where I left off" list.
  const drawerRecents = useMemo<DrawerRecentRef[]>(() => {
    const data = projectsQuery.data;
    if (!data) return [];
    return data.projects.map((p) => ({
      id: p.id,
      name: p.name,
      when: relTime(p.updatedAt),
      generating: generatingProjects.has(p.id),
      ...coverThumb(p.cover),
    }));
  }, [projectsQuery.data, generatingProjects, relTime]);

  const openProjectName = useMemo(
    () => projectsQuery.data?.projects.find((p) => p.id === openProjectId)?.name ?? null,
    [projectsQuery.data, openProjectId],
  );

  // ── Effective option values (fall back to the model's defaults) ──
  // Web parity: "Auto" is an image-only affordance (omitted from the
  // payload at submit); video providers REQUIRE an explicit ratio.
  const ratios = useMemo(() => {
    if (!model) return [];
    return model.kind === 'video' ? model.aspectRatios : ['Auto', ...model.aspectRatios];
  }, [model]);
  const effRatio = ratio && ratios.includes(ratio) ? ratio : ratios[0];
  const effTier = model?.tiers?.some((x) => x.mode === tier)
    ? tier
    : model?.defaultTier ?? model?.tiers?.[0]?.mode;
  const effDuration =
    model && model.durations.length > 0
      ? duration && model.durations.includes(duration)
        ? duration
        : model.durations[0]
      : undefined;

  // A draft is served — and billed — at the model's draft tier whatever
  // the quality pick; the server pins it the same way.
  const draftOn = draft && !!model?.draft;
  const billedTier = draftOn ? model!.draft!.tier : effTier;
  const draftTierLabel = model?.draft
    ? (model.tiers?.find((x) => x.mode === model.draft!.tier)?.label ?? model.draft.tier)
    : '';

  const sound = soundChoice ?? !!model?.supportsSound;
  // Native audio that can't play at the selected tier: the server drops
  // the audio rather than upgrading the billed resolution, so the price
  // follows suit.
  const soundGated = !!model?.soundRequiresTier && billedTier !== model.soundRequiresTier;
  const soundTierLabel =
    model?.tiers?.find((x) => x.mode === model.soundRequiresTier)?.label ??
    model?.soundRequiresTier ??
    '';

  // The same resolver the server bills with — tier + clip length + the
  // `${tier}_audio` keys for native audio.
  const soundServed = sound && !soundGated;
  const cost = model ? creditCost(model, { mode: billedTier, sound: soundServed, duration: effDuration }) : 0;
  const promptCap = model?.maxPromptChars ?? 2500;

  // ── Attachment surfaces (frames vs references, per model) ─────────
  // Web parity: Seedance and the Kling reference models let the user pick
  // Frames ⇄ References and open in References — the richer input: images
  // that steer style, subject and composition. Every other model has one
  // fixed surface. The two cannot be mixed upstream.
  const modeIsChoosable = model?.attachments === 'seedance' || model?.supportsReferenceMode === true;
  const defaultAttach =
    model?.attachments === 'frames' && !model.supportsReferenceMode ? 'frames' : 'references';
  const useFrames = model
    ? modeIsChoosable
      ? (attachChoice ?? defaultAttach) === 'frames'
      : model.attachments !== 'references'
    : false;
  const attachmentCap = useFrames ? (model?.supportsEndFrame ? 2 : 1) : model?.maxImages ?? 6;
  const uploadsInFlight = attachments.some((a) => a.media === null);

  const selectModel = (key: string) => {
    setModelByMode((prev) => ({ ...prev, [mode]: key }));
    // New model, fresh option state — its own defaults apply.
    setRatio(undefined);
    setTier(undefined);
    setDraft(false);
    setAttachChoice(null);
    setDuration(undefined);
    setSoundChoice(null);
    setAttachments([]);
  };

  const switchMode = (m: ComposerMode) => {
    setMode(m);
    setRatio(undefined);
    setTier(undefined);
    setDraft(false);
    setAttachChoice(null);
    setDuration(undefined);
    setSoundChoice(null);
    setAttachments([]);
  };

  const appendUploads = useCallback(
    (picked: PickedUpload[], cap: number) => {
      if (picked.length === 0) return;
      setAttachments((prev) =>
        [
          ...prev,
          ...picked.map((u, i) => ({
            id: `${Date.now()}-${i}-${u.media.r2Key}`,
            previewUri: u.previewUri,
            media: u.media,
          })),
        ].slice(0, cap),
      );
    },
    [],
  );

  const pickAttachment = async (source: 'camera' | 'photos') => {
    const remaining = attachmentCap - attachments.length;
    if (remaining <= 0) return;
    const picked = await pickFromSource(source === 'camera' ? 'camera' : 'library', {
      multiple: !useFrames && remaining > 1,
      limit: remaining,
    });
    appendUploads(picked, attachmentCap);
  };

  /** Re-upload a remote asset (generated output) as a fresh reference. */
  const attachFromUrl = useCallback(
    async (url: string, cap: number, replace: boolean) => {
      const placeholderId = `remote-${Date.now()}`;
      setAttachments((prev) =>
        [...(replace ? [] : prev), { id: placeholderId, previewUri: url, media: null }].slice(0, cap),
      );
      const uploaded = await uploadRemoteUrl(url);
      if (!uploaded) {
        setAttachments((prev) => prev.filter((a) => a.id !== placeholderId));
        toast.error(t('composer.attachFailed'));
        return;
      }
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === placeholderId ? { ...a, previewUri: uploaded.previewUri, media: uploaded.media } : a,
        ),
      );
    },
    [toast, t],
  );

  // "Turn into video" arrives with the source image's URL: re-upload it
  // as the start frame once, on mount (see the entry-params note above).
  const attachedEntryRef = useRef(false);
  useEffect(() => {
    if (attachedEntryRef.current || !params.attachUrl) return;
    attachedEntryRef.current = true;
    void attachFromUrl(params.attachUrl, 2, true);
  }, [params.attachUrl, attachFromUrl]);

  const attachActions: AttachAction[] = [
    { id: 'camera', icon: 'camera', label: t('composer.attachCamera') },
    { id: 'photos', icon: 'imageStack', label: t('composer.attachPhotos') },
  ];

  // ── Generation ─────────────────────────────────────────────────────
  // App-wide, not per project: the cap protects the shared read budget.
  const generatingCount = trackedJobs.filter((a) => a.status === 'generating').length;
  const promptRequired = (model?.maxPromptChars ?? 2500) !== 0;
  const canGenerate =
    !!model &&
    !submitting &&
    !uploadsInFlight &&
    (!promptRequired || prompt.trim().length > 0) &&
    (!model.requiresStartFrame || (useFrames && attachments[0]?.media != null));

  const runGeneration = async () => {
    if (!model || !canGenerate) return;
    if (generatingCount >= MAX_CONCURRENT_JOBS) {
      toast.info(t('composer.tooManyRunning', { count: MAX_CONCURRENT_JOBS }));
      return;
    }
    setSubmitting(true);
    try {
      // Fresh sessions file into a lazily created project the server
      // auto-titles from this prompt (web behavior, verified).
      let projectId = openProjectId ?? sessionProjectRef.current;
      if (!projectId) {
        const project = await sdk.projects.create({ folderId: null });
        sessionProjectRef.current = project.id;
        setSessionProjectId(project.id);
        projectId = project.id;
        void qc.invalidateQueries({ queryKey: ['studio-projects'] });
      }

      const mediaRefs = attachments
        .filter((a) => a.media !== null)
        .map((a) => ({ kind: 'image' as const, ...a.media! }));

      const input: CreateGenerationInput = {
        modelKey: model.modelKey,
        prompt: prompt.trim().slice(0, promptCap),
        // "Auto" (image-only) = omit the field; video is always explicit.
        aspectRatio: !effRatio || effRatio === 'Auto' ? undefined : effRatio,
        duration: model.kind === 'video' ? effDuration : undefined,
        // A draft's tier is the server's to pin, not the picker's.
        quality: model.tiers && !draftOn ? effTier : undefined,
        draft: draftOn || undefined,
        sound: model.supportsSound ? sound && !soundGated : undefined,
        startFrame: useFrames ? mediaRefs[0] : undefined,
        endFrame: useFrames && model.supportsEndFrame ? mediaRefs[1] : undefined,
        references: useFrames ? [] : mediaRefs,
        projectId,
        idempotencyKey: submitKeyRef.current,
      };

      const res = await sdk.generation.createGenerate(input);
      // Confirmed success — only now may the key rotate.
      submitKeyRef.current = idempotencyKey();

      const cardRatio =
        !effRatio || effRatio === 'Auto' ? (mode === 'video' ? '16:9' : '1:1') : effRatio;
      // Into the app-wide tracker: the tile appears now and keeps
      // polling wherever the user goes next.
      trackJob({
        jobId: res.jobId,
        projectId,
        kind: mode,
        prompt: prompt.trim(),
        aspectRatio: cardRatio,
        modelName: model.name,
        qualityLabel: draftOn
          ? t('quality.draftValue', { tier: draftTierLabel })
          : model.tiers?.find((x) => x.mode === effTier)?.label,
        durationSeconds: model.kind === 'video' ? effDuration : undefined,
        draft:
          draftOn && model.draft
            ? {
                modelKey: model.modelKey,
                finalTier: model.draft.finalTier,
                // The same terms at the final tier — shown on the draft's
                // "Make final"; the server prices it again from the draft.
                finalCostCredits: creditCost(model, {
                  mode: model.draft.finalTier,
                  sound: soundServed,
                  duration: effDuration,
                }),
                validDays: model.draft.validDays,
              }
            : undefined,
      });
      setPrompt('');
      // Attachments deliberately survive (web parity) — iterate on the
      // same references without re-picking.
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    } catch (err) {
      if (err instanceof JobSubmissionError) {
        // The SDK's code union is stale — branch on the string.
        const code = err.code as string;
        if (code === 'insufficient_credits' || code === 'topup_locked') {
          alertInsufficientCredits(code, err.message);
        } else {
          // Validation refusals carry a human sentence — show it verbatim.
          Alert.alert(t('errors.genericTitle'), err.message);
        }
      } else {
        Alert.alert(
          t('errors.genericTitle'),
          err instanceof Error ? err.message : t('errors.genericMessage'),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const alertInsufficientCredits = (code: string, message: string) => {
    Alert.alert(
      t('errors.insufficientTitle'),
      code === 'topup_locked' ? message : t('errors.insufficientMessage'),
      [
        { text: t('composer.notNow'), style: 'cancel' },
        { text: t('composer.viewPlans'), onPress: () => router.push('/paywall') },
      ],
    );
  };

  // Every generation — a prompt or a draft's final — goes through the
  // AI-content consent first; the agreed action then runs.
  const afterConsentRef = useRef<() => void>(() => undefined);
  const withAiConsent = async (run: () => void) => {
    if (await hasAiConsent(consentUserId)) {
      run();
      return;
    }
    afterConsentRef.current = run;
    setShowConsent(true);
  };

  const onGeneratePress = async () => {
    if (!canGenerate) return;
    await withAiConsent(() => void runGeneration());
  };

  const onConsentAgree = async () => {
    setShowConsent(false);
    await setAiConsent(consentUserId);
    afterConsentRef.current();
  };

  // ── Draft → final ──────────────────────────────────────────────────
  // The provider re-renders the draft's own shot at the final tier from
  // the draft's task id, so the request is only the draft's job and model.
  // Finals asked for this session, draft job id → final job id, so a
  // tile flips to "Final already made" before the next refetch.
  const [finalsByDraft, setFinalsByDraft] = useState<Record<string, string>>({});
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const runMakeFinal = async (a: AssetInfo) => {
    const d = a.draft;
    const projectId = scopeProjectId;
    if (!d || !projectId || finalizingId) return;
    if (generatingCount >= MAX_CONCURRENT_JOBS) {
      toast.info(t('composer.tooManyRunning', { count: MAX_CONCURRENT_JOBS }));
      return;
    }
    setFinalizingId(a.id);
    try {
      const res = await sdk.generation.createGenerate({
        modelKey: d.modelKey,
        prompt: '',
        fromDraftJobId: d.jobId,
        projectId,
        // A fresh key per request: the server refuses a second final from
        // one draft, so a retry can never charge twice.
        idempotencyKey: idempotencyKey(),
      });
      setFinalsByDraft((prev) => ({ ...prev, [d.jobId]: res.jobId }));
      setViewerAsset(null);
      trackJob({
        jobId: res.jobId,
        projectId,
        kind: 'video',
        prompt: a.prompt,
        aspectRatio: a.ratio,
        modelName: a.modelName || undefined,
        qualityLabel: d.finalTier,
        durationSeconds: a.durationSeconds,
      });
      toast.success(t('composer.finalStarted'));
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: ['project-assets', projectId] });
    } catch (err) {
      const code = err instanceof JobSubmissionError ? (err.code as string) : '';
      if (code === 'insufficient_credits' || code === 'topup_locked') {
        alertInsufficientCredits(code, (err as Error).message);
      } else if (code === 'draft_already_finalized') {
        toast.info(t('composer.finalAlreadyRequested'));
      } else if (code === 'draft_expired') {
        toast.error(t('composer.draftExpired'));
      } else {
        Alert.alert(
          t('errors.genericTitle'),
          err instanceof Error ? err.message : t('errors.genericMessage'),
        );
      }
    } finally {
      setFinalizingId(null);
    }
  };
  const makeFinal = (a: AssetInfo) => void withAiConsent(() => void runMakeFinal(a));

  // ── Asset viewer / details ─────────────────────────────────────────
  const artifactInfo = (a: Artifact): AssetInfo => {
    const out = a.outputs?.[0];
    return {
      id: a.jobId,
      kind: a.kind,
      ratio: a.aspectRatio,
      uri: out?.url ?? '',
      posterUri: out?.posterUrl ?? undefined,
      thumbhash: out?.thumbhash ?? undefined,
      prompt: a.prompt,
      modelName: a.modelName ?? '',
      when: t('common:time.justNow'),
      quality: a.qualityLabel,
      durationSeconds: a.durationSeconds,
      draft:
        a.draft && a.status === 'ready'
          ? {
              jobId: a.jobId,
              modelKey: a.draft.modelKey,
              finalTier: a.draft.finalTier,
              finalCostCredits: a.draft.finalCostCredits,
              // The server's window from submission, less its hour of margin.
              expiresAt: new Date(
                (a.trackedAt ?? 0) + a.draft.validDays * 86_400_000 - 3_600_000,
              ).toISOString(),
              finalJobId: finalsByDraft[a.jobId] ?? null,
            }
          : undefined,
    };
  };

  const cellInfo = (cell: MasonryCell): AssetInfo | null => {
    const art = artifacts.find((a) => a.jobId === cell.id);
    if (art) return artifactInfo(art);
    const asset = assetsQuery.data?.items.find((a) => a.id === cell.id);
    if (!asset) return null;
    return {
      id: asset.id,
      kind: asset.kind,
      ratio: ratioFrom(asset.width, asset.height, asset.kind),
      uri: asset.url, // the original — the viewer plays it, the download saves it
      posterUri: asset.posterUrl ?? undefined,
      thumbhash: asset.thumbhash ?? undefined,
      prompt: '',
      modelName: '',
      when: relTime(asset.createdAt),
      durationSeconds: asset.durationSec ?? undefined,
      draft:
        asset.draft && asset.jobId
          ? {
              jobId: asset.jobId,
              ...asset.draft,
              finalJobId: asset.draft.finalJobId ?? finalsByDraft[asset.jobId] ?? null,
            }
          : undefined,
    };
  };

  const openCell = (cell: MasonryCell) => {
    const info = cellInfo(cell);
    if (info) setViewerAsset(info);
  };

  /** ⋯ — pull real provenance off the job record, like web's info panel. */
  const openDetails = async (base: AssetInfo) => {
    const art = artifacts.find((a) => a.jobId === base.id);
    if (art || !openProjectId) {
      setDetailsAsset(base);
      return;
    }
    setDetailsAsset(base); // show immediately; enrich when the fetch lands
    try {
      const detail = await sdk.projects.getAsset(openProjectId, base.id);
      const gen = detail.generation;
      setDetailsAsset((prev) =>
        prev && prev.id === base.id
          ? {
              ...prev,
              // Template prompts are ours, not the user's — the server
              // already nulls them; show only what came back.
              prompt: gen?.prompt ?? '',
              modelName: gen?.modelName ?? gen?.modelKey ?? '',
              quality: gen?.quality ?? prev.quality,
              durationSeconds: gen?.duration ?? prev.durationSeconds,
            }
          : prev,
      );
    } catch {
      // The sheet still shows the basics; provenance just stays blank.
    }
  };

  const attachAsReference = (a: AssetInfo) => {
    setViewerAsset(null);
    if (typeof a.uri !== 'string' || a.kind !== 'image') return;
    void attachFromUrl(a.uri, attachmentCap, false);
  };

  const reuseAsset = (a: AssetInfo) => {
    setViewerAsset(null);
    if (a.kind !== mode) switchMode(a.kind);
    setPrompt(a.prompt);
  };

  const turnIntoVideo = (a: AssetInfo) => {
    setViewerAsset(null);
    if (typeof a.uri !== 'string') return;
    if (mode !== 'video') switchMode('video');
    // The image rides along as the clip's start frame — Frames, even on a
    // model that opens in References — and the prompt clears so the user
    // describes the MOTION (web behavior).
    setAttachChoice('frames');
    setPrompt('');
    void attachFromUrl(a.uri, 2, true);
  };

  const saveAsset = async (a: AssetInfo) => {
    if (typeof a.uri !== 'string' || a.uri.length === 0) return;
    await downloadOutput({ kind: a.kind, url: a.uri }, {
      success: (m, d) => toast.success(m, d),
      error: (m, d) => toast.error(m, d),
    });
  };

  // ── Pills ──────────────────────────────────────────────────────────
  const pills: PillSpec[] = [
    {
      id: 'mode',
      label: t('composer.mode'),
      value: mode === 'image' ? t('composer.image') : t('composer.video'),
      icon: mode === 'image' ? 'image' : 'video',
      fill: { bg: MODE_TINT[mode].solid, fg: MODE_TINT[mode].fg },
      onPress: () => setSheet('mode'),
    },
    ...(model
      ? [
          {
            id: 'model',
            label: t('model.label'),
            value: model.name,
            onPress: () => setSheet('model'),
          } satisfies PillSpec,
        ]
      : []),
    ...(model && modeIsChoosable
      ? [
          {
            id: 'input',
            label: t('attachments.modeLabel'),
            value: useFrames ? t('attachments.modeFrames') : t('attachments.modeReferences'),
            onPress: () => setSheet('input'),
          } satisfies PillSpec,
        ]
      : []),
    ...(model && ratios.length > 0
      ? [
          {
            id: 'ratio',
            label: t('aspect.label'),
            value: effRatio,
            onPress: () => setSheet('ratio'),
          } satisfies PillSpec,
        ]
      : []),
    ...(model?.tiers && model.tiers.length > 0
      ? [
          {
            id: 'quality',
            label: t('quality.label'),
            value: draftOn
              ? t('quality.draftValue', { tier: draftTierLabel })
              : (model.tiers.find((x) => x.mode === effTier)?.label ?? effTier),
            onPress: () => setSheet('quality'),
          } satisfies PillSpec,
        ]
      : []),
    ...(model && model.kind === 'video' && model.durations.length > 0
      ? [
          {
            id: 'duration',
            label: t('duration.label'),
            value: t('duration.seconds', { count: effDuration }),
            onPress: () => setSheet('duration'),
          } satisfies PillSpec,
        ]
      : []),
    // Native audio (Kling Omni): a direct toggle, no sheet. Web parity:
    // a gated tier keeps the pill visible and a tap EXPLAINS the
    // requirement instead of toggling.
    ...(model?.supportsSound
      ? [
          {
            id: 'sound',
            label: t('sound.label'),
            value: `${t('sound.label')} ${sound && !soundGated ? t('composer.on') : t('composer.off')}`,
            onPress: () => {
              if (soundGated) {
                toast.info(t('composer.soundNeedsTier', { tier: soundTierLabel }));
                return;
              }
              setSoundChoice(!sound);
            },
          } satisfies PillSpec,
        ]
      : []),
  ];

  // ── Content cells: ONE surface. Session work leads (newest first),
  // then — with a project open — its settled assets. ──────────────────
  const artifactCell = (a: Artifact): MasonryCell => {
    const out = a.outputs?.[0];
    return {
      id: a.jobId,
      kind: a.kind,
      ratio: a.aspectRatio,
      uri: a.kind === 'video' ? (out?.posterUrl ?? undefined) : out?.url,
      thumbhash: out?.thumbhash ?? undefined,
      videoUrl:
        a.kind === 'video' && a.status === 'ready' ? (out?.previewUrl ?? out?.url) : undefined,
      pending: a.status === 'generating',
      pendingStatus: a.pendingStatus,
      stageLabel: a.stageLabel,
      stageProgress: a.stageProgress,
      failed: a.status === 'failed',
      errorMessage: a.errorMessage,
    };
  };

  // A ready run whose asset row has arrived is the grid's now — let the
  // tracker forget it (a failed run stays until dismissed).
  useEffect(() => {
    const filed = new Set((assetsQuery.data?.items ?? []).map((a) => a.jobId));
    const absorbed = artifacts
      .filter((a) => a.status === 'ready' && filed.has(a.jobId))
      .map((a) => a.jobId);
    if (absorbed.length > 0) untrackJobs(absorbed);
  }, [artifacts, assetsQuery.data]);

  const draftBadge = t('composer.draftBadge');
  const masonryCells: MasonryCell[] = useMemo(() => {
    const sessionCells = artifacts
      .slice()
      .reverse()
      .map((a) => ({ ...artifactCell(a), badge: a.draft ? draftBadge : undefined }));
    if (!openProjectId) return sessionCells;
    const settled = (assetsQuery.data?.items ?? []).map<MasonryCell>((asset) => ({
      id: asset.id,
      kind: asset.kind,
      ratio: ratioFrom(asset.width, asset.height, asset.kind),
      uri: asset.kind === 'video' ? (asset.posterUrl ?? undefined) : asset.url,
      thumbhash: asset.thumbhash ?? undefined,
      // The grid loops the light preview rendition; the original stays
      // for the viewer and the download (`cellInfo` reads `asset.url`).
      videoUrl: asset.kind === 'video' ? (asset.previewUrl ?? asset.url) : undefined,
      badge: asset.draft ? draftBadge : undefined,
    }));
    // A completed artifact whose asset row already arrived would render
    // twice; the assets list wins.
    const settledJobIds = new Set(
      (assetsQuery.data?.items ?? []).map((a) => a.jobId).filter(Boolean),
    );
    return [...sessionCells.filter((c) => !settledJobIds.has(c.id)), ...settled];
  }, [openProjectId, artifacts, assetsQuery.data, draftBadge]);

  const masonryLabels: MasonryLabels = {
    menu: t('composer.assetMenu'),
    download: t('composer.download'),
    queued: t('composer.queuedLabel'),
    generating: t('composer.generatingLabel'),
    failed: t('composer.failed'),
    dismiss: t('composer.dismiss'),
    emptyTitle: t('composer.emptyTitle'),
    emptyBody: t('composer.emptyBody'),
    loadError: t('composer.loadError'),
  };

  const dockAttachments: DockAttachment[] = attachments.map((a, i) => ({
    id: a.id,
    previewUri: a.previewUri,
    uploading: a.media === null,
    slotLabel: useFrames
      ? i === 0
        ? t('attachments.startFrame')
        : t('attachments.endFrame')
      : undefined,
  }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <ComposerHeader
        title={openProjectName ?? t('composer.title')}
        credits={plan?.credits ?? 0}
        menuLabel={t('composer.menu')}
        closeLabel={t('composer.close')}
        onMenu={() => {
          Keyboard.dismiss();
          setDrawer(true);
        }}
        onClose={() => router.back()}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ProjectMasonry
          cells={masonryCells}
          labels={masonryLabels}
          loading={openProjectId !== null && assetsQuery.isLoading}
          error={
            openProjectId !== null && assetsQuery.isError
              ? { onRetry: () => void assetsQuery.refetch(), retrying: assetsQuery.isFetching }
              : null
          }
          onOpenCell={openCell}
          onCellMenu={(cell) => {
            const info = cellInfo(cell);
            if (info) void openDetails(info);
          }}
          onCellDownload={(cell) => {
            // `info.uri` is always the original file (never the grid
            // preview or the poster) — exactly what Save to Photos wants.
            const info = cellInfo(cell);
            if (info) void saveAsset(info);
          }}
          onDismissFailed={(cell) => untrackJobs([cell.id])}
        />

        <View style={{ gap: 10, paddingBottom: keyboardUp ? 8 : insets.bottom + 10, paddingTop: 4 }}>
          <OptionPillsRow pills={pills} />
          <PromptDock
            prompt={prompt}
            onPromptChange={setPrompt}
            placeholder={
              mode === 'image' ? t('composer.placeholderImage') : t('composer.placeholderVideo')
            }
            maxLength={promptCap}
            attachments={dockAttachments}
            onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
            onOpenAttach={() => setSheet('attach')}
            canGenerate={canGenerate}
            generating={submitting}
            generateLabel={
              model?.requiresStartFrame && !(useFrames && attachments[0]?.media)
                ? t('needStartFrame')
                : t('composer.generate', { count: cost })
            }
            tint={MODE_TINT[mode]}
            onGenerate={() => void onGeneratePress()}
          />
        </View>
      </KeyboardAvoidingView>

      {/* ── Sheets ── */}
      <ModeSheet
        visible={sheet === 'mode'}
        value={mode}
        labels={{ image: t('composer.image'), video: t('composer.video') }}
        title={t('composer.modeTitle')}
        tints={MODE_TINT}
        onSelect={switchMode}
        onClose={() => setSheet(null)}
      />
      <OptionsSheet
        visible={sheet === 'model'}
        title={t('model.sheetTitle')}
        options={modeModels.map((m) => ({
          id: m.modelKey,
          label: m.name,
          subtitle: m.kind === 'video' ? t('model.video') : t('model.image'),
          trailing: t('composer.fromCredits', { count: m.costCredits }),
          leading: (
            <ModelLogo provider={m.provider} kind={m.kind} size={24} fallbackColor={colors.ink} />
          ),
        }))}
        selectedId={model?.modelKey ?? null}
        tint={MODE_TINT[mode]}
        onSelect={selectModel}
        onClose={() => setSheet(null)}
      />
      <RatioSheet
        visible={sheet === 'ratio'}
        title={t('aspect.label')}
        ratios={ratios}
        value={effRatio}
        tint={MODE_TINT[mode]}
        onSelect={setRatio}
        onClose={() => setSheet(null)}
      />
      <OptionsSheet
        visible={sheet === 'quality'}
        title={t('quality.label')}
        options={[
          // Draft mode rides in the quality list: it IS a quality choice —
          // one fixed tier — so single-select says "this OR 1080p".
          ...(model?.draft
            ? [
                {
                  id: DRAFT_OPTION_ID,
                  label: draftTierLabel,
                  subtitle: t('quality.draftHint', { finalTier: model.draft.finalTier }),
                  trailing: t('composer.credits', {
                    count: model.tiers?.find((x) => x.mode === model.draft!.tier)?.costCredits ?? 0,
                  }),
                  badges: [
                    { text: t('quality.badgeDraft'), bg: accents.violet.solid, fg: accents.violet.ink },
                    { text: t('quality.badgeNew'), bg: accents.green.solid, fg: accents.green.ink },
                  ],
                },
              ]
            : []),
          ...(model?.tiers ?? []).map((x) => ({
            id: x.mode,
            label: x.label,
            trailing: t('composer.credits', { count: x.costCredits }),
          })),
        ]}
        selectedId={draftOn ? DRAFT_OPTION_ID : (effTier ?? null)}
        tint={MODE_TINT[mode]}
        onSelect={(id) => {
          if (id === DRAFT_OPTION_ID) {
            setDraft(true);
          } else {
            setTier(id);
            setDraft(false);
          }
        }}
        onClose={() => setSheet(null)}
      />
      <OptionsSheet
        visible={sheet === 'input'}
        title={t('attachments.modeLabel')}
        options={[
          { id: 'frames', label: t('attachments.modeFrames'), subtitle: t('attachments.framesHint') },
          {
            id: 'references',
            label: t('attachments.modeReferences'),
            subtitle: t('attachments.referencesHint', { count: model?.maxImages ?? 0 }),
          },
        ]}
        selectedId={useFrames ? 'frames' : 'references'}
        tint={MODE_TINT[mode]}
        onSelect={(id) => {
          const next = id === 'frames' ? 'frames' : 'references';
          // Exclusive upstream: what is attached belongs to the old mode.
          if ((next === 'frames') !== useFrames) setAttachments([]);
          setAttachChoice(next);
        }}
        onClose={() => setSheet(null)}
      />
      <DurationSheet
        visible={sheet === 'duration'}
        title={t('duration.label')}
        seconds={model?.durations ?? []}
        value={effDuration}
        format={(s) => t('duration.seconds', { count: s })}
        tint={MODE_TINT[mode]}
        onSelect={setDuration}
        onClose={() => setSheet(null)}
      />
      <AttachSheet
        visible={sheet === 'attach'}
        title={t('composer.attachTitle')}
        actions={attachActions}
        onAction={(id) => {
          pendingPickRef.current = id as 'camera' | 'photos';
        }}
        onDismissed={() => {
          const source = pendingPickRef.current;
          pendingPickRef.current = null;
          if (source) void pickAttachment(source);
        }}
        onClose={() => setSheet(null)}
      />
      <RecentsDrawer
        visible={drawer}
        title={t('composer.drawerTitle')}
        newSessionLabel={t('composer.drawerNewSession')}
        projectsLabel={t('composer.drawerProjects')}
        recentsLabel={t('composer.drawerRecents')}
        emptyLabel={t('composer.drawerEmpty')}
        folders={drawerFolders}
        recents={drawerRecents}
        error={
          projectsQuery.isError
            ? {
                message: t('composer.drawerLoadError'),
                onRetry: () => void projectsQuery.refetch(),
                retrying: projectsQuery.isFetching,
              }
            : null
        }
        activeProjectId={openProjectId}
        onNewSession={() => {
          setOpenProjectId(null);
          sessionProjectRef.current = null;
          setSessionProjectId(null);
          setPrompt('');
          setAttachments([]);
        }}
        onOpenProject={(projectId) => {
          // The tracker keeps every run; the surface just changes scope
          // to this project's — its own in-flight tiles come with it.
          setOpenProjectId(projectId);
          setAttachments([]);
        }}
        onClose={() => setDrawer(false)}
      />
      <AssetViewer
        asset={viewerAsset}
        closeLabel={t('composer.close')}
        detailsLabel={t('composer.assetMenu')}
        downloadLabel={t('composer.download')}
        makeFinalLabel={(d: AssetDraft) =>
          t('composer.makeFinal', { tier: d.finalTier, count: d.finalCostCredits })
        }
        finalizing={viewerAsset !== null && finalizingId === viewerAsset.id}
        onMakeFinal={makeFinal}
        onDetails={(a) => {
          setViewerAsset(null);
          void openDetails(a);
        }}
        onDownload={(a) => void saveAsset(a)}
        onClose={() => setViewerAsset(null)}
      />
      <AssetDetailsDrawer
        asset={detailsAsset}
        labels={{
          title: t('composer.detailsTitle'),
          makeFinal: (d) => t('composer.makeFinal', { tier: d.finalTier, count: d.finalCostCredits }),
          finalMade: t('composer.finalMade'),
          draftExpired: t('composer.draftExpired'),
          attach: t('composer.actionAttach'),
          reuse: t('composer.actionReuse'),
          turnVideo: t('composer.actionTurnVideo'),
          prompt: t('prompt.label'),
          copyPrompt: t('composer.copyPrompt'),
          copied: t('composer.copied'),
          model: t('model.label'),
          type: t('composer.fieldType'),
          typeImage: t('composer.image'),
          typeVideo: t('composer.video'),
          ratio: t('aspect.label'),
          quality: t('quality.label'),
          duration: t('duration.label'),
          durationSeconds: (sec) => t('duration.seconds', { count: sec }),
          created: t('composer.fieldCreated'),
        }}
        onAttach={attachAsReference}
        onReuse={reuseAsset}
        onTurnVideo={turnIntoVideo}
        onMakeFinal={makeFinal}
        onClose={() => setDetailsAsset(null)}
      />
      <AiConsentSheet
        visible={showConsent}
        onAgree={() => void onConsentAgree()}
        onCancel={() => setShowConsent(false)}
      />
    </View>
  );
}
