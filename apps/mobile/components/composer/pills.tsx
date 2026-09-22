/**
 * The composer's option pills — one horizontal, never-wrapping row
 * above the prompt dock. Each pill states a setting ("Ratio · 9:16")
 * and opens its bottom sheet; the MODE pill leads the row in the brand
 * accent. Scrolls horizontally when a model exposes more settings than
 * fit the width.
 */

import { HStack, Pressable, Text, useTheme } from '@clickfy/ui';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';

export interface PillSpec {
  id: string;
  /** Setting name, shown when no value is chosen yet. */
  label: string;
  /** Chosen value — replaces the label so the row reads as a summary. */
  value?: string;
  icon?: IconName;
  /**
   * Solid fill + its readable foreground (the MODE pill: green for
   * image, purple for video — hardcoded wayfinding, not the theme).
   */
  fill?: { bg: string; fg: string };
  onPress: () => void;
}

export function OptionPill({ pill }: { pill: PillSpec }) {
  const { colors } = useTheme();
  const fg = pill.fill ? pill.fill.fg : colors.ink;

  return (
    <Pressable
      onPress={pill.onPress}
      haptic="light"
      pressedOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={pill.value ? `${pill.label}: ${pill.value}` : pill.label}
    >
      <HStack
        align="center"
        gap="xs"
        style={{
          height: 36,
          paddingHorizontal: 14,
          borderRadius: 18,
          // Flat tonal pills — a tone up from the page, no borders.
          backgroundColor: pill.fill ? pill.fill.bg : colors.surface,
        }}
      >
        {pill.icon ? <Icon name={pill.icon} size={14} color={fg} weight="fill" /> : null}
        <Text weight="600" style={{ fontSize: 13.5, color: fg }} numberOfLines={1}>
          {pill.value ?? pill.label}
        </Text>
        <Icon name="chevronDown" size={12} color={pill.fill ? fg : colors.inkMuted} />
      </HStack>
    </Pressable>
  );
}

export function OptionPillsRow({ pills, trailing }: { pills: PillSpec[]; trailing?: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // A fixed-height strip: without flexGrow: 0 a horizontal ScrollView
      // inside a column would greedily claim vertical space.
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}
      keyboardShouldPersistTaps="handled"
    >
      {pills.map((p) => (
        <OptionPill key={p.id} pill={p} />
      ))}
      {trailing ? <View>{trailing}</View> : null}
    </ScrollView>
  );
}
