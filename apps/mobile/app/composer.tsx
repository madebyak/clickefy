/**
 * Composer — the redesigned Create surface. Full-screen over the tabs
 * (launched from the Create tab, dismissed with ✕), structured like a
 * conversation with the generator:
 *
 *   ☰  Create                 [total credits] ✕
 *   ───────────────────────────────────────────
 *   artifact feed (empty state → generated work)
 *   ───────────────────────────────────────────
 *   (Image)(Model)(Ratio)(Quality)(Duration)      ← pills → bottom sheets
 *   [ attachments / prompt / + / Generate · N cr ]
 *
 * FRONT-END PHASE: everything on screen runs on the DEMO fixtures
 * below — no network, no uploads, no billing. Generate appends a
 * shimmer card that resolves to a bundled sample image, so the whole
 * flow is tangible while the design settles. Wiring swaps the fixtures
 * for `GET /v1/models` + `createGenerate` (the logic already proven in
 * the old create tab, see git history) without changing components.
 */

import { useTheme } from '@clickfy/ui';
import type { GenModel } from '@clickfy/sdk';
import { resolveCreditCost } from '@clickfy/types';
import { useQuery } from '@tanstack/react-query';
import { Asset } from 'expo-asset';
import * as MediaLibrary from 'expo-media-library';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArtifactFeed, type Artifact } from '@/components/composer/ArtifactFeed';
import { AttachSheet, type AttachAction } from '@/components/composer/AttachSheet';
import { ComposerHeader } from '@/components/composer/ComposerHeader';
import { PromptDock, type DockAttachment } from '@/components/composer/PromptDock';
import { RecentsDrawer } from '@/components/composer/RecentsDrawer';
import { OptionPillsRow, type PillSpec } from '@/components/composer/pills';
import {
  DurationSheet,
  ModeSheet,
  OptionsSheet,
  RatioSheet,
  type ComposerMode,
} from '@/components/composer/sheets';
import {
  DEMO_FOLDERS,
  DEMO_OUTPUTS,
  DEMO_PROJECT_DETAILS,
  DEMO_RECENT_PROJECTS,
} from '@/components/composer/demo-fixtures';
import { ProjectMasonry, type MasonryCell } from '@/components/composer/ProjectMasonry';
import { AssetViewer } from '@/components/composer/AssetViewer';
import { AssetDetailsDrawer } from '@/components/composer/AssetDetailsDrawer';
import type { AssetInfo } from '@/components/composer/asset-info';
import { MODE_TINT } from '@/components/composer/mode-colors';
import { ModelLogo } from '@/components/create/ModelLogo';
import { useToast } from '@/components/shared/Toast';
import { getSDK } from '@/lib/sdk';
import { useSession } from '@/lib/use-session';


type SheetName = 'mode' | 'model' | 'ratio' | 'quality' | 'duration' | 'attach' | null;

// ─── Screen ─────────────────────────────────────────────────────────

