/**
 * Legal pack viewer — one route, five documents.
 *
 * Slug → content lookup lives in `lib/legal-content.ts`. The screen
 * itself is intentionally minimal: typography rules from the design
 * system, no images, no fancy interactions. The goal is "the user
 * (and the App Store reviewer) can read the entire document quickly".
 *
 * Header back button is provided by the Stack navigator in
 * `app/_layout.tsx`; we just supply the title via `Stack.Screen`
 * options inline.
 */

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Box,
  Card,
  Pressable,
  Stack as VStack,
  Text,
  useTheme,
} from '@clickfy/ui';

import { Icon } from '@/components/ui/Icon';
import {
  LEGAL_DOCS,
  type LegalDocSlug,
} from '@/lib/legal-content';

export default function LegalDocScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const slug = doc as LegalDocSlug;
  const content = LEGAL_DOCS[slug];

  if (!content) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 24 }}>
        <Stack.Screen options={{ title: 'Not found' }} />
        <Box px="lg">
          <Text variant="body" color="inkMuted">
            We couldn&apos;t find that document.
          </Text>
        </Box>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: content.title, headerShown: false }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: 80,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Custom header — keeps tokens consistent with the rest of
            the modal-ish screens (edit-profile, paywall) instead of
            the platform stack header which has its own font. */}
        <Box px="lg" pb="md">
          <Pressable
            onPress={() => router.back()}
            haptic="light"
            accessibilityLabel="Back"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <Icon name="chevronLeft" size={18} color={colors.ink} weight="bold" />
          </Pressable>

          <VStack gap="sm">
            <Text variant="overline" color="inkMuted" transform="uppercase">
              Legal
            </Text>
            <Text variant="title" color="ink">
              {content.title}
            </Text>
            <Text variant="caption" color="inkMuted">
              {content.summary}
            </Text>
            <Text variant="caption" color="inkSubtle">
              Effective {content.effectiveDate}
            </Text>
          </VStack>
        </Box>

        <Box px="lg">
          <Card>
            <VStack gap="lg">
              {content.sections.map((section) => (
                <VStack key={section.heading} gap="sm">
                  <Text variant="bodySemi" color="ink" weight="700">
                    {section.heading}
                  </Text>
                  {section.paragraphs.map((p, i) => (
                    <Text
                      key={i}
                      variant="body"
                      color="inkMuted"
                      style={{ lineHeight: 22 }}
                    >
                      {p}
                    </Text>
                  ))}
                </VStack>
              ))}
            </VStack>
          </Card>
        </Box>
      </ScrollView>
    </View>
  );
}
