import { Box, Button, Stack, Text, useTheme } from '@clickfy/ui';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

export default function ModalScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <Box p="lg">
        <Stack gap="md" align="center">
          <Text variant="title" color="ink">
            This is a modal
          </Text>
          <Button variant="ghost" onPress={() => router.back()}>
            Close
          </Button>
        </Stack>
      </Box>
    </View>
  );
}
