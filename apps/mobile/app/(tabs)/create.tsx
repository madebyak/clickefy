import { Box, Button, Stack, Text, useTheme } from '@clickfy/ui';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function CreateScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation('home');
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 16 }}>
      <Box p="lg">
        <Stack gap="lg">
          <Stack gap="sm">
            <Text variant="overline" color="inkMuted" transform="uppercase">
              {t('create.overline')}
            </Text>
            <Text variant="title" color="ink">
              {t('create.title')}
            </Text>
            <Text variant="body" color="inkMuted">
              {t('create.subtitle')}
            </Text>
          </Stack>
          <Button variant="accent" size="lg" full>
            {t('create.browseTemplates')}
          </Button>
        </Stack>
      </Box>
    </View>
  );
}
