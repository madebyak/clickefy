import { Box, Button, Stack, Text, useTheme } from '@clickfy/ui';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

export default function ModalScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <Box p="lg">
        <Stack gap="md" align="center">
          <Text variant="title" color="ink">
            {t('modal.title')}
          </Text>
          <Button variant="ghost" onPress={() => router.back()}>
            {t('modal.close')}
          </Button>
        </Stack>
      </Box>
    </View>
  );
}
