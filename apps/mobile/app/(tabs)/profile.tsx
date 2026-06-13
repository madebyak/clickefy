import {
  Avatar,
  Button,
  Card,
  Chip,
  Divider,
  HStack,
  Pressable,
  Stack,
  Switch,
  Text,
  accents,
  useTheme,
  type AccentKey,
} from '@clickfy/ui';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, View } from 'react-native';

import { LanguageSwitcher } from '@/components/settings/LanguageSwitcher';
import { PlanLabel } from '@/components/shared/PlanLabel';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppearance } from '@/lib/use-appearance';
import { LEGAL_DOCS, LEGAL_DOC_ORDER } from '@/lib/legal-content';
import { registerForPushNotificationsAsync } from '@/lib/push-notifications';
import { useNotificationPrefs } from '@/lib/use-notification-prefs';
import { useSession } from '@/lib/use-session';
import { useAuth } from '@clerk/expo';
import { useState } from 'react';

const ACCENT_OPTIONS: AccentKey[] = ['violet', 'coral', 'citrus', 'ocean'];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation('profile');
  const { colors, accent } = useTheme();
  const {
    user,
    plan,
    isAuthed,
    preferences,
    signOut,
    deleteAccount,
  } = useSession();
  const { setNotification } = useNotificationPrefs();
  const { getToken } = useAuth();
  const [diagBusy, setDiagBusy] = useState(false);
  const { mode, scheme, accentKey, setMode, setAccent, toggleScheme } = useAppearance();
  const session = isAuthed && user ? { user, plan } : null;

  // Push diagnostic: re-runs the full registration flow on demand and
  // surfaces exactly what's happening on this device. Used to debug
  // empty `device_tokens` rows when testing on Expo Go — without this,
  // failures are silent because users don't have Metro attached.
  async function runPushDiagnostic() {
    setDiagBusy(true);
    try {
      const result = await registerForPushNotificationsAsync(async () => getToken());
      if (result.token) {
        Alert.alert(
          t('notifications.diagnostic.registeredTitle'),
          t('notifications.diagnostic.registeredMessage', {
            token: result.token.slice(0, 36),
          }),
        );
      } else {
        const friendly: Record<string, string> = {
          simulator: t('notifications.diagnostic.reasons.simulator'),
          permission_denied: t('notifications.diagnostic.reasons.permissionDenied'),
          no_project_id: t('notifications.diagnostic.reasons.noProjectId'),
          token_fetch_failed: t('notifications.diagnostic.reasons.tokenFetchFailed'),
          backend_register_failed: t('notifications.diagnostic.reasons.backendRegisterFailed'),
        };
        Alert.alert(
          t('notifications.diagnostic.failedTitle'),
          friendly[result.reason ?? ''] ??
            t('notifications.diagnostic.unknownReason', { reason: result.reason }),
        );
      }
    } finally {
      setDiagBusy(false);
    }
  }

  const isDark = scheme === 'dark';

  const onToggleNotification = (key: keyof typeof preferences.notifications) => {
    // Optimistic + debounced server write (see useNotificationPrefs) so
    // rapid toggling can't spam PATCH /v1/users/me into a 429.
    setNotification(key, !preferences.notifications[key]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 18 }}
      >
        {/* Identity card */}
        <Pressable
          onPress={() => (session ? router.push('/edit-profile') : router.push('/(auth)/welcome'))}
          haptic="light"
          pressedOpacity={0.9}
        >
          <Card elevation="raised">
            <HStack align="center" gap="md">
              <Avatar
                initials={session?.user.initials ?? '·'}
                uri={session?.user.avatarUri}
                size={52}
              />
              <Stack style={{ flex: 1 }} gap="xs">
                <Text variant="subhead" color="ink" weight="700">
                  {session?.user.name ?? t('identity.signInPrompt')}
                </Text>
                <HStack align="center" gap="sm">
                  <PlanLabel plan={session?.plan?.tier ?? 'Free'} size="md" />
                  <HStack align="center" gap="xs">
                    <Icon name="credit" size={13} color={accent.solid} weight="fill" />
                    <Text variant="caption" color="inkMuted">
                      {session?.plan?.credits ?? 0}
                    </Text>
                  </HStack>
                </HStack>
              </Stack>
              {session ? (
                <Icon name="chevronRight" size={16} color={colors.inkSubtle} weight="bold" />
              ) : null}
            </HStack>
          </Card>
        </Pressable>

        {/* Plan + credits */}
        <Card>
          <Stack gap="md">
            <HStack align="center" justify="space-between">
              <Stack gap="xs">
                <Text variant="overline" color="inkMuted" transform="uppercase">
                  {t('plan.sectionTitle')}
                </Text>
                <Text variant="heading" color="ink">
                  {session?.plan?.tier ?? 'Free'}
                </Text>
              </Stack>
              <Button variant="accent" size="sm" onPress={() => router.push('/paywall')}>
                {t('plan.topUp')}
              </Button>
            </HStack>
            <Divider />
            <HStack align="center" justify="space-between">
              <HStack align="center" gap="sm">
                <Icon name="credit" size={16} color={accent.solid} weight="fill" />
                <Text variant="body" color="inkMuted">
                  {t('plan.credits')}
                </Text>
              </HStack>
              <Text variant="mono" color="ink" weight="700" style={{ fontSize: 18 }}>
                {session?.plan?.credits ?? 0}
              </Text>
            </HStack>
            {session?.plan?.renewsAt ? (
              <>
                <Divider />
                <HStack align="center" justify="space-between">
                  <Text variant="body" color="inkMuted">
                    {t('plan.renews')}
                  </Text>
                  <Text variant="bodySemi" color="ink">
                    {new Date(session.plan.renewsAt).toLocaleDateString()}
                  </Text>
                </HStack>
              </>
            ) : null}
          </Stack>
        </Card>

        {/* Language */}
        <Card>
          <Stack gap="md">
            <Text variant="overline" color="inkMuted" transform="uppercase">
              {t('language.title')}
            </Text>
            <LanguageSwitcher />
            <Divider />
            <Text variant="caption" color="inkSubtle">
              {t('language.caption')}
            </Text>
          </Stack>
        </Card>

        {/* Appearance */}
        <Card>
          <Stack gap="md">
            <Text variant="overline" color="inkMuted" transform="uppercase">
              {t('appearance.title')}
            </Text>

            <HStack gap="sm" wrap="wrap">
              {(['system', 'light', 'dark'] as const).map((opt) => (
                <Chip
                  key={opt}
                  label={
                    opt === 'system'
                      ? t('appearance.modeSystem')
                      : opt === 'light'
                        ? t('appearance.modeLight')
                        : t('appearance.modeDark')
                  }
                  active={mode === opt}
                  onPress={() => setMode(opt)}
                />
              ))}
            </HStack>

            <Divider />

            <HStack align="center" justify="space-between">
              <HStack align="center" gap="md">
                <Icon
                  name={isDark ? 'moon' : 'sun'}
                  size={20}
                  color={colors.ink}
                  weight="fill"
                />
                <Stack gap="xs">
                  <Text variant="bodySemi" color="ink">
                    {t('appearance.darkMode')}
                  </Text>
                  <Text variant="caption" color="inkMuted">
                    {mode === 'system'
                      ? t('appearance.followingSystem')
                      : isDark
                        ? t('appearance.on')
                        : t('appearance.off')}
                  </Text>
                </Stack>
              </HStack>
              <Switch value={isDark} onValueChange={toggleScheme} />
            </HStack>

            <Divider />

            <Stack gap="sm">
              <Text variant="bodySemi" color="ink">
                {t('appearance.accent')}
              </Text>
              <HStack gap="md" wrap="wrap">
                {ACCENT_OPTIONS.map((key) => {
                  const isActive = key === accentKey;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setAccent(key)}
                      haptic="selection"
                      pressedOpacity={0.7}
                      accessibilityLabel={t('appearance.accentA11y', {
                        accent: t(`appearance.accents.${key}`),
                      })}
                      style={{ alignItems: 'center', gap: 6 }}
                    >
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: accents[key].solid,
                          borderWidth: 2,
                          borderColor: isActive ? colors.ink : 'transparent',
                          shadowColor: accents[key].solid,
                          shadowOpacity: isActive ? 0.5 : 0,
                          shadowRadius: 8,
                          shadowOffset: { width: 0, height: 0 },
                        }}
                      />
                      <Text
                        variant="caption"
                        color={isActive ? 'ink' : 'inkMuted'}
                        weight={isActive ? '600' : '500'}
                        style={{ fontSize: 11.5, textTransform: 'capitalize' }}
                      >
                        {t(`appearance.accents.${key}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </HStack>
            </Stack>
          </Stack>
        </Card>

        {/* Notifications */}
        {session ? (
          <Card>
            <Stack gap="md">
              <Text variant="overline" color="inkMuted" transform="uppercase">
                {t('notifications.title')}
              </Text>
              <NotificationRow
                icon="bell"
                label={t('notifications.jobComplete.label')}
                helper={t('notifications.jobComplete.helper')}
                value={preferences.notifications.jobCompleted}
                onValueChange={() => onToggleNotification('jobCompleted')}
              />
              <Divider />
              <NotificationRow
                icon="sparkle"
                label={t('notifications.productUpdates.label')}
                helper={t('notifications.productUpdates.helper')}
                value={preferences.notifications.productUpdates}
                onValueChange={() => onToggleNotification('productUpdates')}
              />
              <Divider />
              <NotificationRow
                icon="wand"
                label={t('notifications.tips.label')}
                helper={t('notifications.tips.helper')}
                value={preferences.notifications.tipsAndTutorials}
                onValueChange={() => onToggleNotification('tipsAndTutorials')}
              />
              <Divider />
              <Pressable
                onPress={runPushDiagnostic}
                disabled={diagBusy}
                haptic="light"
                pressedOpacity={0.85}
              >
                <HStack align="center" justify="space-between" py="sm">
                  <HStack align="center" gap="md" style={{ flex: 1 }}>
                    <Icon name="info" size={20} color={colors.ink} weight="fill" />
                    <Stack gap="xs" style={{ flex: 1 }}>
                      <Text variant="bodySemi" color="ink">
                        {diagBusy
                          ? t('notifications.diagnostic.checking')
                          : t('notifications.diagnostic.label')}
                      </Text>
                      <Text variant="caption" color="inkMuted">
                        {t('notifications.diagnostic.helper')}
                      </Text>
                    </Stack>
                  </HStack>
                  <Icon name="chevronRight" size={16} color={colors.inkSubtle} weight="bold" />
                </HStack>
              </Pressable>
            </Stack>
          </Card>
        ) : null}

        {/* Quick actions
            Kept intentionally short: only rows with real destinations
            ship here. "Refer a friend" and the placeholder "Settings"
            row used to live here but were removed — Settings is just
            this Profile screen, so the row was pointing at itself. */}
        <Card>
          <Stack gap="sm">
            <ProfileRow
              icon="edit"
              label={t('actions.editProfile')}
              onPress={() => router.push('/edit-profile')}
              disabled={!session}
            />
            <Divider />
            <ProfileRow
              icon="bookmark"
              label={t('actions.savedTemplates')}
              onPress={() => router.push('/saved')}
            />
            <Divider />
            <ProfileRow
              icon="credit"
              label={t('actions.buyCredits')}
              onPress={() => router.push('/paywall')}
            />
          </Stack>
        </Card>

        {/* Legal & policies
            App Store guideline 1.5 requires every app to surface its
            Terms + Privacy from inside the app. Grouping the full pack
            here keeps reviewers happy AND gives users a single place
            to find every policy without us having to inline a giant
            footer everywhere. */}
        <Card>
          <Stack gap="sm">
            <Text variant="overline" color="inkMuted" transform="uppercase">
              {t('legal.title')}
            </Text>
            {LEGAL_DOC_ORDER.map((slug, i) => (
              <View key={slug}>
                <ProfileRow
                  icon="info"
                  label={LEGAL_DOCS[slug].title}
                  onPress={() =>
                    router.push({ pathname: '/legal/[doc]', params: { doc: slug } })
                  }
                />
                {i < LEGAL_DOC_ORDER.length - 1 ? <Divider /> : null}
              </View>
            ))}
          </Stack>
        </Card>

        {session ? (
          <Button variant="ghost" full onPress={() => void signOut()}>
            {t('auth.signOut')}
          </Button>
        ) : (
          <Button
            variant="primary"
            full
            onPress={() => router.push('/(auth)/welcome')}
          >
            {t('auth.signIn')}
          </Button>
        )}

        {/* Danger zone — required by App Store guideline 5.1.1(v) and
            Google Play's Account-Deletion policy. The two-step
            confirmation (native Alert + destructive style) is the
            App Store-blessed pattern. Mutation handles sign-out +
            cache flush internally; we just navigate away. */}
        {session ? (
          <Card>
            <Stack gap="sm">
              <Text variant="overline" color="danger" transform="uppercase" weight="700">
                {t('danger.title')}
              </Text>
              <Text variant="caption" color="inkMuted">
                {t('danger.description')}
              </Text>
              <Pressable
                onPress={() =>
                  Alert.alert(
                    t('danger.confirmTitle'),
                    t('danger.confirmMessage'),
                    [
                      { text: t('danger.cancel'), style: 'cancel' },
                      {
                        text: t('danger.delete'),
                        style: 'destructive',
                        onPress: () => {
                          deleteAccount.mutate(undefined, {
                            onSuccess: () => {
                              router.replace('/(auth)/welcome');
                            },
                            onError: (err) => {
                              Alert.alert(
                                t('danger.errorTitle'),
                                err instanceof Error
                                  ? err.message
                                  : t('danger.errorMessage'),
                              );
                            },
                          });
                        },
                      },
                    ],
                  )
                }
                haptic="warning"
                pressedOpacity={0.9}
                disabled={deleteAccount.isPending}
              >
                <HStack
                  align="center"
                  justify="space-between"
                  py="sm"
                  px="md"
                  style={{
                    borderWidth: 1,
                    borderColor: colors.danger,
                    borderRadius: 14,
                    backgroundColor: colors.surface,
                  }}
                >
                  <HStack align="center" gap="md">
                    <Icon name="trash" size={18} color={colors.danger} weight="bold" />
                    <Text variant="bodySemi" color="danger">
                      {deleteAccount.isPending ? t('danger.deleting') : t('danger.delete')}
                    </Text>
                  </HStack>
                </HStack>
              </Pressable>
            </Stack>
          </Card>
        ) : null}

        <Text variant="caption" color="inkSubtle" align="center">
          {t('appearance.debug', {
            accent: t(`appearance.accents.${accentKey}`),
            scheme,
            brand: accent.solid,
          })}
        </Text>
      </ScrollView>
    </View>
  );
}

function NotificationRow({
  icon,
  label,
  helper,
  value,
  onValueChange,
}: {
  icon: IconName;
  label: string;
  helper: string;
  value: boolean;
  onValueChange: () => void;
}) {
  const { colors } = useTheme();
  return (
    <HStack align="center" justify="space-between" gap="md">
      <HStack align="center" gap="md" style={{ flex: 1 }}>
        <Icon name={icon} size={20} color={colors.ink} weight="fill" />
        <Stack gap="xs" style={{ flex: 1 }}>
          <Text variant="bodySemi" color="ink">
            {label}
          </Text>
          <Text variant="caption" color="inkMuted">
            {helper}
          </Text>
        </Stack>
      </HStack>
      <Switch value={value} onValueChange={onValueChange} />
    </HStack>
  );
}

function ProfileRow({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} haptic="light" pressedOpacity={0.85} disabled={disabled}>
      <HStack align="center" justify="space-between" py="sm">
        <HStack align="center" gap="md">
          <Icon
            name={icon}
            size={20}
            color={disabled ? colors.inkSubtle : colors.ink}
            weight="fill"
          />
          <Text
            variant="bodySemi"
            color={disabled ? 'inkSubtle' : 'ink'}
          >
            {label}
          </Text>
        </HStack>
        <Icon name="chevronRight" size={16} color={colors.inkSubtle} weight="bold" />
      </HStack>
    </Pressable>
  );
}
