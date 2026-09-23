/**
 * AssetDetailsDrawer — the ⋯ panel: slides in from the TRAILING edge
 * (opposite the nav drawer; mirrored in RTL) with the artifact's
 * provenance and its actions, mirroring the web's asset info panel:
 *
 *   Details                                  ✕
 *   [ thumb ]
 *   [ Attach as reference ]
 *   [ Re-use ]
 *   [ Turn into video ]        ← images only
 *   PROMPT     …full text…
 *   Model · Type · Ratio · Quality · Duration · Created
 *
 * Same split animation as the other panels: backdrop fades in place,
 * only the panel slides.
 */

import { HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { I18nManager, Modal, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui/Icon';
import { outputThumbnailUrl } from '@/lib/image-url';
import { MODE_TINT } from './mode-colors';
import type { AssetInfo } from './asset-info';

export interface AssetDetailsLabels {
  title: string;
  attach: string;
  reuse: string;
  turnVideo: string;
  prompt: string;
  copyPrompt: string;
  copied: string;
  model: string;
  type: string;
  typeImage: string;
  typeVideo: string;
  ratio: string;
  quality: string;
  duration: string;
  durationSeconds: (s: number) => string;
  created: string;
}

export function AssetDetailsDrawer({
  asset,
  labels,
  onAttach,
  onReuse,
  onTurnVideo,
  onClose,
}: {
  asset: AssetInfo | null;
  labels: AssetDetailsLabels;
  onAttach: (a: AssetInfo) => void;
  onReuse: (a: AssetInfo) => void;
  onTurnVideo: (a: AssetInfo) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(width * 0.86, 380);
  const visible = asset !== null;

  const [mounted, setMounted] = useState(visible);
  const [current, setCurrent] = useState<AssetInfo | null>(asset);
  const backdrop = useSharedValue(0);
  const slide = useSharedValue(panelWidth);
  // Trailing edge: +width in LTR (from the right), mirrored in RTL.
  const off = I18nManager.isRTL ? -panelWidth : panelWidth;

  if (visible && asset !== current) setCurrent(asset);
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      backdrop.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.quad) });
      slide.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
    } else {
      backdrop.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) });
      slide.value = withTiming(off, { duration: 190, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [visible, backdrop, slide, off]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value }] }));

  if (!mounted || !current) return null;

  const act = (fn: (a: AssetInfo) => void) => () => {
    onClose();
    fn(current);
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Animated.View
          style={[
            { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
            backdropStyle,
          ]}
        >
          <Pressable onPress={onClose} style={{ flex: 1 }} accessibilityLabel={labels.title} />
        </Animated.View>

        <Animated.View
          style={[
            {
              width: panelWidth,
              backgroundColor: colors.bg,
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 12,
              borderTopLeftRadius: 24,
              borderBottomLeftRadius: 24,
            },
            panelStyle,
          ]}
        >
          <HStack align="center" style={{ paddingHorizontal: 20, marginBottom: 12 }}>
            <Text variant="subhead" color="ink" weight="700" style={{ flex: 1 }}>
              {labels.title}
            </Text>
            <Pressable onPress={onClose} haptic="light" accessibilityLabel={labels.title} style={{ padding: 6 }}>
              <Icon name="close" size={18} color={colors.inkMuted} />
            </Pressable>
          </HStack>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 18 }}
          >
            {/* ── Preview ── */}
            <View
              style={{
                height: 160,
                borderRadius: 18,
                overflow: 'hidden',
                backgroundColor: colors.surface,
              }}
            >
              <Image
                // A video's still is its poster; an image is its own thumb.
                source={
                  current.kind === 'video'
                    ? current.posterUri
                    : typeof current.uri === 'string'
                      ? outputThumbnailUrl(current.uri, { width: panelWidth - 32 })
                      : current.uri
                }
                placeholder={current.thumbhash ? { thumbhash: current.thumbhash } : undefined}
                placeholderContentFit="cover"
                cachePolicy="memory-disk"
                contentFit="cover"
                style={{ width: '100%', height: '100%' }}
              />
              {current.kind === 'video' ? (
                <View
                  style={{
                    position: 'absolute',
                    bottom: 8,
                    left: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    paddingHorizontal: 8,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: 'rgba(0,0,0,0.55)',
                  }}
                >
                  <Icon name="play" size={11} color="#FFFFFF" weight="fill" />
                  <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: MODE_TINT.video.solid }} />
                </View>
              ) : null}
            </View>

            {/* ── Actions ── */}
            <Stack gap="sm">
              <ActionRow icon="imageStack" label={labels.attach} onPress={act(onAttach)} />
              <ActionRow icon="refresh" label={labels.reuse} onPress={act(onReuse)} />
              {current.kind === 'image' ? (
                <ActionRow
                  icon="video"
                  label={labels.turnVideo}
                  tint={MODE_TINT.video}
                  onPress={act(onTurnVideo)}
                />
              ) : null}
            </Stack>

            {/* ── Prompt (template prompts are withheld server-side → hidden) ── */}
            {current.prompt.length > 0 ? (
              <Stack gap="xs">
                <FieldLabel text={labels.prompt} />
                <PromptBox
                  prompt={current.prompt}
                  copyLabel={labels.copyPrompt}
                  copiedLabel={labels.copied}
                />
              </Stack>
            ) : null}

            {/* ── Provenance ── */}
            <Stack gap="xs">
              <FieldRow label={labels.model} value={current.modelName} />
              <FieldRow
                label={labels.type}
                value={current.kind === 'video' ? labels.typeVideo : labels.typeImage}
                dotColor={MODE_TINT[current.kind].solid}
              />
              <FieldRow label={labels.ratio} value={current.ratio} />
              {current.quality ? <FieldRow label={labels.quality} value={current.quality} /> : null}
              {current.kind === 'video' && current.durationSeconds ? (
                <FieldRow label={labels.duration} value={labels.durationSeconds(current.durationSeconds)} />
              ) : null}
              <FieldRow label={labels.created} value={current.when} />
            </Stack>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** How long the "Copied" confirmation replaces the copy affordance. */
