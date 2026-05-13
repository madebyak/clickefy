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
import { useMemo } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { Icon } from '@/components/ui/Icon';
import { downloadOutput, downloadOutputs } from '@/lib/download';
import { getGenerationOutputs } from '@/lib/generation-cache';
import { TEMPLATE_QUERY } from '@/lib/query-config';
import { getSDK } from '@/lib/sdk';

export default function ResultScreen() {
  const { jobId, templateId } = useLocalSearchParams<{
    jobId: string;
    templateId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const sdk = getSDK();

  const outputs = useMemo<JobOutput[]>(
    () => (jobId ? getGenerationOutputs(jobId) ?? [] : []),
    [jobId],
  );

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
      await Share.share({ url: hero.url, message: 'Made with Clickefy' });
    } catch {
      // user dismissed
    }
  };

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
              Ready
            </Text>
          </View>
          <Stack gap="xs" mt="sm">
            <Text variant="title" color="ink" style={{ fontSize: 30, lineHeight: 32 }}>
              Your generation
            </Text>
            <Text variant="caption" color="inkMuted">
              {outputs.length} output{outputs.length === 1 ? '' : 's'}
              {t ? ` · ${t.title} template` : ''}
            </Text>
          </Stack>
        </Box>

        {/* Hero */}
        {hero ? (
          <Box px="lg" pb="md">
            <HeroSlot
              output={hero}
              onShare={handleShare}
              onDownload={() => void downloadOutput(hero)}
            />
          </Box>
        ) : null}

        {/* Variations — only when there are extras */}
        {variants.length > 0 ? (
          <Box px="lg" pb="md">
            <Text variant="overline" color="ink" transform="uppercase" weight="700" style={{ marginBottom: 12 }}>
              Variations
            </Text>
            <Stack gap="md">
              {variants.map((out, i) => (
                <VariantCard
                  key={`${out.url}-${i}`}
                  output={out}
                  onDownload={() => void downloadOutput(out)}
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
                onPress={() => void downloadOutputs(outputs)}
              >
                Download all ({outputs.length})
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
              Regenerate{t ? ` · ${t.credits} credits` : ''}
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
              Tweak inputs
            </Button>
          </Stack>
        </Box>
      </ScrollView>
    </View>
  );
}

// ─── Hero (single, large, with floating action bar) ─────────────────

function HeroSlot({
  output,
  onShare,
  onDownload,
}: {
  output: JobOutput;
  onShare: () => void;
  onDownload: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        position: 'relative',
        // Aspect ratio comes from the kind: images go 4:5 (portrait
        // hero), videos go 16:9 by default until we surface the real
        // aspect on the wire. Aspect-ratio is intentionally tied to
        // the slot, not measured from the media itself, so the layout
        // is stable while the file downloads.
        aspectRatio: output.kind === 'video' ? 9 / 16 : 4 / 5,
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
        <GlassButton icon="share" label="Share result" onPress={onShare} />
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
            Download
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

  return (
    <View
      style={{
        position: 'relative',
        // Variants get the same aspect as the hero so the page reads
        // as one coherent grid rather than a scrapbook of shapes.
        aspectRatio: output.kind === 'video' ? 9 / 16 : 4 / 5,
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
        accessibilityLabel="Download this variation"
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
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
  icon: 'share';
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
