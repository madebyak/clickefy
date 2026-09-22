/**
 * AssetViewer — tap an artifact anywhere (masonry cell, feed card) and
 * it opens full-quality over a black stage: image contained at its
 * native ratio, close ✕ top-leading, ⋯ top-trailing for the details
 * drawer. Backdrop fades in place (no sliding chrome).
 */

import { Pressable } from '@clickfy/ui';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import type { AssetInfo } from './asset-info';

export function AssetViewer({
  asset,
  closeLabel,
  detailsLabel,
  downloadLabel,
  onDetails,
  onDownload,
  onClose,
}: {
  asset: AssetInfo | null;
  closeLabel: string;
  detailsLabel: string;
  downloadLabel: string;
  onDetails: (asset: AssetInfo) => void;
  onDownload: (asset: AssetInfo) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const visible = asset !== null;

  const [mounted, setMounted] = useState(visible);
  const [current, setCurrent] = useState<AssetInfo | null>(asset);
  const opacity = useSharedValue(0);

  // Keep rendering the last asset through the fade-out.
  if (visible && asset !== current) setCurrent(asset);
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
    } else {
      opacity.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [visible, opacity]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!mounted || !current) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.stage, fade]}>
        {current.kind === 'video' && typeof current.uri === 'string' ? (
          // Real clip: plays immediately, WITH sound (the viewer is a
          // deliberate, user-initiated open), looping like the web's
          // asset detail. Byte-range support on /v1/outputs makes the
          // URL directly seekable for AVPlayer.
          <ViewerVideo url={current.uri} />
        ) : (
          <Image
            source={current.uri}
            contentFit="contain"
            style={StyleSheet.absoluteFill}
            transition={120}
          />
        )}

        <View style={[styles.topBar, { top: insets.top + 8 }]}>
          <StageButton icon="close" label={closeLabel} onPress={onClose} />
          <View style={{ flex: 1 }} />
          <StageButton icon="download" label={downloadLabel} onPress={() => onDownload(current)} />
          <StageButton icon="more" label={detailsLabel} onPress={() => onDetails(current)} />
        </View>
      </Animated.View>
    </Modal>
  );
}

function ViewerVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
    />
  );
}

function StageButton({
  icon,
  label,
  onPress,
}: {
  icon: 'close' | 'more' | 'download';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      haptic="light"
      pressedOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.stageButton}
    >
      <Icon name={icon} size={18} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
  },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stageButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
