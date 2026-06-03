/**
 * VideoPreview — looping, muted, autoplay clip used inside `TemplateCard`,
 * the home banner, and the template-detail hero.
 *
 * Industry-standard "social feed" video behaviour:
 *   • Always **muted** (mandatory for autoplay across iOS/Android/Web).
 *   • **Loop** forever — these are 3–8s product clips, not full media.
 *   • **No native controls**, no play/pause buttons. The card itself
 *     opens the template detail on tap; the video is purely decorative.
 *   • Static **poster image** rendered underneath; we cross-fade the live
 *     video in on its first decoded frame. Eliminates the buffering /
 *     black-frame flash on slow networks.
 *
 * Memory model (this is the important part):
 *   The native player (`ExoPlayer` / `AVPlayer`) is **only mounted while
 *   the card actually needs to play**. We never keep a paused decoder
 *   around. A player exists only when ALL of the following hold:
 *     1. the card holds a global play slot (`useVideoSlot`) — caps the
 *        number of simultaneous decoders app-wide so a long feed can't
 *        exhaust the MediaCodec budget (the OOM / overheating crashes);
 *     2. the screen is focused (`useIsFocused`);
 *     3. the app is foregrounded (`AppState`).
 *   When any of those flip false we **unmount** the player entirely
 *   (`ActivePlayer` returns null), freeing the decoder + buffers, and the
 *   poster image takes over. This is what keeps the home feed from
 *   spinning up dozens of decoders at once.
 *
 *   Callers that are guaranteed to be one-of-a-kind on screen (banner,
 *   detail hero) omit `cardId`, which opts them out of the global cap.
 */

import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import {
  AppState,
  StyleSheet,
  type AppStateStatus,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useVideoSlot } from '@/lib/video-slots';

export interface VideoPreviewProps {
  source: VideoSource;
  /** Poster shown underneath until the first video frame paints. */
  posterUri?: string;
  /** Object-fit. Matches `contentFit` from `expo-image` for parity. */
  contentFit?: 'cover' | 'contain';
  style?: ViewStyle;
  /**
   * Stable id used by the global play-slot limiter. Pass the template id
   * for feed cards so we never decode more than `MAX_ACTIVE` videos at
   * once. Omit for one-off players (banner / detail hero) that should
   * always play when visible.
   */
  cardId?: string;
}

export function VideoPreview({
  source,
  posterUri,
  contentFit = 'cover',
  style,
  cardId,
}: VideoPreviewProps) {
  const hasSlot = useVideoSlot(cardId);
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState<boolean>(
    AppState.currentState === 'active',
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      setAppActive(next === 'active');
    });
    return () => sub.remove();
  }, []);

  // Only spin up a native decoder when we hold a slot AND are on screen.
  const shouldPlay = hasSlot && isFocused && appActive;

  // Poster crossfade. Starts fully visible; the live player fades the
  // poster out once its first frame paints. Whenever we tear the player
  // down (slot lost / blurred / backgrounded) we snap the poster back so
  // there's never an empty frame.
  const posterOpacity = useSharedValue(1);
  useEffect(() => {
    if (!shouldPlay) posterOpacity.value = 1;
  }, [shouldPlay, posterOpacity]);

  const posterStyle = useAnimatedStyle(() => ({
    opacity: posterOpacity.value,
  }));

  return (
    // `pointerEvents="none"` is critical: the live `VideoView` is a native
    // surface that otherwise SWALLOWS touches on Android, making any card
    // with a video preview un-tappable. The video is purely decorative in
    // every usage (card / banner / hero) — the tap target is always the
    // parent Pressable — so the whole subtree opts out of the touch system.
    <Animated.View pointerEvents="none" style={[{ overflow: 'hidden' }, style]}>
      {/* Poster base layer — always present underneath the player. */}
      {posterUri ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, posterStyle]}
        >
          <Image
            source={posterUri}
            style={StyleSheet.absoluteFill}
            contentFit={contentFit}
            transition={0}
          />
        </Animated.View>
      ) : null}

      {/* Live decoder — mounted only while actually playing. */}
      {shouldPlay ? (
        <ActivePlayer
          source={source}
          contentFit={contentFit}
          onFirstFrame={() => {
            posterOpacity.value = withTiming(0, { duration: 220 });
          }}
        />
      ) : null}
    </Animated.View>
  );
}

interface ActivePlayerProps {
  source: VideoSource;
  contentFit: 'cover' | 'contain';
  onFirstFrame: () => void;
}

/**
 * Wraps the actual `useVideoPlayer` allocation. Mounting/unmounting this
 * component is what creates/destroys the native decoder, so it MUST only
 * ever be rendered while `shouldPlay` is true in the parent.
 */
function ActivePlayer({ source, contentFit, onFirstFrame }: ActivePlayerProps) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit={contentFit}
      nativeControls={false}
      // iOS-only — disables the play/pause overlay that appears when the
      // user taps. We want the card itself to be the tap target.
      // `allowsFullscreen` was deprecated in SDK 54 and removed in SDK 55
      // (expo/expo#41606); the replacement is `fullscreenOptions.enable`.
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
      onFirstFrameRender={onFirstFrame}
    />
  );
}
