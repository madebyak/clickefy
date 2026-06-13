/**
 * LocaleSwitchOverlay — full-screen branded cover shown for a beat while the
 * app reloads to apply a language / RTL change.
 *
 * Rendered once at the root (see `_layout`). It's opaque (theme background) so
 * it hides the brief white flash of the reload, making the restart feel
 * intentional rather than like a crash. The app tears down during reload, so
 * there's no need to hide it on the happy path.
 */

import { Text, useTheme } from '@clickfy/ui';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Logo } from '@/components/brand/Logo';
import { useLocaleSwitchOverlay } from '@/lib/locale-switch-overlay';

export function LocaleSwitchOverlay() {
  const { colors, accent } = useTheme();
  const { active, label } = useLocaleSwitchOverlay();

  if (!active) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      pointerEvents="auto"
      style={[StyleSheet.absoluteFill, styles.fill, { backgroundColor: colors.bg }]}
    >
      <View style={styles.content}>
        <Logo width={150} />
        <ActivityIndicator size="small" color={accent.solid} style={styles.spinner} />
        {label ? (
          <Text variant="body" color="inkMuted" align="center">
            {label}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    alignItems: 'center',
    justifyContent: 'center',
    // Sit above every screen, including modals.
    zIndex: 9999,
    elevation: 9999,
  },
  content: { alignItems: 'center', gap: 18 },
  spinner: { marginTop: 10 },
});
