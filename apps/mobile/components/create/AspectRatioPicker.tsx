/**
 * Aspect-ratio dropdown for the create screen. A trigger row shows the
 * current ratio (with a proportional glyph); tapping opens a bottom-sheet
 * list of the model's supported ratios, each with its own shaped glyph.
 */

import { HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';

/** A rounded rectangle drawn to the ratio's proportions, centered in a box. */
export function RatioGlyph({
  ratio,
  size = 22,
  color,
}: {
  ratio: string;
  size?: number;
  color: string;
}) {
  const parts = ratio.split(':').map((n) => Number(n));
  const valid = parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0);

  let w = size;
  let h = size;
  if (valid) {
    const [rw, rh] = parts as [number, number];
    if (rw >= rh) {
      w = size;
      h = Math.max(6, size * (rh / rw));
    } else {
      h = size;
      w = Math.max(6, size * (rw / rh));
    }
  }

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: w,
          height: h,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: color,
          // "adaptive" / non-numeric ratios render as a dashed square.
          borderStyle: valid ? 'solid' : 'dashed',
        }}
      />
    </View>
  );
}

function label(ratio: string): string {
  return ratio === 'adaptive' ? 'Adaptive' : ratio;
}

interface AspectRatioPickerProps {
  ratios: string[];
  value?: string;
  onChange: (ratio: string) => void;
}

export function AspectRatioPicker({ ratios, value, onChange }: AspectRatioPickerProps) {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('create');
  const [open, setOpen] = useState(false);

  const current = value ?? ratios[0];

  return (
    <>
      {/* Trigger */}
      <Pressable onPress={() => setOpen(true)} haptic="light" pressedOpacity={0.92}>
        <HStack
          align="center"
          gap="md"
          style={{
            padding: 12,
            paddingHorizontal: 14,
            borderRadius: 16,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              backgroundColor: colors.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {current ? <RatioGlyph ratio={current} size={20} color={accent.solid} /> : null}
          </View>
          <Text variant="bodySemi" color="ink" style={{ flex: 1 }}>
            {current ? label(current) : ''}
          </Text>
          <Icon name="chevronDown" size={18} color={colors.inkMuted} />
        </HStack>
      </Pressable>

      {/* Sheet */}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingTop: 10,
              paddingBottom: insets.bottom + 16,
              maxHeight: '80%',
            }}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.borderStrong,
                marginBottom: 12,
              }}
            />
            <Text
              variant="subhead"
              color="ink"
              weight="700"
              style={{ paddingHorizontal: 24, marginBottom: 8 }}
            >
              {t('aspect.label')}
            </Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Stack gap="xs" style={{ paddingHorizontal: 16, paddingTop: 4 }}>
                {ratios.map((r) => {
                  const selected = r === current;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => {
                        onChange(r);
                        setOpen(false);
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
                          padding: 12,
                          borderRadius: 14,
                          backgroundColor: selected ? accent.soft : colors.surface,
                          borderWidth: selected ? 2 : 1,
                          borderColor: selected ? accent.solid : colors.border,
                        }}
                      >
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            backgroundColor: colors.surfaceMuted,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <RatioGlyph
                            ratio={r}
                            size={20}
                            color={selected ? accent.solid : colors.ink}
                          />
                        </View>
                        <Text
                          variant="bodySemi"
                          color={selected ? accent.deep : 'ink'}
                          style={{ flex: 1 }}
                        >
                          {label(r)}
                        </Text>
                        {selected ? (
                          <Icon name="check" size={18} color={accent.solid} weight="bold" />
                        ) : null}
                      </HStack>
                    </Pressable>
                  );
                })}
              </Stack>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
