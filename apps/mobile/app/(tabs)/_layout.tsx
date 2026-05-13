import { useTheme } from '@clickfy/ui';
import { Redirect, Tabs } from 'expo-router';
import { Platform } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useAuthGate } from '@/lib/auth-gate';

/**
 * Bottom tab bar — five primary destinations.
 * The center "Create" tab is the high-emphasis CTA (matches prototype's FAB).
 *
 * Guarded: redirects to onboarding if the user hasn't seen it,
 * then to sign-in if not authenticated.
 *
 * Icon weighting follows iOS HIG: 'fill' for the active tab, 'regular' for
 * inactive — same affordance Phosphor offers cross-platform.
 */
export default function TabLayout() {
  const { colors, accent } = useTheme();
  const { isReady, hasOnboarded, isAuthed } = useAuthGate();

  if (!isReady) return null;
  // Authed users always belong on tabs — onboarding/welcome are first-run
  // primers, not gates. Skipping onboarding for OAuth signups keeps the
  // path-to-home short and avoids re-prompting returning users.
  if (!isAuthed) {
    return <Redirect href={hasOnboarded ? '/(auth)/welcome' : '/(auth)/onboarding'} />;
  }

  const renderIcon = (name: IconName, color: string, focused: boolean) => (
    <Icon
      name={name}
      color={color}
      size={26}
      weight={focused ? 'fill' : 'regular'}
    />
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: '600',
          letterSpacing: 0.1,
          marginTop: 2,
        },
        headerShown: false,
        tabBarButton: HapticTab,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => renderIcon('home', color, focused),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, focused }) => renderIcon('categories', color, focused),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarActiveTintColor: accent.solid,
          tabBarIcon: ({ focused }) =>
            renderIcon('create', accent.solid, focused),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, focused }) => renderIcon('projects', color, focused),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => renderIcon('profile', color, focused),
        }}
      />
    </Tabs>
  );
}
