import {
  Avatar,
  Card,
  Divider,
  HStack,
  Pressable,
  Stack,
  Switch,
  Text,
  useTheme,
} from '@clickfy/ui';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable as RNPressable, ScrollView, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo } from '@/components/brand/Logo';
import { LanguageSwitcher } from '@/components/settings/LanguageSwitcher';
import { PlanLabel } from '@/components/shared/PlanLabel';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useAppearance } from '@/lib/use-appearance';
import { useAuthGate } from '@/lib/auth-gate';
import { useSession } from '@/lib/use-session';

const DRAWER_WIDTH = 320;

interface NavItem {
  icon: IconName;
  /** i18n key under `drawer.nav` for this row's label. */
  labelKey: string;
  href?:
    | '/(tabs)'
    | '/(tabs)/library'
    | '/(tabs)/projects'
    | '/(tabs)/profile'
    | '/saved'
    | '/paywall';
  active?: boolean;
}

// Drawer destinations are limited to routes that actually exist. Anything
// that doesn't have a screen yet (notifications inbox, dedicated settings
// page) lives on the Profile tab instead — we route through it rather than
// rendering dead rows. "Refer a friend" was removed entirely.
const NAV_ITEMS: NavItem[] = [
  { icon: 'home', labelKey: 'explore', href: '/(tabs)', active: true },
  { icon: 'categories', labelKey: 'library', href: '/(tabs)/library' },
  { icon: 'projects', labelKey: 'projects', href: '/(tabs)/projects' },
  { icon: 'bookmark', labelKey: 'savedTemplates', href: '/saved' },
  { icon: 'credit', labelKey: 'buyCredits', href: '/paywall' },
  { icon: 'bell', labelKey: 'notifications', href: '/(tabs)/profile' },
  { icon: 'sliders', labelKey: 'settings', href: '/(tabs)/profile' },
];

