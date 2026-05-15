import {
  Avatar,
  Badge,
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
import { Alert, ScrollView, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppearance } from '@/lib/use-appearance';
import { LEGAL_DOCS, LEGAL_DOC_ORDER } from '@/lib/legal-content';
import { registerForPushNotificationsAsync } from '@/lib/push-notifications';
import { useSession } from '@/lib/use-session';
import { useAuth } from '@clerk/expo';
import { useState } from 'react';

const ACCENT_OPTIONS: AccentKey[] = ['violet', 'coral', 'citrus', 'ocean'];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, accent } = useTheme();
  const {
    user,
    plan,
    isAuthed,
    preferences,
    updateProfile,
    signOut,
    deleteAccount,
  } = useSession();
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
          'Push registered ✅',
          `Token: ${result.token.slice(0, 36)}…\n\nThis device is now reachable from the admin panel.`,
        );
      } else {
        const friendly: Record<string, string> = {
          simulator:
            "You're on a simulator. Push tokens only work on a real device.",
          permission_denied:
            'Notification permission is OFF. Open iOS Settings → Notifications → Expo Go → enable Allow Notifications, then tap this button again.',
          no_project_id:
            "Couldn't find the Expo projectId. Restart the app from the QR code.",
          token_fetch_failed:
            'Expo could not issue a push token. Common causes: no internet, Apple Push servers blocked on this network.',
          backend_register_failed:
            "Got a token from Expo but our API rejected it. Check that you're signed in.",
        };
        Alert.alert(
          'Push registration failed',
          friendly[result.reason ?? ''] ?? `Unknown reason: ${result.reason}`,
        );
      }
    } finally {
      setDiagBusy(false);
    }
  }

  const isDark = scheme === 'dark';

  const onToggleNotification = (key: keyof typeof preferences.notifications) => {
    void updateProfile.mutateAsync({
      preferences: {
        notifications: { [key]: !preferences.notifications[key] },
      },
    });
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
                  {session?.user.name ?? 'Sign in to Clickefy'}
                </Text>
                <HStack align="center" gap="sm">
                  <Badge
                    label={session?.plan?.tier ?? 'Free'}
                    tone={session?.plan?.isPro ? 'gold' : 'neutral'}
                  />
                  <Text variant="caption" color="inkMuted">
                    {session?.plan?.credits ?? 0} credits
                  </Text>
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
                  Your plan
                </Text>
                <Text variant="heading" color="ink">
                  {session?.plan?.tier ?? 'Free'}
                </Text>
              </Stack>
              <Button variant="accent" size="sm" onPress={() => router.push('/paywall')}>
                Top up
              </Button>
            </HStack>
            <Divider />
            <HStack align="center" justify="space-between">
              <Text variant="body" color="inkMuted">
                Credits
              </Text>
              <Text variant="mono" color="ink" weight="700" style={{ fontSize: 18 }}>
                {session?.plan?.credits ?? 0}
              </Text>
            </HStack>
            {session?.plan?.renewsAt ? (
              <>
                <Divider />
                <HStack align="center" justify="space-between">
                  <Text variant="body" color="inkMuted">
                    Renews
                  </Text>
                  <Text variant="bodySemi" color="ink">
                    {new Date(session.plan.renewsAt).toLocaleDateString()}
                  </Text>
                </HStack>
              </>
            ) : null}
          </Stack>
        </Card>

        {/* Appearance */}
        <Card>
          <Stack gap="md">
            <Text variant="overline" color="inkMuted" transform="uppercase">
              Appearance
            </Text>

            <HStack gap="sm" wrap="wrap">
              {(['system', 'light', 'dark'] as const).map((opt) => (
                <Chip
                  key={opt}
                  label={opt === 'system' ? 'System' : opt === 'light' ? 'Light' : 'Dark'}
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
                    Dark mode
                  </Text>
                  <Text variant="caption" color="inkMuted">
                    {mode === 'system' ? 'Following system' : isDark ? 'On' : 'Off'}
                  </Text>
                </Stack>
              </HStack>
              <Switch value={isDark} onValueChange={toggleScheme} />
            </HStack>

            <Divider />

            <Stack gap="sm">
              <Text variant="bodySemi" color="ink">
                Accent
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
                      accessibilityLabel={`${key} accent`}
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
                        {key}
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
                Notifications
              </Text>
              <NotificationRow
                icon="bell"
                label="Job complete"
                helper="Get notified when a generation finishes."
                value={preferences.notifications.jobCompleted}
                onValueChange={() => onToggleNotification('jobCompleted')}
              />
              <Divider />
              <NotificationRow
                icon="sparkle"
                label="Product updates"
                helper="New templates, paywall offers, milestones."
                value={preferences.notifications.productUpdates}
                onValueChange={() => onToggleNotification('productUpdates')}
              />
              <Divider />
              <NotificationRow
                icon="wand"
                label="Tips & tutorials"
                helper="Get the most out of Clickfy."
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
                        {diagBusy ? 'Checking…' : 'Check notification setup'}
                      </Text>
                      <Text variant="caption" color="inkMuted">
                        Tap to verify this device can receive push.
                      </Text>
                    </Stack>
                  </HStack>
                  <Icon name="chevronRight" size={16} color={colors.inkSubtle} weight="bold" />
                </HStack>
              </Pressable>
            </Stack>
          </Card>
        ) : null}

        {/* Quick actions */}
        <Card>
          <Stack gap="sm">
            <ProfileRow
              icon="edit"
              label="Edit profile"
              onPress={() => router.push('/edit-profile')}
              disabled={!session}
            />
            <Divider />
            <ProfileRow icon="bookmark" label="Saved templates" onPress={() => router.push('/saved')} />
            <Divider />
            <ProfileRow icon="gift" label="Refer a friend" onPress={() => {}} />
            <Divider />
            <ProfileRow icon="sliders" label="Settings" onPress={() => {}} />
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
              Legal & policies
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
            Sign out
          </Button>
        ) : (
          <Button
            variant="primary"
            full
            onPress={() => router.push('/(auth)/welcome')}
          >
            Sign in
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
                Danger zone
              </Text>
              <Text variant="caption" color="inkMuted">
                Deleting your account is permanent. Your library, history,
                and any unused credits are removed and can&apos;t be restored.
              </Text>
              <Pressable
                onPress={() =>
                  Alert.alert(
                    'Delete your account?',
                    'This permanently removes your account, library, and any unused credits. We can\u2019t undo this.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete account',
                        style: 'destructive',
                        onPress: () => {
                          deleteAccount.mutate(undefined, {
                            onSuccess: () => {
                              router.replace('/(auth)/welcome');
                            },
                            onError: (err) => {
                              Alert.alert(
                                'Could not delete',
                                err instanceof Error
                                  ? err.message
                                  : 'Check your connection and try again.',
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
                      {deleteAccount.isPending ? 'Deleting\u2026' : 'Delete account'}
                    </Text>
                  </HStack>
                </HStack>
              </Pressable>
            </Stack>
          </Card>
        ) : null}

        <Text variant="caption" color="inkSubtle" align="center">
          Active accent: {accentKey} · Scheme: {scheme} · Brand: {accent.solid}
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
