import { Image, View } from 'react-native';

import { Text } from '../primitives/Text';
import { useTheme } from '../theme/ThemeProvider';

export interface AvatarProps {
  /** Initials to render (1–2 chars). Used when no image. */
  initials?: string;
  /** Optional image URI */
  uri?: string;
  /** Size in points */
  size?: number;
  /** Use accent gradient as background */
  accent?: boolean;
}

/**
 * Avatar — circular identity badge with initials fallback.
 * Renders `uri` as a circular image when provided; otherwise falls back
 * to an accent-tinted disc with the user's initials.
 */
export function Avatar({ initials = '?', uri, size = 44, accent = true }: AvatarProps) {
  const theme = useTheme();
  const bg = accent ? theme.accent.solid : theme.colors.surfaceElev;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          resizeMode="cover"
        />
      ) : (
        <Text
          variant="subhead"
          color={accent ? theme.accent.ink : theme.colors.ink}
          weight="700"
          style={{ fontSize: Math.max(11, size * 0.36), letterSpacing: -0.2 }}
        >
          {initials.slice(0, 2).toUpperCase()}
        </Text>
      )}
    </View>
  );
}
