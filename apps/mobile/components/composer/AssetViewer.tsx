/**
 * AssetViewer — tap an artifact anywhere (masonry cell, feed card) and
 * it opens full-quality over a black stage: image contained at its
 * native ratio, close ✕ top-leading, ⋯ top-trailing for the details
 * drawer. Backdrop fades in place (no sliding chrome).
 */

import { Pressable } from '@clickfy/ui';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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
          // Real clip: autoplays WITH sound (a deliberate, user-initiated
          // open), loops, and carries the platform's standard transport —
          // play/pause, scrubbing, volume. Byte-range support on
          // /v1/outputs makes the URL directly seekable for AVPlayer.
          <ViewerVideo url={current.uri} />
        ) : (
          <ZoomableImage uri={current.uri} resetKey={current.id} />
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
      // Industry-standard transport: the OS supplies play/pause, the
      // scrubber and volume — no reinvented controls.
      nativeControls
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
    />
  );
}

/**
 * Pinch-to-zoom + pan + double-tap, the standard photo-viewer gesture
 * set. Scale clamps to [1, 4]; releasing below 1 springs back and
 * recenters; double-tap toggles 1 ⇄ 2.5. Pan only bites while zoomed
 * so the stage's own taps stay usable at rest.
 */
function ZoomableImage({ uri, resetKey }: { uri: string | number; resetKey: string }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // A new asset resets the camera.
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
  }, [resetKey, scale, savedScale, tx, ty, savedTx, savedTy]);

  const settle = () => {
    'worklet';
    if (scale.value < 1) {
      scale.value = withTiming(1, { duration: 180 });
      tx.value = withTiming(0, { duration: 180 });
      ty.value = withTiming(0, { duration: 180 });
      savedScale.value = 1;
      savedTx.value = 0;
      savedTy.value = 0;
    } else {
      savedScale.value = scale.value;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    }
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(4, savedScale.value * e.scale);
    })
    .onEnd(() => {
      settle();
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      settle();
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1, { duration: 200 });
        tx.value = withTiming(0, { duration: 200 });
        ty.value = withTiming(0, { duration: 200 });
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        scale.value = withTiming(2.5, { duration: 200 });
        savedScale.value = 2.5;
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
        <Image source={uri} contentFit="contain" style={StyleSheet.absoluteFill} transition={120} />
      </Animated.View>
    </GestureDetector>
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
