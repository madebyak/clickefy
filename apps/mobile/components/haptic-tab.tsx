// Since SDK 57 expo-router vendors its own react-navigation, and the Tabs
// navigator types `tabBarButton` against THAT copy — importing the props
// from `@react-navigation/bottom-tabs` no longer matches.
import type { BottomTabBarButtonProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { PlatformPressable } from 'expo-router/react-navigation';
import * as Haptics from 'expo-haptics';

export function HapticTab(props: BottomTabBarButtonProps) {
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === 'ios') {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    />
  );
}
