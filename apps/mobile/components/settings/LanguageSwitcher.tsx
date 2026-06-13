/**
 * LanguageSwitcher — the EN / العربية chip picker, reused on the Profile
 * screen and inside the drawer. Selecting a different language triggers a
 * confirm dialog and an app reload (see `useLocaleSwitch`).
 */

import { Chip, HStack } from '@clickfy/ui';

import { useLocaleSwitch } from '@/lib/use-locale';
import type { UserLocale } from '@clickfy/types';

const OPTIONS: { value: UserLocale; label: string }[] = [
  { value: 'en', label: 'English · EN' },
  { value: 'ar', label: 'العربية · AR' },
];

export function LanguageSwitcher() {
  const { locale, chooseLocale } = useLocaleSwitch();
  return (
    <HStack gap="sm" wrap="wrap">
      {OPTIONS.map((opt) => (
        <Chip
          key={opt.value}
          label={opt.label}
          active={locale === opt.value}
          onPress={() => chooseLocale(opt.value)}
        />
      ))}
    </HStack>
  );
}
