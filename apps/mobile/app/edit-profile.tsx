/**
 * Edit Profile — modal screen for editing the display name and avatar.
 * Email is intentionally read-only here: address changes must go through
 * Clerk's verified flow (out of scope for v1). Language is no longer set
 * here — it lives in the dedicated Language switcher on the Profile screen
 * and the drawer (`components/settings/LanguageSwitcher`), because switching
 * locale restarts the app and shouldn't be buried in a save-button form.
 *
 * Server contract:
 *   - PATCH /v1/users/me           — name
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
  HStack,
  Pressable,
  Stack,
  Text,
  useTheme,
} from '@clickfy/ui';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormField } from '@/components/auth/FormField';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { Icon } from '@/components/ui/Icon';
import { useSession } from '@/lib/use-session';

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const { t } = useTranslation('profile');
  const { user, updateProfile, uploadAvatar, meQuery } = useSession();

  const [name, setName] = useState(user?.name ?? '');
  const [nameError, setNameError] = useState<string | undefined>();

  // Keep the form in sync if the upstream query refreshes (e.g. webhook
  // pushes a new value mid-edit). Only re-seeds when the user hasn't
  // started editing.
  useEffect(() => {
    if (user?.name && !name) setName(user.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name]);

  const isDirty = name.trim() !== (user?.name ?? '');
  const isSaving = updateProfile.isPending;
  const isUploading = uploadAvatar.isPending;

  const onPickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('edit.photoPermTitle'), t('edit.photoPermMessage'));
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
      Alert.alert(t('edit.uploadFailedTitle'), err instanceof Error ? err.message : t('edit.tryAgain'));
    }
  };

  const onSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError(t('edit.nameEmpty'));
      return;
    }
    if (trimmed.length > 80) {
      setNameError(t('edit.nameTooLong'));
      return;
    }
    setNameError(undefined);

    try {
      await updateProfile.mutateAsync({
        ...(trimmed !== (user?.name ?? '') && { name: trimmed }),
      });
      router.back();
    } catch (err) {
      Alert.alert(t('edit.saveFailedTitle'), err instanceof Error ? err.message : t('edit.tryAgain'));
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
          {t('edit.signInToEdit')}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <ScreenHeader variant="close" title={t('edit.headerTitle')} />

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
                    {user.avatarUri ? t('edit.changePhoto') : t('edit.addPhoto')}
                  </Text>
                </HStack>
              </Pressable>
            </Stack>
          </Card>

          {/* Identity */}
          <Card>
            <Stack gap="md">
              <Text variant="overline" color="inkMuted" transform="uppercase">
                {t('edit.identity')}
              </Text>

              <FormField
                label={t('edit.displayName')}
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  if (nameError) setNameError(undefined);
                }}
                placeholder={t('edit.namePlaceholder')}
                autoCapitalize="words"
                error={nameError}
                leadingIcon="profile"
              />

              {/* Email row — read only. Send users to Clerk's hosted flow
                  in a later iteration if we want in-app changes. */}
              <Stack gap="xs">
                <Text variant="overline" color="inkMuted" transform="uppercase">
                  {t('edit.email')}
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
                      {t('edit.readOnly')}
                    </Text>
                  </HStack>
                </Box>
                <Text variant="caption" color="inkSubtle" style={{ paddingHorizontal: 4 }}>
                  {t('edit.emailHelper')}
                </Text>
              </Stack>
            </Stack>
          </Card>

          {/* Account meta */}
          <Card>
            <Stack gap="md">
              <Text variant="overline" color="inkMuted" transform="uppercase">
                {t('edit.account')}
              </Text>
              <HStack align="center" justify="space-between">
                <Text variant="body" color="inkMuted">
                  {t('edit.memberSince')}
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
            {t('edit.saveChanges')}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