export default function DrawerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent, isRTL } = useTheme();
  const { t } = useTranslation('profile');
  const { scheme, toggleScheme } = useAppearance();
  const { user, plan, isAuthed, signOut: sessionSignOut } = useSession();
  const session = isAuthed && user ? { user, plan } : null;
  const { resetOnboarding } = useAuthGate();

  // The drawer anchors to the leading edge — left in LTR, right in RTL — and
  // slides in from off that edge. `translateX` is physical, so flip its sign
  // under RTL. `isRTL` comes from the theme (locale-derived), not
  // `I18nManager`, which is unreliable on the New Architecture.
  const HIDDEN = isRTL ? DRAWER_WIDTH : -DRAWER_WIDTH;

  // Slide-in + scrim fade animation.
  const offset = useSharedValue(HIDDEN);
  const scrim = useSharedValue(0);

  useEffect(() => {
    offset.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
    scrim.value = withTiming(1, { duration: 260 });
  }, [offset, scrim]);

  const close = () => {
    offset.value = withTiming(HIDDEN, { duration: 220 });
    scrim.value = withTiming(0, { duration: 220 });
    setTimeout(() => router.back(), 200);
  };

  const navigate = (href: NavItem['href']) => {
    if (!href) {
      close();
      return;
    }
    offset.value = withTiming(HIDDEN, { duration: 200 });
    scrim.value = withTiming(0, { duration: 200 });
    setTimeout(() => {
      router.back();
      // Then push the target route on the next frame.
      setTimeout(() => router.push(href), 50);
    }, 180);
  };

  const signOut = async () => {
    close();
    await sessionSignOut();
  };

  // TODO(dev-only): Remove this helper + the dev menu entry below before
  // shipping a release build. Gated by __DEV__ so it's already stripped from
  // production bundles, but the surrounding code should still go away once
  // we have a proper QA build flavor.
  const replayOnboarding = async () => {
    offset.value = withTiming(HIDDEN, { duration: 200 });
    scrim.value = withTiming(0, { duration: 200 });
    await resetOnboarding();
    setTimeout(() => {
      router.back();
      setTimeout(() => router.replace('/(auth)/onboarding'), 50);
    }, 180);
  };

  const drawerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

  return (
    <View style={{ flex: 1 }}>
      {/* Scrim — tap to dismiss */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            inset: 0,
            backgroundColor: colors.overlayStrong,
          },
          scrimStyle,
        ]}
      >
        <RNPressable onPress={close} style={{ flex: 1 }} accessibilityLabel={t('drawer.closeMenu')} />
      </Animated.View>

      {/* Drawer */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            // Anchor to the leading edge (left in LTR, right in RTL).
            ...(isRTL ? { right: 0 } : { left: 0 }),
            width: DRAWER_WIDTH,
            backgroundColor: colors.bg,
            // Round the inner edge that faces the content area.
            ...(isRTL
              ? { borderTopLeftRadius: 28, borderBottomLeftRadius: 28 }
              : { borderTopRightRadius: 28, borderBottomRightRadius: 28 }),
            paddingTop: insets.top + 16,
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 24,
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 40,
            // Shadow falls toward the content side.
            shadowOffset: { width: isRTL ? -14 : 14, height: 0 },
            flexDirection: 'column',
          },
          drawerStyle,
        ]}
      >
        {/* Header — SVG brand mark + close */}
        <HStack align="center" justify="space-between" mb="lg">
          <Logo width={108} />
          <Pressable
            onPress={close}
            haptic="light"
            accessibilityLabel={t('drawer.close')}
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="close" size={14} color={colors.ink} weight="bold" />
          </Pressable>
        </HStack>

        {/* Identity card */}
        {session ? (
          <Pressable
            onPress={() => navigate('/(tabs)/profile')}
            haptic="light"
            pressedOpacity={0.85}
            style={{ marginBottom: 22 }}
          >
            <Card>
              <HStack align="center" gap="md">
                <Avatar
                  initials={session.user.initials}
                  uri={session.user.avatarUri}
                  size={44}
                />
                <Stack gap="xs" style={{ flex: 1 }}>
                  <Text variant="bodySemi" color="ink" numberOfLines={1}>
                    {session.user.name}
                  </Text>
                  <HStack align="center" gap="sm">
                    <PlanLabel plan={session.plan?.tier ?? 'Free'} />
                    <HStack align="center" gap="xs">
                      <Icon name="credit" size={12} color={accent.solid} weight="fill" />
                      <Text variant="caption" color="inkMuted">
                        {session.plan?.credits ?? 0}
                      </Text>
                    </HStack>
                  </HStack>
                </Stack>
                <Icon name="chevronRight" size={14} color={colors.inkSubtle} weight="bold" />
              </HStack>
            </Card>
          </Pressable>
        ) : (
          <View style={{ marginBottom: 22 }}>
            <Card surface="surfaceMuted">
              <Stack gap="sm" align="flex-start">
                <Text variant="bodySemi" color="ink">
                  {t('drawer.signedOut')}
                </Text>
                <Pressable onPress={() => navigate('/(tabs)/profile')} haptic="light">
                  <Text variant="caption" color={accent.solid} weight="700">
                    {t('drawer.signIn')}
                  </Text>
                </Pressable>
              </Stack>
            </Card>
          </View>
        )}

        {/* Nav list — scrolls if content overflows */}
        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
          <Stack gap="xs">
            {NAV_ITEMS.map((item) => (
              <NavRow key={item.labelKey} item={item} onPress={() => navigate(item.href)} />
            ))}
          </Stack>
        </ScrollView>

        {/* Footer — language + dark mode toggle + sign out */}
        <Stack gap="sm" mt="md">
          <Card surface="surface">
            <Stack gap="sm">
              <HStack align="center" gap="md">
                <Icon name="language" size={18} color={colors.ink} weight="fill" />
                <Text variant="bodySemi" color="ink" style={{ flex: 1 }}>
                  {t('drawer.language')}
                </Text>
              </HStack>
              <LanguageSwitcher />
            </Stack>
          </Card>

          <Card surface="surface">
            <HStack align="center" gap="md">
              <Icon
                name={scheme === 'dark' ? 'moon' : 'sun'}
                size={18}
                color={colors.ink}
                weight="fill"
              />
              <Text variant="bodySemi" color="ink" style={{ flex: 1 }}>
                {t('drawer.darkMode')}
              </Text>
              <Switch value={scheme === 'dark'} onValueChange={toggleScheme} />
            </HStack>
          </Card>

          {session ? (
            <Pressable onPress={signOut} haptic="warning" pressedOpacity={0.85}>
              <HStack align="center" gap="md" px="sm" py="md">
                <Icon name="signOut" size={18} color={colors.danger} />
                <Text variant="bodySemi" color="danger">
                  {t('drawer.signOut')}
                </Text>
              </HStack>
            </Pressable>
          ) : null}

          {/*
            TODO(REMOVE-BEFORE-RELEASE): Dev-only utilities.
            Currently __DEV__-gated so they don't ship in production bundles,
            but the whole block should be deleted once we have a real QA flow
            (Detox, EAS preview builds, etc.) and no longer need to manually
            replay onboarding from inside the app.
          */}
          {__DEV__ ? (
            <>
              <Divider />
              <Pressable onPress={replayOnboarding} haptic="light" pressedOpacity={0.85}>
                <HStack align="center" gap="md" px="sm" py="md">
                  <Icon name="refresh" size={18} color={colors.inkMuted} />
                  <Text variant="caption" color="inkMuted" weight="600">
                    {t('drawer.replayOnboarding')}
                  </Text>
                </HStack>
              </Pressable>
            </>
          ) : null}
        </Stack>
      </Animated.View>
    </View>
  );
}

function NavRow({ item, onPress }: { item: NavItem; onPress: () => void }) {
  const { colors, accent } = useTheme();
  const { t } = useTranslation('profile');
  return (
    <Pressable onPress={onPress} haptic="light" pressedOpacity={0.8}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderRadius: 14,
          backgroundColor: item.active ? colors.surface : 'transparent',
          borderWidth: item.active ? 1 : 0,
          borderColor: colors.border,
        }}
      >
        <Icon
          name={item.icon}
          size={20}
          color={item.active ? accent.solid : colors.ink}
          weight={item.active ? 'fill' : 'regular'}
        />
        <Text
          variant="bodySemi"
          color="ink"
          weight={item.active ? '700' : '500'}
          style={{ flex: 1, fontSize: 15 }}
        >
          {t(`drawer.nav.${item.labelKey}`)}
        </Text>
      </View>
    </Pressable>
  );
}
