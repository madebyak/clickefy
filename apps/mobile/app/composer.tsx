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
import { useSession } from '@/lib/use-session';

// ─── Demo fixtures (front-end phase only) ───────────────────────────

interface DemoTier {
  mode: string;
  label: string;
  cost: number;
}

interface DemoModel {
  key: string;
  name: string;
  provider: string;
  kind: ComposerMode;
  cost: number;
  ratios: string[];
  tiers?: DemoTier[];
  durations?: number[];
  maxImages: number;
}

const DEMO_MODELS: DemoModel[] = [
  {
    key: 'gemini-3-pro-image',
    name: 'Nano Banana Pro',
    provider: 'gemini',
    kind: 'image',
    cost: 2,
    ratios: ['1:1', '4:5', '3:4', '16:9', '9:16'],
    tiers: [
      { mode: '1K', label: '1K', cost: 2 },
      { mode: '2K', label: '2K', cost: 3 },
      { mode: '4K', label: '4K', cost: 5 },
    ],
    maxImages: 6,
  },
  {
    key: 'gpt-image-2',
    name: 'GPT Image 2',
    provider: 'openai',
    kind: 'image',
    cost: 3,
    ratios: ['1:1', '3:2', '2:3'],
    tiers: [
      { mode: 'medium', label: 'Medium', cost: 1 },
      { mode: 'high', label: 'High', cost: 3 },
    ],
    maxImages: 4,
  },
  {
    key: 'seedream-5-0',
    name: 'Seedream 5',
    provider: 'seedance',
    kind: 'image',
    cost: 1,
    ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'],
    maxImages: 6,
  },
  {
    key: 'kling-v3',
    name: 'Kling 3.0',
    provider: 'kling',
    kind: 'video',
    cost: 20,
    ratios: ['16:9', '9:16', '1:1'],
    tiers: [
      { mode: 'std', label: '720p', cost: 20 },
      { mode: 'pro', label: '1080p', cost: 35 },
      { mode: '4k', label: '4K', cost: 80 },
    ],
    durations: [5, 10],
    maxImages: 1,
  },
  {
    key: 'seedance-2-5',
    name: 'Seedance 2.5',
    provider: 'seedance',
    kind: 'video',
    cost: 15,
    ratios: ['16:9', '9:16', '4:3', '1:1'],
    tiers: [
      { mode: '720p', label: '720p', cost: 15 },
      { mode: '1080p', label: '1080p', cost: 30 },
    ],
    durations: [4, 6, 8, 10, 12],
    maxImages: 4,
  },
];


type SheetName = 'mode' | 'model' | 'ratio' | 'quality' | 'duration' | 'attach' | null;

// ─── Screen ─────────────────────────────────────────────────────────

