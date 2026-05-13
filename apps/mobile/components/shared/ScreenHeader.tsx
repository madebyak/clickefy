import { HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';

export interface ScreenHeaderProps {
  /** Top eyebrow ("STEP 1 OF 1") */
  eyebrow?: string;
  /** Centered title */
  title?: string;
  /** Override left button icon. Defaults to chevron back. */
  leftIcon?: IconName;
  /** Custom left action (defaults to router.back) */
  onLeft?: () => void;
  /** Optional right icon (e.g. help, refresh) */
  rightIcon?: IconName;
  onRight?: () => void;
  /** Render close (X) on left instead of chevron */
  variant?: 'back' | 'close';
  /** Transparent over hero image — buttons get glass surface */
  transparent?: boolean;
}

/**
 * Standard top header for full-screen routes — back button, optional title,
 * optional right action. 44pt tap targets per iOS HIG.
 */
export function ScreenHeader({
  eyebrow,
  title,
  leftIcon,
  onLeft,
  rightIcon,
  onRight,
  variant = 'back',
  transparent,
}: ScreenHeaderProps) {
  const router = useRouter();
  const { colors } = useTheme();

  const defaultLeftIcon: IconName = variant === 'close' ? 'close' : 'chevronLeft';
  const buttonBg = transparent ? colors.glass : colors.surface;
  const buttonInk = transparent ? colors.glassInk : colors.ink;

  return (
    <HStack px="base" py="sm" align="center" gap="md">
      <Pressable
        onPress={onLeft ?? (() => router.back())}
        haptic="light"
        accessibilityLabel={variant === 'close' ? 'Close' : 'Back'}
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          backgroundColor: buttonBg,
          borderWidth: transparent ? 0 : 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon
          name={leftIcon ?? defaultLeftIcon}
          size={20}
          color={buttonInk}
          weight="bold"
        />
      </Pressable>

      <View style={{ flex: 1 }}>
        {(eyebrow || title) && (
          <Stack align="center" gap="xs">
            {eyebrow ? (
              <Text variant="overline" color="inkMuted" transform="uppercase">
                {eyebrow}
              </Text>
            ) : null}
            {title ? (
              <Text variant="bodySemi" color="ink" weight="700" numberOfLines={1}>
                {title}
              </Text>
            ) : null}
          </Stack>
        )}
      </View>

      {rightIcon ? (
        <Pressable
          onPress={onRight}
          haptic="light"
          accessibilityLabel="Action"
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor: buttonBg,
            borderWidth: transparent ? 0 : 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon
            name={rightIcon}
            size={20}
            color={buttonInk}
            weight="bold"
          />
        </Pressable>
      ) : (
        <View style={{ width: 44 }} />
      )}
    </HStack>
  );
}
