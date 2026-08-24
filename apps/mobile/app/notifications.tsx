/**
 * Notifications inbox — the user's in-app notification feed.
 *
 * Backed by `GET /v1/notifications` (capped at 30 server-side). Tapping a
 * generation notification marks it read and deep-links to its result.
 * "Mark all read" and "Clear all" mirror the standard inbox affordances.
 */

import { HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import type { AppNotification } from '@clickfy/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { Icon, type IconName } from '@/components/ui/Icon';
import { getSDK } from '@/lib/sdk';

const NOTIFICATIONS_KEY = ['notifications'] as const;

export default function NotificationsScreen() {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation('notifications');
  const sdk = getSDK();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => sdk.notifications.list(),
    staleTime: 15_000,
  });
  const items = query.data?.items ?? [];
  const unread = query.data?.unreadCount ?? 0;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });

  const markAllRead = useMutation({
    mutationFn: () => sdk.notifications.markAllRead(),
    onSuccess: invalidate,
    onError: () => Alert.alert(t('errorTitle'), t('errorBody')),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => sdk.notifications.markRead(id),
    onSuccess: invalidate,
  });
  const clearAll = useMutation({
    mutationFn: () => sdk.notifications.clearAll(),
    onSuccess: invalidate,
    onError: () => Alert.alert(t('errorTitle'), t('errorBody')),
  });

  const onPressItem = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id);
    const jobId = typeof n.data?.jobId === 'string' ? n.data.jobId : undefined;
    if ((n.type === 'job_completed' || n.type === 'job_failed') && jobId) {
      router.push({ pathname: '/result/[jobId]', params: { jobId } });
    }
  };

  const confirmClear = () => {
    Alert.alert(t('clearTitle'), t('clearBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('clearAll'), style: 'destructive', onPress: () => clearAll.mutate() },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <ScreenHeader
        variant="back"
        title={t('title')}
        rightIcon={items.length > 0 ? 'trash' : undefined}
        onRight={items.length > 0 ? confirmClear : undefined}
      />

      {/* Mark-all-read row (only when there's something unread) */}
      {unread > 0 ? (
        <HStack justify="flex-end" style={{ paddingHorizontal: 20, paddingBottom: 4 }}>
          <Pressable onPress={() => markAllRead.mutate()} haptic="light" disabled={markAllRead.isPending}>
            <Text variant="caption" color={accent.deep} weight="700">
              {t('markAllRead')}
            </Text>
          </Pressable>
        </HStack>
      ) : null}

      {query.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={accent.solid} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState insets={insets} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 8 }}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => query.refetch()}
              tintColor={accent.solid}
            />
          }
          renderItem={({ item }) => (
            <NotificationRow item={item} onPress={() => onPressItem(item)} />
          )}
        />
      )}
    </View>
  );
}

// ─── Row ────────────────────────────────────────────────────────────

const ICON_BY_TYPE: Record<AppNotification['type'], IconName> = {
  job_completed: 'sparkle',
  job_failed: 'warning',
  system: 'bell',
};

function NotificationRow({ item, onPress }: { item: AppNotification; onPress: () => void }) {
  const { colors, accent } = useTheme();
  const tint =
    item.type === 'job_failed' ? colors.danger : item.type === 'system' ? colors.inkMuted : accent.solid;

  return (
    <Pressable onPress={onPress} haptic="light" pressedOpacity={0.94} accessibilityRole="button">
      <HStack
        gap="md"
        style={{
          padding: 14,
          borderRadius: 18,
          backgroundColor: item.read ? colors.surface : accent.soft,
          borderWidth: 1,
          borderColor: item.read ? colors.border : accent.solid,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={ICON_BY_TYPE[item.type]} size={18} color={tint} weight="fill" />
        </View>
        <Stack gap="xs" style={{ flex: 1 }}>
          <HStack align="center" gap="sm">
            <Text variant="bodySemi" color="ink" style={{ flex: 1 }} numberOfLines={1}>
              {item.title}
            </Text>
            {!item.read ? (
              <View
                style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent.solid }}
              />
            ) : null}
          </HStack>
          <Text variant="caption" color="inkMuted" numberOfLines={2}>
            {item.body}
          </Text>
          <Text variant="caption" color="inkSubtle">
            {item.whenLabel}
          </Text>
        </Stack>
      </HStack>
    </Pressable>
  );
}

// ─── Empty ──────────────────────────────────────────────────────────

function EmptyState({ insets }: { insets: { bottom: number } }) {
  const { accent } = useTheme();
  const { t } = useTranslation('notifications');
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        paddingBottom: insets.bottom + 40,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          backgroundColor: accent.soft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="bell" size={26} color={accent.solid} weight="fill" />
      </View>
      <Text variant="subhead" color="ink" weight="700" align="center">
        {t('empty')}
      </Text>
      <Text variant="body" color="inkMuted" align="center" style={{ lineHeight: 22 }}>
        {t('emptySubtitle')}
      </Text>
    </View>
  );
}
