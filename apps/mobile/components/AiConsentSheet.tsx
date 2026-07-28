/**
 * AiConsentSheet — the just-in-time disclosure shown before a user's
 * inputs are first sent to a third-party AI provider. Satisfies App Store
 * 5.1.2(i) / Google Play AI policy: names the providers, links to the full
 * AI & Data policy, and requires an explicit "Agree & Continue".
 *
 * Presentation is a bottom sheet built on React Native's `Modal` (no extra
 * dependency); the scrim dismisses as "Not now" (= cancel, nothing sent).
 */

import { Button, Stack, Text, useTheme } from '@clickfy/ui';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';

export function AiConsentSheet({
  visible,
  onAgree,
  onCancel,
}: {
  visible: boolean;
  onAgree: () => void;
  onCancel: () => void;
}) {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation('generate');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      {/* Scrim — tap outside to dismiss (= "Not now"). */}
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: colors.overlayStrong,
          justifyContent: 'flex-end',
        }}
      >
        {/* Card — swallow taps so they don't dismiss the sheet. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 24,
            paddingTop: 14,
            paddingBottom: insets.bottom + 20,
            gap: 16,
          }}
        >
          {/* Grabber */}
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.border,
            }}
          />

          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              backgroundColor: accent.soft,
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'flex-start',
            }}
          >
            <Icon name="sparkle" size={22} color={accent.solid} weight="fill" />
          </View>

          <Stack gap="xs">
            <Text variant="heading" color="ink">
              {t('consent.title')}
            </Text>
            <Text variant="body" color="inkMuted" style={{ lineHeight: 22 }}>
              {t('consent.body')}
            </Text>
          </Stack>

          <Pressable onPress={() => router.push('/legal/ai-disclosure')} hitSlop={8}>
            <Text variant="bodySemi" color={accent.solid}>
              {t('consent.learnMore')}
            </Text>
          </Pressable>

          <Stack gap="sm">
            <Button variant="accent" size="lg" full haptic="medium" onPress={onAgree}>
              {t('consent.agree')}
            </Button>
            <Button variant="ghost" size="lg" full haptic="light" onPress={onCancel}>
              {t('consent.cancel')}
            </Button>
          </Stack>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
