/**
 * Edit Profile — modal screen for editing display name, locale, and the
 * user's avatar. Email is intentionally read-only here: address changes
 * must go through Clerk's verified flow (out of scope for v1).
 *
 * Server contract:
 *   - PATCH /v1/users/me           — name + locale
 *   - POST  /v1/users/me/avatar    — multipart upload
 *
 * Both calls live in `useSession()` as mutations with optimistic cache
 * updates, so we just compose them here.
 */

import {
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  HStack,
  Pressable,
  Stack,
  Text,
  useTheme,
} from '@clickfy/ui';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormField } from '@/components/auth/FormField';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { Icon } from '@/components/ui/Icon';
import { useSession } from '@/lib/use-session';

type Locale = 'en' | 'ar';

const LOCALE_OPTIONS: { value: Locale; label: string; native: string }[] = [
  { value: 'en', label: 'English', native: 'EN' },
  { value: 'ar', label: 'العربية', native: 'AR' },
];

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const { user, locale: currentLocale, updateProfile, uploadAvatar, meQuery } = useSession();

  const [name, setName] = useState(user?.name ?? '');
  const [locale, setLocale] = useState<Locale>(currentLocale);
  const [nameError, setNameError] = useState<string | undefined>();

  // Keep the form in sync if the upstream query refreshes (e.g. webhook
  // pushes a new value mid-edit). Only re-seeds when the user hasn't
  // started editing.
  useEffect(() => {
    if (user?.name && !name) setName(user.name);
    if (currentLocale && currentLocale !== locale) {
      // Only adopt server value while we haven't diverged locally.
      // (Heuristic: if our local value still matches the last known
      // server value, follow the new server value.)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name, currentLocale]);

  const isDirty = name.trim() !== (user?.name ?? '') || locale !== currentLocale;
  const isSaving = updateProfile.isPending;
  const isUploading = uploadAvatar.isPending;

  const onPickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photo access needed',
        'Allow photo library access to change your avatar.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      // SDK 54: `MediaTypeOptions` is deprecated; pass an array of the
      // string literal union from `ImagePicker.MediaType` instead.
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    // Map MIME from extension fallback if expo doesn't report it.
    const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mime =
      asset.mimeType ??
      (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');

    try {
      await uploadAvatar.mutateAsync({
        uri: asset.uri,
        name: asset.fileName ?? `avatar.${ext}`,
        type: mime,
      });
    } catch (err) {
      Alert.alert('Upload failed', err instanceof Error ? err.message : 'Try again.');
    }
  };

  const onSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError('Name cannot be empty.');
      return;
    }
    if (trimmed.length > 80) {
      setNameError('Keep it under 80 characters.');
      return;
    }
    setNameError(undefined);

    try {
      await updateProfile.mutateAsync({
        ...(trimmed !== (user?.name ?? '') && { name: trimmed }),
        ...(locale !== currentLocale && { locale }),
      });
      router.back();
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Try again.');
    }
  };

  if (!user) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant="body" color="inkMuted">
          Sign in to edit your profile.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <ScreenHeader variant="close" title="Edit profile" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 16}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar */}
          <Card>
            <Stack align="center" gap="md">
              <View>
                <Avatar
                  initials={user.initials}
                  uri={user.avatarUri}
                  size={88}
                />
                {isUploading ? (
                  <View
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 44,
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : null}
              </View>
              <Pressable
                onPress={onPickAvatar}
                haptic="light"
                pressedOpacity={0.85}
                disabled={isUploading}
              >
                <HStack align="center" gap="sm" px="md" py="sm">
                  <Icon name="camera" size={16} color={accent.solid} weight="fill" />
                  <Text variant="bodySemi" color={accent.solid} weight="700">
                    {user.avatarUri ? 'Change photo' : 'Add photo'}
                  </Text>
                </HStack>
              </Pressable>
            </Stack>
          </Card>

          {/* Identity */}
          <Card>
            <Stack gap="md">
              <Text variant="overline" color="inkMuted" transform="uppercase">
                Identity
              </Text>

              <FormField
                label="Display name"
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  if (nameError) setNameError(undefined);
                }}
                placeholder="Your name"
                autoCapitalize="words"
                error={nameError}
                leadingIcon="profile"
              />

              {/* Email row — read only. Send users to Clerk's hosted flow
                  in a later iteration if we want in-app changes. */}
              <Stack gap="xs">
                <Text variant="overline" color="inkMuted" transform="uppercase">
                  Email
                </Text>
                <Box
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                  }}
                >
                  <HStack align="center" justify="space-between">
                    <HStack align="center" gap="md" style={{ flex: 1 }}>
                      <Icon name="envelope" size={18} color={colors.inkMuted} />
                      <Text
                        variant="body"
                        color="ink"
                        style={{ flex: 1 }}
                        numberOfLines={1}
                      >
                        {user.email}
                      </Text>
                    </HStack>
                    <Text variant="caption" color="inkSubtle">
                      Read only
                    </Text>
                  </HStack>
                </Box>
                <Text variant="caption" color="inkSubtle" style={{ paddingHorizontal: 4 }}>
                  Email changes are managed by your sign-in provider.
                </Text>
              </Stack>
            </Stack>
          </Card>

          {/* Locale */}
          <Card>
            <Stack gap="md">
              <Text variant="overline" color="inkMuted" transform="uppercase">
                Language
              </Text>
              <HStack gap="sm" wrap="wrap">
                {LOCALE_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.value}
                    label={`${opt.label} · ${opt.native}`}
                    active={locale === opt.value}
                    onPress={() => setLocale(opt.value)}
                  />
                ))}
              </HStack>
              <Divider />
              <Text variant="caption" color="inkSubtle">
                The app interface and AI prompts will follow this preference.
              </Text>
            </Stack>
          </Card>

          {/* Account meta */}
          <Card>
            <Stack gap="md">
              <Text variant="overline" color="inkMuted" transform="uppercase">
                Account
              </Text>
              <HStack align="center" justify="space-between">
                <Text variant="body" color="inkMuted">
                  Member since
                </Text>
                <Text variant="bodySemi" color="ink">
                  {meQuery.data?.createdAt
                    ? new Date(meQuery.data.createdAt).toLocaleDateString()
                    : '—'}
                </Text>
              </HStack>
            </Stack>
          </Card>
        </ScrollView>

        <View
          style={{
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 16,
            paddingTop: 12,
            backgroundColor: colors.bg,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Button
            variant="primary"
            full
            onPress={onSave}
            disabled={!isDirty || isSaving}
            loading={isSaving}
          >
            Save changes
          </Button>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
