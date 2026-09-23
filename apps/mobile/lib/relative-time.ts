/**
 * "2 min ago" / "3 hours ago" / "Yesterday"-style labels from an ISO
 * timestamp, in the active language. One formatter for every list that
 * shows recency (Projects tab, the composer drawer) so they never drift.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export function useRelativeTime(): (iso: string) => string {
  const { t } = useTranslation('common');
  return useCallback(
    (iso: string): string => {
      const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
      if (mins < 1) return t('time.justNow');
      if (mins < 60) return t('time.minutesAgo', { count: mins });
      const hours = Math.round(mins / 60);
      if (hours < 24) return t('time.hoursAgo', { count: hours });
      return t('time.daysAgo', { count: Math.round(hours / 24) });
    },
    [t],
  );
}
