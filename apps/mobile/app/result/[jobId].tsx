/**
 * Result — final screen after a successful generation.
 *
 * Layout rules:
 *   • Single output (image or video) → hero treatment respecting its
 *     aspect ratio with a glass action bar overlaid.
 *   • Multiple outputs → hero shows the first, the rest stack as
 *     proportionally-sized variation cards beneath it. Mixed
 *     image/video sets are supported — each card picks the right
 *     renderer based on `output.kind`.
 *   • A "Download all" CTA appears only when there's more than one
 *     output; with a single item the in-hero Download button is
 *     enough.
 *
 * Downloads stream full-resolution bytes from the Worker straight
 * to the camera roll via `lib/download.ts` — no client-side resize.
 */

import {
  Box,
  Button,
  Pressable,
  Stack,
  Text,
  useTheme,
} from '@clickfy/ui';
import type { JobOutput } from '@clickfy/sdk';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { useToast } from '@/components/shared/Toast';
import { Icon } from '@/components/ui/Icon';
import { downloadOutput, downloadOutputs } from '@/lib/download';
import { getGenerationOutputs, setGenerationOutputs } from '@/lib/generation-cache';
import { TEMPLATE_QUERY } from '@/lib/query-config';
import { getSDK } from '@/lib/sdk';

