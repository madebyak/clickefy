/**
 * Content report flow — modal presented from a flag button.
 *
 * Inputs (via search params):
 *   - targetType: 'job_output' | 'template' | 'user'
 *   - targetId:   the polymorphic identifier (see reports schema)
 *
 * Why a full-screen modal instead of a bottom sheet:
 *   - Reporting touches sensitive subjects (CSAM, harassment). A
 *     committed full-screen flow signals "this is taken seriously"
 *     rather than the half-attention feel of a peek-up sheet.
 *   - We want the optional notes field to have proper keyboard room.
 *
 * The submit handler is fire-and-forget from the user's perspective:
 * a toast + immediate dismissal. The backend never tells the reporter
 * what we did with the report — see api/src/routes/reports.ts.
 */

import { useAuth } from '@clerk/expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Box,
  Button,
  Card,
  HStack,
  Pressable,
  Stack as VStack,
  Text,
  useTheme,
} from '@clickfy/ui';

import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { useToast } from '@/components/shared/Toast';
import { Icon } from '@/components/ui/Icon';
import { config } from '@/lib/config';

type Reason =
  | 'csam'
  | 'sexual_content'
  | 'violence_or_threats'
  | 'hate_speech'
  | 'harassment'
  | 'spam'
  | 'copyright'
  | 'other';

// Order matters: most-severe first so users intent on flagging
// serious abuse don't have to scroll past mild categories. Labels +
// helpers are resolved at render via i18n (see `reasons.<key>` keys).
const REASONS: { value: Reason; key: string }[] = [
  { value: 'csam', key: 'csam' },
  { value: 'sexual_content', key: 'sexualContent' },
  { value: 'violence_or_threats', key: 'violenceOrThreats' },
  { value: 'hate_speech', key: 'hateSpeech' },
  { value: 'harassment', key: 'harassment' },
  { value: 'copyright', key: 'copyright' },
  { value: 'spam', key: 'spam' },
  { value: 'other', key: 'other' },
];

export default function ReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const { t } = useTranslation('report');
  const { getToken } = useAuth();
  const toast = useToast();
  const { targetType, targetId } = useLocalSearchParams<{
    targetType: 'job_output' | 'template' | 'user';
    targetId: string;
  }>();

  const [reason, setReason] = useState<Reason | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!reason) {
      Alert.alert(t('pickReasonTitle'), t('pickReasonMessage'));
      return;
    }
    if (!targetType || !targetId) {
      Alert.alert(t('missingTargetTitle'), t('missingTargetMessage'));
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiUrl}/v1/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          targetType,
          targetId,
          reason,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok && res.status !== 202) {
        const body = await res.text();
        throw new Error(`POST /v1/reports ${res.status}: ${body.slice(0, 200)}`);
      }
      // Deliberately don't echo "report received" beyond a generic
      // confirmation — protects the anonymity of the moderation flow.
      // Toast is non-blocking; the screen dismisses immediately so the
      // user isn't trapped in a modal-on-modal flow.
      toast.success(t('successTitle'), t('successMessage'));
      router.back();
    } catch (err) {
      console.error('[report] submit failed', err);
      toast.error(t('errorTitle'), t('errorMessage'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      // iOS pushes via `padding` so the bottom CTA + textarea stay above
      // the keyboard. Android relies on `android:softInputMode` set in
      // app.json (`softwareKeyboardLayoutMode: "pan"`) — passing
      // `undefined` here avoids fighting that native behaviour.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Modal-style header: X (close) on the left, no title — the title
          block below carries the page identity. Matches the rest of the
          stack screens migrated to ScreenHeader. */}
      <ScreenHeader variant="close" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Box px="lg" pb="lg">
          <VStack gap="sm">
            <Text variant="overline" color="inkMuted" transform="uppercase">
              {t('eyebrow')}
            </Text>
            <Text variant="title" color="ink">
              {t('title')}
            </Text>
            <Text variant="caption" color="inkMuted">
              {t('subtitle')}
            </Text>
          </VStack>
        </Box>

        {/* Reason picker */}
        <Box px="lg">
          <Card>
            <VStack gap="md">
              {REASONS.map((r, i) => {
                const isActive = reason === r.value;
                return (
                  <Pressable
                    key={r.value}
                    onPress={() => setReason(r.value)}
                    haptic="selection"
                    pressedOpacity={0.85}
                    accessibilityLabel={t(`reasons.${r.key}.label`)}
                    accessibilityState={{ selected: isActive }}
                  >
                    <HStack align="center" gap="md" py="sm">
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          borderWidth: 2,
                          borderColor: isActive ? accent.solid : colors.border,
                          backgroundColor: isActive ? accent.solid : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isActive ? <Icon name="check" size={12} color="#FFFFFF" weight="bold" /> : null}
                      </View>
                      <VStack style={{ flex: 1 }} gap="xs">
                        <Text variant="bodySemi" color="ink">
                          {t(`reasons.${r.key}.label`)}
                        </Text>
                        <Text variant="caption" color="inkMuted">
                          {t(`reasons.${r.key}.helper`)}
                        </Text>
                      </VStack>
                    </HStack>
                    {/* Divider for all but the last row. Inline so it
                        respects the Card padding rather than the
                        Divider's full-bleed width. */}
                    {i < REASONS.length - 1 ? (
                      <View
                        style={{
                          height: 1,
                          backgroundColor: colors.border,
                          marginStart: 34,
                        }}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </VStack>
          </Card>
        </Box>

        {/* Optional notes */}
        <Box px="lg" pt="lg">
          <VStack gap="sm">
            <Text variant="overline" color="inkMuted" transform="uppercase">
              {t('notesLabel')}
            </Text>
            <View
              style={{
                minHeight: 100,
                borderRadius: 16,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            >
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder={t('notesPlaceholder')}
                placeholderTextColor={colors.inkMuted}
                multiline
                maxLength={2000}
                style={{
                  color: colors.ink,
                  fontSize: 15,
                  fontFamily: 'Geist_500Medium',
                  letterSpacing: -0.1,
                  minHeight: 80,
                  textAlignVertical: 'top',
                }}
                selectionColor={accent.solid}
              />
            </View>
            <Text variant="caption" color="inkSubtle" align="right">
              {t('notesCount', { current: notes.length })}
            </Text>
          </VStack>
        </Box>

        {/* CTAs */}
        <Box px="lg" pt="xl">
          <VStack gap="sm">
            <Button
              variant="primary"
              full
              onPress={handleSubmit}
              disabled={submitting || !reason}
            >
              {submitting ? (
                <HStack align="center" gap="sm">
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text color="#FFFFFF" weight="700">
                    {t('submitting')}
                  </Text>
                </HStack>
              ) : (
                t('submit')
              )}
            </Button>
            <Button variant="ghost" full onPress={() => router.back()}>
              {t('cancel')}
            </Button>
          </VStack>
        </Box>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
