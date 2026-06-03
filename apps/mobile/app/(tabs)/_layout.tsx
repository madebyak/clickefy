import { useTheme } from '@clickfy/ui';
import { Redirect, Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
 * Icon treatment:
 *   • Inactive → Phosphor `regular` weight, `inkMuted` line stroke.
 *   • Active   → Phosphor `duotone` weight, **accent.solid** primary line,
 *     soft accent fill underneath. Gives the selected tab a clear,
 *     branded two-tone look without changing layout or weight balance.
 *
 * The label colour follows the same accent rule via `tabBarActiveTintColor`,
 * so icon + label move as a single visual unit on selection. Animations
 * (subtle cross-fade between screens) live in this screenOptions block too
 * so they apply uniformly to every tab.
 */
export default function TabLayout() {
  const { colors, accent } = useTheme();
  const { isReady, hasOnboarded, isAuthed } = useAuthGate();
  const insets = useSafeAreaInsets();

  if (!isReady) return null;
  // Authed users always belong on tabs — onboarding/welcome are first-run
  // primers, not gates. Skipping onboarding for OAuth signups keeps the
  // path-to-home short and avoids re-prompting returning users.
  if (!isAuthed) {
    return <Redirect href={hasOnboarded ? '/(auth)/welcome' : '/(auth)/onboarding'} />;
  }

  const renderIcon = (name: IconName, focused: boolean) => (
    <Icon
      name={name}
      // Inactive uses theme inkMuted; active uses accent. The expo-router
      // `color` prop is intentionally ignored — we want full control of the
      // duotone palette per state instead of inheriting the navigator tint.
      color={focused ? accent.solid : colors.inkMuted}
      duotoneColor={focused ? accent.solid : undefined}
      duotoneOpacity={focused ? 0.22 : undefined}
      size={26}
      weight={focused ? 'duotone' : 'regular'}
    />
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: accent.solid,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          // Edge-to-edge (Android 15+) and notched iOS draw the tab bar
          // behind the system navigation bar / home indicator. We size the
          // bar as a fixed content height PLUS the bottom safe-area inset,
          // and push the icons up by that inset, so the tappable row is
          // never hidden behind the gesture pill or 3-button nav on any
          // device. `insets.bottom` is 0 where there's no system bar.
          height: (Platform.OS === 'ios' ? 50 : 64) + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
        },
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: '600',
          letterSpacing: 0.1,
          marginTop: 2,
        },
        headerShown: false,
        tabBarButton: HapticTab,
        // Subtle cross-fade between tabs. `shifting`/`tabBarHideOnKeyboard`
        // are left at defaults; animation is the only visual change so the
        // tab bar itself never moves under the user. iOS-style 220 ms.
        animation: 'fade',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => renderIcon('home', focused),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ focused }) => renderIcon('categories', focused),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarIcon: ({ focused }) => renderIcon('create', focused),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ focused }) => renderIcon('projects', focused),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => renderIcon('profile', focused),
        }}
      />
    </Tabs>
  );
}