export default function ResultScreen() {
  const { jobId, templateId: templateIdParam } = useLocalSearchParams<{
    jobId: string;
    templateId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const { t: tr } = useTranslation('generate');
  const sdk = getSDK();
  const toast = useToast();

  // Fast path: the `generating` screen drops the finished outputs into
  // this module-scoped cache the instant the job completes in-session,
  // so the normal in-app flow renders with zero network latency.
  const cachedOutputs = useMemo<JobOutput[]>(
    () => (jobId ? getGenerationOutputs(jobId) ?? [] : []),
    [jobId],
  );

  // Cold path: the screen was opened with nothing in that cache —
  // overwhelmingly this means a push-notification deep link after iOS
  // killed the app. Fetch the finished job straight from the server so
  // we never strand the user on an empty result.
  const needsFetch = !!jobId && cachedOutputs.length === 0;
  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => sdk.generation.getJob(jobId!),
    enabled: needsFetch,
    staleTime: 30_000,
    retry: 1,
  });

  // If the job isn't finished yet (user tapped through early, or an
  // out-of-order notification), send them to the live progress screen
  // instead of rendering a blank result. On success, backfill the
  // cache so a back→forward re-entry is instant.
  useEffect(() => {
    if (!needsFetch) return;
    const data = jobQuery.data;
    if (!data) return;
    if (data.status === 'queued' || data.status === 'processing') {
      router.replace({
        pathname: '/generating',
        params: { jobId: jobId!, templateId: data.templateId ?? templateIdParam ?? '' },
      });
    } else if (data.status === 'completed' && data.outputs && data.outputs.length > 0) {
      setGenerationOutputs(jobId!, data.outputs);
    }
  }, [needsFetch, jobQuery.data, jobId, templateIdParam, router]);

  // Outputs to render: in-memory cache wins; otherwise the fetched job.
  const outputs: JobOutput[] =
    cachedOutputs.length > 0 ? cachedOutputs : jobQuery.data?.outputs ?? [];

  // Template id arrives via the route param on the in-app flow, or is
  // recovered from the fetched job on the cold notification path — so
  // "Regenerate" / "Tweak inputs" work either way.
  const templateId = templateIdParam ?? jobQuery.data?.templateId;

  const templateQuery = useQuery({
    queryKey: ['template', templateId],
    queryFn: () => sdk.catalog.getTemplate(templateId!),
    enabled: !!templateId,
    ...TEMPLATE_QUERY,
  });
  const t = templateQuery.data;

  const hero = outputs[0];
  const variants = outputs.slice(1);
  const isMulti = outputs.length > 1;

  const handleShare = async () => {
    if (!hero) return;
    try {
      await Share.share({ url: hero.url, message: tr('shareMessage') });
    } catch {
      // user dismissed
    }
  };

  // ── Cold-start states (only ever hit when there was nothing cached) ──
  if (needsFetch) {
    const status = jobQuery.data?.status;

    // Loading, or about to redirect a still-running job to /generating.
    if (jobQuery.isLoading || status === 'queued' || status === 'processing') {
      return (
        <CenteredState insets={insets} colors={colors}>
          <ActivityIndicator size="large" color={accent.solid} />
          <Text variant="body" color="inkMuted" align="center">
            {tr('loading')}
          </Text>
        </CenteredState>
      );
    }

    // The generation itself failed. Offer a retry into the template.
    if (status === 'failed') {
      return (
        <CenteredState insets={insets} colors={colors}>
          <Text variant="title" color="ink" align="center" style={{ fontSize: 22 }}>
            {tr('failedTitle')}
          </Text>
          <Text variant="body" color="inkMuted" align="center">
            {jobQuery.data?.error || tr('errorFallback')}
          </Text>
          {templateId ? (
            <Button variant="primary" full onPress={() => router.replace(`/use/${templateId}`)}>
              {tr('tryAgain')}
            </Button>
          ) : (
            <Button variant="primary" full onPress={() => router.replace('/(tabs)')}>
              {tr('backToHome')}
            </Button>
          )}
        </CenteredState>
      );
    }

    // Couldn't load it (404 / network / completed-but-no-outputs). Don't
    // strand the user — give them a way back.
    if (jobQuery.isError || (status === 'completed' && outputs.length === 0)) {
      return (
        <CenteredState insets={insets} colors={colors}>
          <Text variant="title" color="ink" align="center" style={{ fontSize: 22 }}>
            {tr('unavailableTitle')}
          </Text>
          <Text variant="body" color="inkMuted" align="center">
            {tr('unavailableMessage')}
          </Text>
          <Button variant="primary" full onPress={() => router.replace('/(tabs)')}>
            {tr('backToHome')}
          </Button>
        </CenteredState>
      );
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* Header — no right icon. The default chevron back is enough; the
          previous "refresh → back to home" affordance was unintuitive
          and duplicated the regenerate button below. */}
      <ScreenHeader />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
      >
        {/* Title block */}
        <Box px="lg" pb="md">
          <View
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 12,
              backgroundColor: accent.soft,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="check" size={11} color={accent.deep} weight="bold" />
            <Text color={accent.deep} weight="700" transform="uppercase" style={{ fontSize: 11.5, letterSpacing: 0.4 }}>
              {tr('ready')}
            </Text>
          </View>
          <Stack gap="xs" mt="sm">
            <Text variant="title" color="ink" style={{ fontSize: 30, lineHeight: 32 }}>
              {tr('resultTitle')}
            </Text>
            <Text variant="caption" color="inkMuted">
              {tr('outputCount', { count: outputs.length })}
              {t ? tr('templateSuffix', { title: t.title }) : ''}
            </Text>
          </Stack>
        </Box>

        {/* Hero */}
        {hero ? (
          <Box px="lg" pb="md">
            <HeroSlot
              output={hero}
              onShare={handleShare}
              onDownload={() => void downloadOutput(hero, toast)}
              onReport={() =>
                router.push({
                  pathname: '/report',
                  // Targeting the job itself, not a specific output index.
                  // The admin queue reviews the whole job's outputs at
                  // once, which matches how a reporter actually thinks
                  // about an objectionable generation ("this whole result
                  // is bad", not "image #3 specifically").
                  params: { targetType: 'job_output', targetId: jobId! },
                })
              }
            />
          </Box>
        ) : null}

        {/* Variations — only when there are extras */}
        {variants.length > 0 ? (
          <Box px="lg" pb="md">
            <Text variant="overline" color="ink" transform="uppercase" weight="700" style={{ marginBottom: 12 }}>
              {tr('variations')}
            </Text>
            <Stack gap="md">
              {variants.map((out, i) => (
                <VariantCard
                  key={`${out.url}-${i}`}
                  output={out}
                  onDownload={() => void downloadOutput(out, toast)}
                />
              ))}
            </Stack>
          </Box>
        ) : null}

        {/* Action row */}
        <Box px="lg" pt="sm">
          <Stack gap="sm">
            {isMulti ? (
              <Button
                variant="accent"
                size="lg"
                full
                haptic="medium"
                leading={<Icon name="download" size={18} color={accent.ink} weight="bold" />}
                onPress={() => void downloadOutputs(outputs, toast)}
              >
                {tr('downloadAll', { count: outputs.length })}
              </Button>
            ) : null}

            <Button
              variant={isMulti ? 'ghost' : 'accent'}
              size="lg"
              full
              haptic="medium"
              leading={<Icon name="refresh" size={18} color={isMulti ? colors.ink : accent.ink} weight="bold" />}
              onPress={() => {
                if (templateId) router.replace(`/use/${templateId}`);
              }}
            >
              {t ? tr('regenerateWithCredits', { count: t.credits }) : tr('regenerate')}
            </Button>

            <Button
              variant="ghost"
              size="md"
              full
              leading={<Icon name="sliders" size={16} color={colors.ink} />}
              onPress={() => {
                if (templateId) router.replace(`/use/${templateId}`);
              }}
            >
              {tr('tweakInputs')}
            </Button>
          </Stack>
        </Box>
      </ScrollView>
    </View>
  );
}

// ─── Centered status state (loading / failed / unavailable) ─────────
//
// Shared chrome for the cold-start branches above: header + a vertically
// centered column with comfortable spacing. Kept here so the three
// states stay visually consistent and the main component reads cleanly.
function CenteredState({
  insets,
  colors,
  children,
}: {
  insets: { top: number; bottom: number };
  colors: { bg: string };
  children: ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <ScreenHeader />
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 28,
          paddingBottom: insets.bottom + 40,
          gap: 16,
        }}
      >
        {children}
      </View>
    </View>
  );
}

// ─── Hero (single, large, with floating action bar) ─────────────────

