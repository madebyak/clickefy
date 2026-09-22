/**
 * The composer's option sheets — one small component per setting, all
 * riding the shared <Sheet> chrome:
 *
 *   ModeSheet     — Image / Video as two large cards.
 *   OptionsSheet  — generic single-choice rows (model, quality), with
 *                   optional subtitle and trailing price text.
 *   RatioSheet    — aspect ratios as proportional glyphs in a grid.
 *   DurationSheet — seconds as a chip grid (wheel picker is a later
 *                   polish once the flow settles).
 *
 * Visual language: NO borders. Unselected options are flat tonal cards
 * (`surface` — the CARD tone — on the sheet's bg; surfaceMuted is nearly
 * identical to bg and disappears); the selected one is a solid fill of the active
 * MODE color (green = image, purple = video) with its contrast
 * foreground — so even inside a sheet you can tell which mode you're
 * configuring.
 */

import { HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { Sheet } from './Sheet';
import type { ModeTint } from './mode-colors';

// ─── Mode ───────────────────────────────────────────────────────────

export type ComposerMode = 'image' | 'video';

export function ModeSheet({
  visible,
  value,
  labels,
  title,
  tints,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: ComposerMode;
  labels: Record<ComposerMode, string>;
  title: string;
  tints: Record<ComposerMode, ModeTint>;
  onSelect: (m: ComposerMode) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const CARD: { mode: ComposerMode; icon: IconName }[] = [
    { mode: 'image', icon: 'image' },
    { mode: 'video', icon: 'video' },
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title={title} maxHeight="45%">
      <HStack gap="md" style={{ paddingBottom: 8 }}>
        {CARD.map(({ mode, icon }) => {
          const selected = mode === value;
          const tint = tints[mode];
          return (
            <Pressable
              key={mode}
              onPress={() => {
                onSelect(mode);
                onClose();
              }}
              haptic="selection"
              pressedOpacity={0.92}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{ flex: 1 }}
            >
              <Stack
                gap="sm"
                align="center"
                style={{
                  paddingVertical: 22,
                  borderRadius: 18,
                  backgroundColor: selected ? tint.solid : colors.surface,
                }}
              >
                {/* Each card hints its own identity color even unselected. */}
                <Icon
                  name={icon}
                  size={26}
                  color={selected ? tint.fg : tint.solid}
                  weight="fill"
                />
                <Text variant="bodySemi" style={{ color: selected ? tint.fg : colors.ink }}>
                  {labels[mode]}
                </Text>
              </Stack>
            </Pressable>
          );
        })}
      </HStack>
    </Sheet>
  );
}

// ─── Generic single-choice rows ─────────────────────────────────────

export interface SheetOption {
  id: string;
  label: string;
  subtitle?: string;
  /** Trailing text, e.g. "4 cr". */
  trailing?: string;
  /** Leading visual (e.g. a provider logo). */
  leading?: React.ReactNode;
}

export function OptionsSheet({
  visible,
  title,
  options,
  selectedId,
  tint,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: SheetOption[];
  selectedId: string | null;
  tint: ModeTint;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Stack gap="xs" style={{ paddingBottom: 8 }}>
        {options.map((o) => {
          const selected = o.id === selectedId;
          const fg = selected ? tint.fg : undefined;
          return (
            <Pressable
              key={o.id}
              onPress={() => {
                onSelect(o.id);
                onClose();
              }}
              haptic="selection"
              pressedOpacity={0.92}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <HStack
                align="center"
                gap="md"
                style={{
                  padding: 14,
                  borderRadius: 16,
                  backgroundColor: selected ? tint.solid : colors.surface,
                }}
              >
                {o.leading ? (
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: selected ? 'rgba(255,255,255,0.9)' : colors.surfaceMuted,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {o.leading}
                  </View>
                ) : null}
                <Stack gap="xs" style={{ flex: 1 }}>
                  <Text variant="bodySemi" style={fg ? { color: fg } : undefined} color={fg ? undefined : 'ink'}>
                    {o.label}
                  </Text>
                  {o.subtitle ? (
                    <Text
                      variant="caption"
                      style={fg ? { color: fg, opacity: 0.75 } : undefined}
                      color={fg ? undefined : 'inkMuted'}
                    >
                      {o.subtitle}
                    </Text>
                  ) : null}
                </Stack>
                {o.trailing ? (
                  <Text
                    variant="caption"
                    weight="700"
                    style={fg ? { color: fg } : undefined}
                    color={fg ? undefined : 'inkMuted'}
                  >
                    {o.trailing}
                  </Text>
                ) : null}
                {selected ? <Icon name="check" size={18} color={tint.fg} weight="bold" /> : null}
              </HStack>
            </Pressable>
          );
        })}
      </Stack>
    </Sheet>
  );
}

// ─── Aspect ratio ───────────────────────────────────────────────────

/** "9:16" → a little rectangle with that true proportion. */
function RatioGlyph({ ratio, color }: { ratio: string; color: string }) {
  const [w, h] = ratio.split(':').map(Number);
  const MAX = 26;
  const scale = MAX / Math.max(w || 1, h || 1);
  return (
    <View
      style={{
        width: Math.max(8, (w || 1) * scale),
        height: Math.max(8, (h || 1) * scale),
        borderRadius: 4,
        borderWidth: 2,
        borderColor: color,
      }}
    />
  );
}

export function RatioSheet({
  visible,
  title,
  ratios,
  value,
  tint,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  ratios: string[];
  value: string | undefined;
  tint: ModeTint;
  onSelect: (r: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title} maxHeight="55%">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 8 }}>
        {ratios.map((r) => {
          const selected = r === value;
          return (
            <Pressable
              key={r}
              onPress={() => {
                onSelect(r);
                onClose();
              }}
              haptic="selection"
              pressedOpacity={0.92}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Stack
                gap="sm"
                align="center"
                style={{
                  width: 76,
                  paddingVertical: 14,
                  borderRadius: 16,
                  backgroundColor: selected ? tint.solid : colors.surface,
                }}
              >
                <View style={{ height: 28, justifyContent: 'center' }}>
                  <RatioGlyph ratio={r} color={selected ? tint.fg : colors.inkMuted} />
                </View>
                <Text
                  variant="caption"
                  weight="700"
                  style={selected ? { color: tint.fg } : undefined}
                  color={selected ? undefined : 'ink'}
                >
                  {r}
                </Text>
              </Stack>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

// ─── Duration ───────────────────────────────────────────────────────

export function DurationSheet({
  visible,
  title,
  seconds,
  value,
  format,
  tint,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  seconds: number[];
  value: number | undefined;
  format: (s: number) => string;
  tint: ModeTint;
  onSelect: (s: number) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title} maxHeight="55%">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 8 }}>
        {seconds.map((s) => {
          const selected = s === value;
          return (
            <Pressable
              key={s}
              onPress={() => {
                onSelect(s);
                onClose();
              }}
              haptic="selection"
              pressedOpacity={0.92}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <View
                style={{
                  minWidth: 64,
                  alignItems: 'center',
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 14,
                  backgroundColor: selected ? tint.solid : colors.surface,
                }}
              >
                <Text
                  variant="bodySemi"
                  style={selected ? { color: tint.fg } : undefined}
                  color={selected ? undefined : 'ink'}
                >
                  {format(s)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
