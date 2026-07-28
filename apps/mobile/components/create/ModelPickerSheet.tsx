/**
 * Bottom-sheet model picker for the create screen. Lists the
 * create-eligible models (image/video labelled, with per-model credit
 * cost) and reports the chosen `modelKey`. Built on RN `Modal` to match
 * the app's other sheets (there's no `Sheet` primitive in @clickfy/ui).
 */

import { HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import type { GenModel } from '@clickfy/sdk';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { ModelLogo } from './ModelLogo';

interface ModelPickerSheetProps {
  visible: boolean;
  models: GenModel[];
  selectedKey: string | null;
  onSelect: (modelKey: string) => void;
  onClose: () => void;
}

export function ModelPickerSheet({
  visible,
  models,
  selectedKey,
  onSelect,
  onClose,
}: ModelPickerSheetProps) {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('create');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
      >
        {/* Swallow taps on the card so they don't dismiss the sheet. */}
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
          {/* Grabber */}
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
            {t('model.sheetTitle')}
          </Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Stack gap="xs" style={{ paddingHorizontal: 16, paddingTop: 4 }}>
              {models.map((m) => {
                const selected = m.modelKey === selectedKey;
                return (
                  <Pressable
                    key={m.modelKey}
                    onPress={() => {
                      onSelect(m.modelKey);
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
                        backgroundColor: selected ? accent.soft : colors.surface,
                        borderWidth: selected ? 2 : 1,
                        borderColor: selected ? accent.solid : colors.border,
                      }}
                    >
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 12,
                          backgroundColor: colors.surfaceMuted,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <ModelLogo
                          provider={m.provider}
                          kind={m.kind}
                          size={24}
                          fallbackColor={accent.solid}
                        />
                      </View>
                      <Stack gap="xs" style={{ flex: 1 }}>
                        <Text variant="bodySemi" color={selected ? accent.deep : 'ink'}>
                          {m.name}
                        </Text>
                        <Text variant="caption" color="inkMuted">
                          {m.kind === 'video' ? t('model.video') : t('model.image')} ·{' '}
                          {t('model.creditsEach', { count: m.costCredits })}
                        </Text>
                      </Stack>
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
  );
}