function HeroSlot({
  output,
  onShare,
  onDownload,
  onReport,
}: {
  output: JobOutput;
  onShare: () => void;
  onDownload: () => void;
  onReport: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('generate');

  return (
    <View
      style={{
        position: 'relative',
        // Aspect ratio is sourced from the wire (`output.aspectRatio`),
        // which the API derives from the stored `MediaRef` width/height —
        // so the hero matches exactly what the pipeline produced (1:1,
        // 4:5, 16:9, 9:16, etc.) instead of guessing per `kind`. We only
        // fall back to defaults for legacy jobs that predate dimension
        // tracking, or for videos (Stream doesn't yet report dims back).
        aspectRatio: resolveAspectRatio(output),
        borderRadius: 24,
        overflow: 'hidden',
        backgroundColor: colors.surfaceMuted,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 40,
        shadowOffset: { width: 0, height: 14 },
      }}
    >
      <OutputRenderer output={output} contentFit="cover" />

      {/* Floating actions — Save and "spare" icon removed.
          We keep Share (genuine, often-used) and Download (primary
          action). The previous Save bookmark duplicated the heart
          on the template page and confused users; the refresh icon
          duplicated the Regenerate CTA below. */}
      <View
        style={{
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <GlassButton icon="share" label={t('a11y.shareResult')} onPress={onShare} />
        {/* Flag — required by App Store guideline 1.2 for any UGC.
            Sits next to Share so it's discoverable without scrolling,
            but the colour stays neutral-glass so it doesn't compete
            with the primary Download CTA on the right. */}
        <GlassButton icon="flag" label={t('a11y.reportGeneration')} onPress={onReport} />
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={onDownload}
          haptic="medium"
          pressedOpacity={0.85}
          style={{
            height: 44,
            paddingHorizontal: 16,
            borderRadius: 22,
            backgroundColor: colors.chipBg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="download" size={16} color={colors.chipInk} />
          <Text color={colors.chipInk} weight="700" style={{ fontSize: 14 }}>
            {t('download')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Variation card (medium, per-output download tap) ───────────────

function VariantCard({
  output,
  onDownload,
}: {
  output: JobOutput;
  onDownload: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('generate');

  return (
    <View
      style={{
        position: 'relative',
        // Variations honour each output's true aspect — when a pipeline
        // emits e.g. a 16:9 hero alongside two 1:1 crops, the page now
        // mirrors that mix rather than forcing them all into the same
        // shape. Same `resolveAspectRatio` helper as the hero so the
        // fallback story stays identical.
        aspectRatio: resolveAspectRatio(output),
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: colors.surfaceMuted,
      }}
    >
      <OutputRenderer output={output} contentFit="cover" />
      {/* Per-output download — small floating chip, bottom-right.
          We deliberately don't compete with the hero's full bar
          here: variations are secondary, so just the icon. */}
      <Pressable
        onPress={onDownload}
        haptic="light"
        pressedOpacity={0.85}
        accessibilityLabel={t('a11y.downloadVariation')}
        style={{
          position: 'absolute',
          bottom: 12,
          end: 12,
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.glass,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="download" size={18} color={colors.glassInk} />
      </Pressable>
    </View>
  );
}

// ─── Aspect ratio helper ────────────────────────────────────────────

/**
 * The pipeline is the source of truth for each output's shape. Prefer
 * the wire-provided `aspectRatio`; fall back to a kind-based default
 * only when the field is missing (legacy jobs and videos until Stream
 * reports dimensions back).
 *
 * Defaults match historic UX: video stays in vertical 9:16 hero mode,
 * images get a slightly-tall 4:5 social-feed shape. Both are
 * intentionally not 1:1 so a missing field still produces a usable
 * hero, just less precise than the real ratio.
 */
function resolveAspectRatio(output: JobOutput): number {
  if (output.aspectRatio && Number.isFinite(output.aspectRatio) && output.aspectRatio > 0) {
    return output.aspectRatio;
  }
  if (output.width && output.height && output.height > 0) {
    return output.width / output.height;
  }
  return output.kind === 'video' ? 9 / 16 : 4 / 5;
}

// ─── Renderer (picks Image vs Video by output.kind) ────────────────

function OutputRenderer({
  output,
  contentFit,
}: {
  output: JobOutput;
  contentFit: 'cover' | 'contain';
}) {
  if (output.kind === 'video') {
    return <ResultVideo url={output.url} contentFit={contentFit} />;
  }
  return (
    <Image
      source={output.url}
      contentFit={contentFit}
      style={{ width: '100%', height: '100%' }}
      transition={220}
    />
  );
}

function ResultVideo({ url, contentFit }: { url: string; contentFit: 'cover' | 'contain' }) {
  // Auto-play, looped, muted — matches the home-tab card preview
  // behaviour. Audio is off because we can't be sure the user wants
  // it; they can tap into share / external open if they need sound.
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: '100%' }}
      contentFit={contentFit}
      nativeControls={false}
    />
  );
}

// ─── Glass icon button (Share, etc.) ────────────────────────────────

function GlassButton({
  icon,
  label,
  onPress,
}: {
  icon: 'share' | 'flag';
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.glass,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={18} color={colors.glassInk} />
    </Pressable>
  );
}
