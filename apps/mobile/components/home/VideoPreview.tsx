/**
 * VideoPreview — looping, muted, autoplay clip used inside `TemplateCard`.
 *
 * Industry-standard "social feed" video behaviour:
 *   • Always **muted** (mandatory for autoplay across iOS/Android/Web).
 *   • **Loop** forever — these are 3–8s product clips, not full media.
 *   • **No native controls**, no play/pause buttons. The card itself
 *     opens the template detail on tap; the video is purely decorative.
 *   • Static **poster image** rendered underneath; we cross-fade it out
 *     on the first decoded frame via `onFirstFrameRender`. Eliminates
 *     the buffering/black-frame flash on slow networks.
 *   • **Pauses when the screen blurs** (`useIsFocused`) and when the
 *     app is backgrounded (`AppState`). Saves battery + memory while
 *     the user is in another tab or has minimised the app.
 *
 * What we deliberately *don't* do (yet):
 *   - Per-card viewport intersection detection. Each `useVideoPlayer`
 *     allocates a native `ExoPlayer`/`AVPlayer`; with 2–5 muted local
 *     clips that's trivial. When we scale to 20+ video templates, the
 *     right answer is to swap the horizontal `ScrollView` carousels in
 *     `(tabs)/index.tsx` for `FlashList` + `onViewableItemsChanged`,
 *     which mounts/unmounts cards (and therefore players) by viewport.
 *     See https://shopify.github.io/flash-list/ for the migration path.
 */

import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export interface VideoPreviewProps {
  source: VideoSource;
  /** Poster shown underneath until the first video frame paints. */
  posterUri?: string;
  /** Object-fit. Matches `contentFit` from `expo-image` for parity. */
  contentFit?: 'cover' | 'contain';
  style?: ViewStyle;
}

export function VideoPreview({
  source,
  posterUri,
  contentFit = 'cover',
  style,
}: VideoPreviewProps) {
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState<boolean>(
    AppState.currentState === 'active',
  );

  // ── Crossfade between the poster image and the live video.
  // We start at 1 (poster fully visible) and animate to 0 once the
  // first video frame renders. Keeps the layout zero-flash.
  const posterOpacity = useSharedValue(1);
  const firstFrameRendered = useRef(false);

  // ── Wire the player. The setup callback runs once on mount; we set
  // it to loop + mute and immediately call `.play()` so the moment the
  // video frame is ready we already have decoded buffers.
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // ── Pause/resume on screen focus + app background.
  // We don't recreate the player — just toggle its `play()`/`pause()`.
  useEffect(() => {
    if (isFocused && appActive) {
      player.play();
    } else {
      player.pause();
    }
  }, [appActive, isFocused, player]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      setAppActive(next === 'active');
    });
    return () => sub.remove();
  }, []);

  const posterStyle = useAnimatedStyle(() => ({
    opacity: posterOpacity.value,
  }));

  return (
    <Animated.View style={[{ overflow: 'hidden' }, style]}>
      <VideoView
        player={player}
        style={{ width: '100%', height: '100%' }}
        contentFit={contentFit}
        nativeControls={false}
        // iOS-only — disables the play/pause overlay that appears when
        // the user taps. We want the card itself to be the tap target.
        allowsFullscreen={false}
        allowsPictureInPicture={false}
        onFirstFrameRender={() => {
          if (firstFrameRendered.current) return;
          firstFrameRendered.current = true;
          posterOpacity.value = withTiming(0, { duration: 220 });
        }}
      />

      {posterUri ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            },
            posterStyle,
          ]}
        >
          <Image
            source={posterUri}
            style={{ width: '100%', height: '100%' }}
            contentFit={contentFit}
            transition={0}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
