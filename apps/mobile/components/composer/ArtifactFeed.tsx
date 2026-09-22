/**
 * ArtifactFeed — the composer's content area. A session's generations
 * accumulate top-to-bottom like a conversation: each submit appends a
 * card that starts as a shimmering placeholder (sized to the chosen
 * aspect ratio, so nothing jumps when the media lands) and resolves
 * into the image/video in place.
 *
 * Empty state: the brand mark + a serif greeting in the welcome
 * screen's voice.
 *
 * Front-end phase: cards carry local/demo URIs; wiring swaps the data
 * source, not this component.
 */

import { Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { LogoMark } from '@/components/brand/Logo';
import { MODE_TINT } from './mode-colors';
import { Icon } from '@/components/ui/Icon';

export interface Artifact {
  id: string;
  status: 'generating' | 'ready' | 'failed';
  kind: 'image' | 'video';
  prompt: string;
  /** "9:16" etc — sizes the card before media exists. */
  aspectRatio: string;
  /** Media source once ready (for video: the playable URL). */
  uri?: string | number;
  /** Still to show in the feed for a video (job outputs may lack one). */
  posterUri?: string;
  /** The project this generation files into (server-side). */
  projectId?: string;
  /** Provenance captured at submit, for the details drawer. */
  modelName?: string;
  qualityLabel?: string;
  durationSeconds?: number;
  /** Server's failure sentence, when status === 'failed'. */
  errorMessage?: string;
}

function aspectValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number);
  return w && h ? w / h : 1;
}

export function ArtifactFeed({
  artifacts,
  emptyTitle,
  emptyBody,
  failedLabel,
  onOpen,
}: {
  artifacts: Artifact[];
  emptyTitle: string;
  emptyBody: string;
  failedLabel: string;
  onOpen: (a: Artifact) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);

  // A new card (or a resolve) keeps the latest work in view — the
  // feed reads bottom-up like a chat.
  useEffect(() => {
    if (artifacts.length > 0) {
      const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      return () => clearTimeout(id);
    }
  }, [artifacts]);

  if (artifacts.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <LogoMark size={44} />
        <Text
          variant="display"
          color="ink"
          align="center"
          style={{ fontSize: 24, lineHeight: 31, letterSpacing: 0, maxWidth: 300, marginTop: 16 }}
        >
          {emptyTitle}
        </Text>
        <Text variant="caption" color="inkMuted" align="center" style={{ maxWidth: 260, marginTop: 6 }}>
          {emptyBody}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 16 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {artifacts.map((a) => (
        <ArtifactCard key={a.id} artifact={a} failedLabel={failedLabel} onOpen={() => onOpen(a)} />
      ))}
    </ScrollView>
  );
}

function ArtifactCard({
  artifact,
  failedLabel,
  onOpen,
}: {
  artifact: Artifact;
  failedLabel: string;
  onOpen: () => void;
}) {
  const { colors } = useTheme();
  // Shimmer glows in the MODE color the artifact was made in — the same
  // green/image, purple/video wayfinding as the composer's controls.
  const tint = MODE_TINT[artifact.kind];
  const ar = aspectValue(artifact.aspectRatio);
  // Portrait media caps at 78% width so a 9:16 card doesn't monopolise
  // the screen; landscape/square runs full width.
  const widthPct = ar < 1 ? '78%' : '100%';

  return (
    <Stack gap="xs" style={{ width: widthPct as `${number}%`, alignSelf: 'flex-start' }}>
      <Pressable
        onPress={artifact.status === 'ready' ? onOpen : undefined}
        pressedOpacity={0.94}
        haptic="light"
        style={{
          borderRadius: 20,
          overflow: 'hidden',
          backgroundColor: colors.surfaceMuted,
          aspectRatio: ar,
        }}
      >
        {artifact.status === 'ready' && artifact.uri ? (
          <>
            {artifact.kind === 'video' ? (
              // A finished clip: show its poster still when we have one,
              // otherwise a quiet dark stage — never hand a video URL to
              // an <Image>. Tap opens the playing viewer either way.
              artifact.posterUri ? (
                <Image source={artifact.posterUri} contentFit="cover" style={StyleSheet.absoluteFill} transition={220} />
              ) : (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: '#101019' }]} />
              )
            ) : (
              <Image source={artifact.uri} contentFit="cover" style={StyleSheet.absoluteFill} transition={220} />
            )}
            {artifact.kind === 'video' ? (
              <View style={styles.playBadge}>
                <Icon name="play" size={16} color="#FFFFFF" weight="fill" />
              </View>
            ) : null}
          </>
        ) : artifact.status === 'failed' ? (
          <View style={styles.centerFill}>
            <Icon name="warning" size={20} color={colors.inkMuted} />
            <Text variant="caption" color="inkMuted" align="center" style={{ marginTop: 6, paddingHorizontal: 12 }}>
              {artifact.errorMessage || failedLabel}
            </Text>
          </View>
        ) : (
          <Shimmer tint={tint.solid} />
        )}
      </Pressable>
      <Text variant="caption" color="inkMuted" numberOfLines={1} style={{ paddingHorizontal: 4 }}>
        {artifact.prompt}
      </Text>
    </Stack>
  );
}

/** Soft pulsing placeholder while a card is generating. */
function Shimmer({ tint }: { tint: string }) {
  const { colors } = useTheme();
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.75, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View style={[styles.centerFill, { backgroundColor: colors.surfaceMuted }]}>
      <Animated.View style={style}>
        <Icon name="sparkle" size={26} color={tint} weight="fill" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  centerFill: {
    // RN 0.86 removed absoluteFillObject; absoluteFill is the spreadable object now.
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