const COPIED_FEEDBACK_MS = 1600;
/** The prompt box never grows past this; longer prompts scroll inside it. */
const PROMPT_MAX_HEIGHT = 168;

/**
 * The prompt, capped in height and scrollable within, with tap-to-copy.
 * Feedback is inline ("Copied ✓" in the header row) rather than a toast:
 * this drawer is a native Modal, and the app's toast layer renders
 * underneath it.
 */
function PromptBox({
  prompt,
  copyLabel,
  copiedLabel,
}: {
  prompt: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const { colors, accent } = useTheme();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(prompt);
    } catch {
      return; // Clipboard unavailable (simulator quirk) — no false "Copied".
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };

  return (
    <Pressable onPress={() => void copy()} pressedOpacity={0.9} accessibilityRole="button" accessibilityLabel={copyLabel}>
      <View style={{ borderRadius: 16, backgroundColor: colors.surface, overflow: 'hidden' }}>
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={{ maxHeight: PROMPT_MAX_HEIGHT }}
          contentContainerStyle={{ padding: 14, paddingBottom: 8 }}
        >
          <Text variant="body" color="ink" style={{ lineHeight: 22 }}>
            {prompt}
          </Text>
        </ScrollView>
        <HStack align="center" gap="xs" style={{ paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2 }}>
          <Icon
            name={copied ? 'check' : 'copy'}
            size={13}
            color={copied ? accent.deep : colors.inkMuted}
            weight="bold"
          />
          <Text variant="caption" color={copied ? accent.deep : 'inkMuted'}>
            {copied ? copiedLabel : copyLabel}
          </Text>
        </HStack>
      </View>
    </Pressable>
  );
}

function ActionRow({
  icon,
  label,
  tint,
  onPress,
}: {
  icon: IconName;
  label: string;
  tint?: { solid: string; fg: string };
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} haptic="light" pressedOpacity={0.9} accessibilityRole="button">
      <HStack
        align="center"
        gap="md"
        style={{
          paddingVertical: 13,
          paddingHorizontal: 14,
          borderRadius: 16,
          backgroundColor: tint ? tint.solid : colors.surface,
        }}
      >
        <Icon name={icon} size={17} color={tint ? tint.fg : colors.ink} weight={tint ? 'fill' : 'regular'} />
        <Text variant="bodySemi" style={tint ? { color: tint.fg } : undefined} color={tint ? undefined : 'ink'}>
          {label}
        </Text>
      </HStack>
    </Pressable>
  );
}

function FieldRow({ label, value, dotColor }: { label: string; value: string; dotColor?: string }) {
  const { colors } = useTheme();
  return (
    <HStack
      align="center"
      gap="md"
      style={{ paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.surface }}
    >
      <Text variant="caption" color="inkMuted" style={{ width: 84 }}>
        {label}
      </Text>
      {dotColor ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor }} /> : null}
      <Text variant="bodySemi" color="ink" style={{ flex: 1 }} numberOfLines={1}>
        {value}
      </Text>
    </HStack>
  );
}

function FieldLabel({ text }: { text: string }): ReactNode {
  return (
    <Text variant="overline" color="inkMuted" transform="uppercase" style={{ paddingHorizontal: 4 }}>
      {text}
    </Text>
  );
}