export default function ComposerScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation('create');
  const { plan } = useSession();

  const [mode, setMode] = useState<ComposerMode>('image');
  // Remember the chosen model per mode so flipping Image⇄Video and back
  // doesn't lose the pick.
  const [modelByMode, setModelByMode] = useState<Record<ComposerMode, string>>({
    image: DEMO_MODELS.find((m) => m.kind === 'image')!.key,
    video: DEMO_MODELS.find((m) => m.kind === 'video')!.key,
  });
  const model = useMemo(
    () => DEMO_MODELS.find((m) => m.key === modelByMode[mode]) ?? DEMO_MODELS[0]!,
    [mode, modelByMode],
  );

  const [ratio, setRatio] = useState<string | undefined>(undefined);
  const [tier, setTier] = useState<string | undefined>(undefined);
  const [duration, setDuration] = useState<number | undefined>(undefined);
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

  // Effective values fall back to each model's defaults.
  const effRatio = ratio && model.ratios.includes(ratio) ? ratio : model.ratios[0]!;
  const effTier = model.tiers?.some((x) => x.mode === tier)
    ? tier
    : model.tiers?.[0]?.mode;
  const effDuration =
    model.durations && duration && model.durations.includes(duration)
      ? duration
      : model.durations?.[0];

  const cost = model.tiers?.find((x) => x.mode === effTier)?.cost ?? model.cost;

  const selectModel = (key: string) => {
    setModelByMode((prev) => ({ ...prev, [mode]: key }));
    // New model, fresh option state — its own defaults apply.
    setRatio(undefined);
    setTier(undefined);
    setDuration(undefined);
    setAttachments([]);
  };

  const switchMode = (m: ComposerMode) => {
    setMode(m);
    setRatio(undefined);
    setTier(undefined);
    setDuration(undefined);
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
        modelName: model.name,
        when: t('composer.justNow'),
        quality: model.tiers?.find((x) => x.mode === effTier)?.label,
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
      [...prev, { id: `att-${a.id}-${Date.now()}`, previewUri: a.uri }].slice(0, model.maxImages),
    );
  };
  const reuseAsset = (a: AssetInfo) => {
    setViewerAsset(null);
    if (a.kind !== mode) switchMode(a.kind);
    setPrompt(a.prompt);
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
    {
      id: 'model',
      label: t('model.label'),
      value: model.name,
      onPress: () => setSheet('model'),
    },
    {
      id: 'ratio',
      label: t('aspect.label'),
      value: effRatio,
      onPress: () => setSheet('ratio'),
    },
    ...(model.tiers && model.tiers.length > 0
      ? [
          {
            id: 'quality',
            label: t('quality.label'),
            value: model.tiers.find((x) => x.mode === effTier)?.label,
            onPress: () => setSheet('quality'),
          } satisfies PillSpec,
        ]
      : []),
    ...(model.durations && model.durations.length > 0
      ? [
          {
            id: 'duration',
            label: t('duration.label'),
            value: t('duration.seconds', { count: effDuration }),
            onPress: () => setSheet('duration'),
          } satisfies PillSpec,
        ]
      : []),
  ];

  // ── Attachments (local-only in the front-end phase) ─────────────
  const pickLocal = async (source: 'camera' | 'photos') => {
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      quality: 0.9,
      allowsMultipleSelection: source === 'photos' && model.maxImages > 1,
      selectionLimit: Math.max(1, model.maxImages - attachments.length),
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
    setAttachments((prev) => [...prev, ...picked].slice(0, model.maxImages));
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
        aspectRatio: effRatio,
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
            menuLabel={t('composer.assetMenu')}
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
            maxLength={2500}
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
        options={DEMO_MODELS.filter((m) => m.kind === mode).map((m) => ({
          id: m.key,
          label: m.name,
          subtitle:
            m.kind === 'video' ? t('model.video') : t('model.image'),
          trailing: t('composer.fromCredits', { count: m.cost }),
          leading: (
            <ModelLogo provider={m.provider} kind={m.kind} size={24} fallbackColor={colors.ink} />
          ),
        }))}
        selectedId={model.key}
        tint={MODE_TINT[mode]}
        onSelect={selectModel}
        onClose={() => setSheet(null)}
      />
      <RatioSheet
        visible={sheet === 'ratio'}
        title={t('aspect.label')}
        ratios={model.ratios}
        value={effRatio}
        tint={MODE_TINT[mode]}
        onSelect={setRatio}
        onClose={() => setSheet(null)}
      />
      <OptionsSheet
        visible={sheet === 'quality'}
        title={t('quality.label')}
        options={(model.tiers ?? []).map((x) => ({
          id: x.mode,
          label: x.label,
          trailing: t('composer.credits', { count: x.cost }),
        }))}
        selectedId={effTier ?? null}
        tint={MODE_TINT[mode]}
        onSelect={setTier}
        onClose={() => setSheet(null)}
      />
      <DurationSheet
        visible={sheet === 'duration'}
        title={t('duration.label')}
        seconds={model.durations ?? []}
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
        onDetails={(a) => {
          setViewerAsset(null);
          setDetailsAsset(a);
        }}
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
