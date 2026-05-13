import { Box, Button, Stack, Text, useTheme } from '@clickfy/ui';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function CreateScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 16 }}>
      <Box p="lg">
        <Stack gap="lg">
          <Stack gap="sm">
            <Text variant="overline" color="inkMuted" transform="uppercase">
              Quick create
            </Text>
            <Text variant="title" color="ink">
              Start a generation
            </Text>
            <Text variant="body" color="inkMuted">
              Pick a template, drop your product photo, and we&apos;ll do the rest.
            </Text>
          </Stack>
          <Button variant="accent" size="lg" full>
            Browse templates
          </Button>
        </Stack>
      </Box>
    </View>
  );
}
