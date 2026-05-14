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
import { ActivityIndicator, Alert, ScrollView, TextInput, View } from 'react-native';
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

const REASONS: { value: Reason; label: string; helper: string }[] = [
  // Order matters: most-severe first so users intent on flagging
  // serious abuse don't have to scroll past mild categories.
  { value: 'csam', label: 'Child safety', helper: 'Sexual content involving minors.' },
  { value: 'sexual_content', label: 'Sexual content', helper: 'Explicit imagery of adults, non-consensual content.' },
  { value: 'violence_or_threats', label: 'Violence or threats', helper: 'Graphic violence, threats, self-harm.' },
  { value: 'hate_speech', label: 'Hate speech', helper: 'Slurs or dehumanising content targeting a group.' },
  { value: 'harassment', label: 'Harassment', helper: 'Bullying, doxxing, or sustained targeting.' },
  { value: 'copyright', label: 'Copyright', helper: 'Uses my work without permission.' },
  { value: 'spam', label: 'Spam', helper: 'Repetitive, promotional, or misleading.' },
  { value: 'other', label: 'Other', helper: "Doesn't fit the categories above." },
];

export default function ReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const { getToken } = useAuth();
  const { targetType, targetId } = useLocalSearchParams<{
    targetType: 'job_output' | 'template' | 'user';
    targetId: string;
  }>();

  const [reason, setReason] = useState<Reason | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!reason) {
      Alert.alert('Pick a reason', 'Choose the category that best matches your report.');
      return;
    }
    if (!targetType || !targetId) {
      Alert.alert('Missing target', "We couldn't identify what you're reporting. Please try again.");
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
      Alert.alert(
        'Thanks for the report',
        "Our team will review it and take action if it violates our policies. We can't share the outcome of individual reports.",
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err) {
      console.error('[report] submit failed', err);
      Alert.alert(
        "Couldn't submit",
        'Check your connection and try again. If the problem keeps happening, email us from the Profile tab.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Box px="lg" pb="lg">
          <HStack align="center" justify="space-between" mb="md">
            <Pressable
              onPress={() => router.back()}
              haptic="light"
              accessibilityLabel="Cancel"
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.surfaceMuted,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="close" size={18} color={colors.ink} weight="bold" />
            </Pressable>
          </HStack>

          <VStack gap="sm">
            <Text variant="overline" color="inkMuted" transform="uppercase">
              Report content
            </Text>
            <Text variant="title" color="ink">
              What's wrong with this?
            </Text>
            <Text variant="caption" color="inkMuted">
              Reports are anonymous to the creator. A human reviewer looks at every flagged item.
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
                    accessibilityLabel={r.label}
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
                          {r.label}
                        </Text>
                        <Text variant="caption" color="inkMuted">
                          {r.helper}
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
                          marginLeft: 34,
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
              Add context (optional)
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
                placeholder="Anything that helps us review faster (links, who's affected, etc.)"
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
              {notes.length}/2000
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
                    Submitting…
                  </Text>
                </HStack>
              ) : (
                'Submit report'
              )}
            </Button>
            <Button variant="ghost" full onPress={() => router.back()}>
              Cancel
            </Button>
          </VStack>
        </Box>
      </ScrollView>
    </View>
  );
}