export default function ComposerScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation('create');
  const { plan } = useSession();
  const toast = useToast();

  const [mode, setMode] = useState<ComposerMode>('image');

  // SLICE 1 (wired): the real roster. Same query + rules as the old
  // create tab and the web: tool-only entries never reach the picker.
  const sdk = getSDK();
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

  // Remember the chosen model per mode so flipping Image⇄Video and back
  // doesn't lose the pick. `null` = "no explicit pick yet": the default
  // DERIVES from the roster, so a refetch can't clobber a user's choice.
  const [modelByMode, setModelByMode] = useState<Record<ComposerMode, string | null>>({
    image: null,
    video: null,
  });
  const model = useMemo<GenModel | undefined>(
    () => modeModels.find((m) => m.modelKey === modelByMode[mode]) ?? modeModels[0],
    [modeModels, modelByMode, mode],
  );

  const [ratio, setRatio] = useState<string | undefined>(undefined);
  const [tier, setTier] = useState<string | undefined>(undefined);
  const [duration, setDuration] = useState<number | undefined>(undefined);
  // Web parity: sound defaults ON for sound-capable models; `null`
  // means "no explicit choice yet" so the default derives per model.
  const [soundChoice, setSoundChoice] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<DockAttachment[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [drawer, setDrawer] = useState(false);
  // The ChatGPT-style context: null = fresh session (chat feed); an id =
  // that project is open, its media fills the content area (masonry) and
  // new generations file into it.
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const openProject = openProjectId ? (DEMO_PROJECT_DETAILS[openProjectId] ?? null) : null;
  const [viewerAsset, setViewerAsset] = useState<AssetInfo | null>(null);
  const [detailsAsset, setDetailsAsset] = useState<AssetInfo | null>(null);
  const demoCounter = useRef(0);

  // Effective values fall back to each model's own defaults, exactly
  // like the old tab: an explicit pick only sticks while the model
  // still offers it.
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

  const sound = soundChoice ?? !!model?.supportsSound;
  // Native audio that can't play at the selected tier: the server drops
  // the audio rather than upgrading the billed resolution, so the price
  // follows suit (same rule as the old tab / web).
  const soundGated =
    !!model?.soundRequiresTier && effTier !== model.soundRequiresTier;
  const soundTierLabel =
    model?.tiers?.find((x) => x.mode === model.soundRequiresTier)?.label ??
    model?.soundRequiresTier ??
    '';

  // The same resolver the server bills with — tier + clip length + the
  // `${tier}_audio` keys for native audio.
  const cost = model
    ? resolveCreditCost({
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
        mode: effTier,
        sound: sound && !soundGated,
        duration: model.kind === 'video' ? effDuration : undefined,
        defaultDuration: model.defaultDuration,
      })
    : 0;
  const promptCap = model?.maxPromptChars ?? 2500;
  const maxImages = model?.maxImages ?? 6;

  const selectModel = (key: string) => {
    setModelByMode((prev) => ({ ...prev, [mode]: key }));
    // New model, fresh option state — its own defaults apply.
    setRatio(undefined);
    setTier(undefined);
    setDuration(undefined);
    setSoundChoice(null);
    setAttachments([]);
  };

  const switchMode = (m: ComposerMode) => {
    setMode(m);
    setRatio(undefined);
    setTier(undefined);
    setDuration(undefined);
    setSoundChoice(null);
    setAttachments([]);
  };

  // ── Asset viewer / details (front-end phase: provenance is derived
  // from the fixtures; wiring reads it from the job record) ─────────
  const resolveAsset = (cellId: string): AssetInfo | null => {
    const art = artifacts.find((a) => a.id === cellId);
    if (art) {
      return {
        id: art.id,
        kind: art.kind,
        ratio: art.aspectRatio,
        uri: art.uri ?? '',
        prompt: art.prompt,
        modelName: model?.name ?? '',
        when: t('composer.justNow'),
        quality: model?.tiers?.find((x) => x.mode === effTier)?.label,
        durationSeconds: art.kind === 'video' ? effDuration : undefined,
      };
    }
    const asset = openProject?.assets.find((a) => a.id === cellId);
    if (asset) {
      return {
        id: asset.id,
        kind: asset.kind,
        ratio: asset.ratio,
        uri: asset.uri,
        prompt: asset.prompt,
        modelName: asset.kind === 'video' ? 'Kling 3.0' : 'Nano Banana Pro',
        when: t('composer.demoWhen'),
        quality: asset.kind === 'video' ? '1080p' : '2K',
        durationSeconds: asset.kind === 'video' ? 5 : undefined,
      };
    }
    return null;
  };

  const openCell = (cell: MasonryCell) => setViewerAsset(resolveAsset(cell.id));
  const openCellMenu = (cell: MasonryCell) => setDetailsAsset(resolveAsset(cell.id));

  const attachAsReference = (a: AssetInfo) => {
    setViewerAsset(null);
    setAttachments((prev) =>
      [...prev, { id: `att-${a.id}-${Date.now()}`, previewUri: a.uri }].slice(0, maxImages),
    );
  };
  const reuseAsset = (a: AssetInfo) => {
    setViewerAsset(null);
    if (a.kind !== mode) switchMode(a.kind);
    setPrompt(a.prompt);
  };
  /**
   * Save to Photos. FRONT-END PHASE: demo media are bundled require()
   * assets, so we resolve a local file via expo-asset and hand it to
   * MediaLibrary. Wiring swaps this for lib/download's downloadOutput
   * (real URLs, filename/extension handling, Sentry) — the buttons and
   * toasts stay as they are.
   */
  const saveAsset = async (a: AssetInfo) => {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        toast.error(t('composer.saveDeniedTitle'), t('composer.saveDeniedBody'));
        return;
      }
      let localUri: string;
      if (typeof a.uri === 'number') {
        const resolved = Asset.fromModule(a.uri);
        await resolved.downloadAsync();
        if (!resolved.localUri) throw new Error('asset has no local file');
        localUri = resolved.localUri;
      } else {
        localUri = a.uri;
      }
      await MediaLibrary.saveToLibraryAsync(localUri);
      toast.success(t('composer.savedTitle'), t('composer.savedBody'));
    } catch (err) {
      toast.error(
        t('composer.saveFailedTitle'),
        err instanceof Error ? err.message : undefined,
      );
    }
  };

  const turnIntoVideo = (a: AssetInfo) => {
    setViewerAsset(null);
    if (mode !== 'video') switchMode('video');
    // The image rides along as the clip's start frame.
    setAttachments([{ id: `att-${a.id}-${Date.now()}`, previewUri: a.uri }]);
  };

  // ── Pills ───────────────────────────────────────────────────────
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
            value: model.tiers.find((x) => x.mode === effTier)?.label ?? effTier,
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

  // ── Attachments (local-only in the front-end phase) ─────────────
  const pickLocal = async (source: 'camera' | 'photos') => {
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      quality: 0.9,
      allowsMultipleSelection: source === 'photos' && maxImages > 1,
      selectionLimit: Math.max(1, maxImages - attachments.length),
    };
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled) return;
    const picked = res.assets.map((a, i) => ({
      id: `${Date.now()}-${i}`,
      previewUri: a.uri,
    }));
    setAttachments((prev) => [...prev, ...picked].slice(0, maxImages));
  };

  const attachActions: AttachAction[] = [
    { id: 'camera', icon: 'camera', label: t('composer.attachCamera') },
    { id: 'photos', icon: 'imageStack', label: t('composer.attachPhotos') },
  ];

  // ── Demo generation ─────────────────────────────────────────────
  const canGenerate = prompt.trim().length > 0;
  const generate = () => {
    if (!canGenerate) return;
    const id = `demo-${Date.now()}`;
    const output = DEMO_OUTPUTS[demoCounter.current % DEMO_OUTPUTS.length];
    demoCounter.current += 1;
    setArtifacts((prev) => [
      ...prev,
      {
        id,
        status: 'generating',
        kind: mode,
        prompt: prompt.trim(),
        aspectRatio: !effRatio || effRatio === 'Auto' ? (mode === 'video' ? '16:9' : '1:1') : effRatio,
      },
    ]);
    setPrompt('');
    // Resolve after a beat so the shimmer → media transition is felt.
    setTimeout(() => {
      setArtifacts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: 'ready', uri: output } : a)),
      );
    }, 2600);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <ComposerHeader
        title={openProject?.name ?? t('composer.title')}
        credits={plan?.credits ?? 0}
        menuLabel={t('composer.menu')}
        closeLabel={t('composer.close')}
        onMenu={() => setDrawer(true)}
        onClose={() => router.back()}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {openProject ? (
          <ProjectMasonry
            cells={[
              // Session generations made inside this project lead the grid
              // (pending ones shimmer in their mode color), then the
              // project's existing media.
              ...artifacts
                .slice()
                .reverse()
                .map<MasonryCell>((a) => ({
                  id: a.id,
                  kind: a.kind,
                  ratio: a.aspectRatio,
                  uri: a.uri,
                  pending: a.status === 'generating',
                })),
              ...openProject.assets.map<MasonryCell>((asset) => ({
                id: asset.id,
                kind: asset.kind,
                ratio: asset.ratio,
                uri: asset.uri,
              })),
            ]}
            onOpenCell={openCell}
            onCellMenu={openCellMenu}
            onCellDownload={(cell) => {
              const a = resolveAsset(cell.id);
              if (a) void saveAsset(a);
            }}
            menuLabel={t('composer.assetMenu')}
            downloadLabel={t('composer.download')}
          />
        ) : (
          <ArtifactFeed
            artifacts={artifacts}
            emptyTitle={t('composer.emptyTitle')}
            emptyBody={t('composer.emptyBody')}
            failedLabel={t('composer.failed')}
            onOpen={(a) => setViewerAsset(resolveAsset(a.id))}
          />
        )}

        <View style={{ gap: 10, paddingBottom: insets.bottom + 10, paddingTop: 4 }}>
          <OptionPillsRow pills={pills} />
          <PromptDock
            prompt={prompt}
            onPromptChange={setPrompt}
            placeholder={
              mode === 'image'
                ? t('composer.placeholderImage')
                : t('composer.placeholderVideo')
            }
            maxLength={promptCap}
            attachments={attachments}
            onRemoveAttachment={(id) =>
              setAttachments((prev) => prev.filter((a) => a.id !== id))
            }
            onOpenAttach={() => setSheet('attach')}
            canGenerate={canGenerate}
            generating={false}
            generateLabel={t('composer.generate', { count: cost })}
            tint={MODE_TINT[mode]}
            onGenerate={generate}
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
        options={(model?.tiers ?? []).map((x) => ({
          id: x.mode,
          label: x.label,
          trailing: t('composer.credits', { count: x.costCredits }),
        }))}
        selectedId={effTier ?? null}
        tint={MODE_TINT[mode]}
        onSelect={setTier}
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
        onAction={(id) => void pickLocal(id as 'camera' | 'photos')}
        onClose={() => setSheet(null)}
      />
      <RecentsDrawer
        visible={drawer}
        title={t('composer.drawerTitle')}
        newSessionLabel={t('composer.drawerNewSession')}
        projectsLabel={t('composer.drawerProjects')}
        recentsLabel={t('composer.drawerRecents')}
        emptyLabel={t('composer.drawerEmpty')}
        folders={DEMO_FOLDERS}
        recents={DEMO_RECENT_PROJECTS}
        activeProjectId={openProjectId}
        onNewSession={() => {
          setOpenProjectId(null);
          setArtifacts([]);
          setPrompt('');
          setAttachments([]);
        }}
        onOpenProject={(projectId) => {
          setOpenProjectId(projectId);
          // A freshly opened project starts with its own media only —
          // the previous session's cards belong to the previous context.
          setArtifacts([]);
          setAttachments([]);
        }}
        onClose={() => setDrawer(false)}
      />
      <AssetViewer
        asset={viewerAsset}
        closeLabel={t('composer.close')}
        detailsLabel={t('composer.assetMenu')}
        downloadLabel={t('composer.download')}
        onDetails={(a) => {
          setViewerAsset(null);
          setDetailsAsset(a);
        }}
        onDownload={(a) => void saveAsset(a)}
        onClose={() => setViewerAsset(null)}
      />
      <AssetDetailsDrawer
        asset={detailsAsset}
        labels={{
          title: t('composer.detailsTitle'),
          attach: t('composer.actionAttach'),
          reuse: t('composer.actionReuse'),
          turnVideo: t('composer.actionTurnVideo'),
          prompt: t('prompt.label'),
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
        onClose={() => setDetailsAsset(null)}
      />
    </View>
  );
}
