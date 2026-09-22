/**
 * RecentsDrawer — the composer's ☰ sidebar, the ChatGPT-style context
 * switcher (mirrors the web studio's):
 *
 *   Create                                   ✕
 *   [ + New session ]
 *   PROJECTS                     ← folders; tap = EXPAND in place
 *   ▸ Client work
 *     ▢ Skincare launch   12 items
 *     ▢ Ramadan campaign   7 items
 *   ▸ Experiments
 *   RECENT                       ← recent projects, flat
 *   ▢ Perfume hero shots   2h ago
 *
 * Tapping a PROJECT (inside a folder or under Recent) never navigates:
 * the drawer closes and the composer loads that project's media into
 * its content area. Tapping a FOLDER only toggles its accordion.
 *
 * The backdrop fades in place while the panel slides from the leading
 * edge (mirrored in RTL) — same split animation as Sheet.
 */

import { HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { I18nManager, Modal, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';

export interface DrawerProjectRef {
  id: string;
  name: string;
  countLabel: string;
  coverUri?: string | number;
}

export interface DrawerFolder {
  id: string;
  name: string;
  projects: DrawerProjectRef[];
}

export interface DrawerRecentRef {
  id: string;
  name: string;
  /** Relative time, preformatted ("2h ago"). */
  when: string;
  coverUri?: string | number;
}

interface RecentsDrawerProps {
  visible: boolean;
  title: string;
  newSessionLabel: string;
  projectsLabel: string;
  recentsLabel: string;
  emptyLabel: string;
  folders: DrawerFolder[];
  recents: DrawerRecentRef[];
  /** The project currently open in the composer, for the active row tint. */
  activeProjectId: string | null;
  onNewSession: () => void;
  onOpenProject: (projectId: string) => void;
  onClose: () => void;
}

export function RecentsDrawer({
  visible,
  title,
  newSessionLabel,
  projectsLabel,
  recentsLabel,
  emptyLabel,
  folders,
  recents,
  activeProjectId,
  onNewSession,
  onOpenProject,
  onClose,
}: RecentsDrawerProps) {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(width * 0.82, 360);

  const [mounted, setMounted] = useState(visible);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const backdrop = useSharedValue(0);
  const slide = useSharedValue(-panelWidth);
  const off = I18nManager.isRTL ? panelWidth : -panelWidth;

  // React's sanctioned "adjust state during render" pattern — mounting
  // must happen before the enter animation.
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      backdrop.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.quad) });
      slide.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
    } else {
      backdrop.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) });
      slide.value = withTiming(off, { duration: 190, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [visible, backdrop, slide, off]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value }] }));

  if (!mounted) return null;

  // Selecting only mutates composer STATE (no navigation), so closing
  // and acting in the same tap is safe.
  const pick = (projectId: string) => {
    onClose();
    onOpenProject(projectId);
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Animated.View
          style={[
            { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
            backdropStyle,
          ]}
        >
          <Pressable onPress={onClose} style={{ flex: 1 }} accessibilityLabel={title} />
        </Animated.View>

        <Animated.View
          style={[
            {
              width: panelWidth,
              backgroundColor: colors.bg,
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 12,
              borderTopRightRadius: 24,
              borderBottomRightRadius: 24,
            },
            panelStyle,
          ]}
        >
          {/* ── Header ── */}
          <HStack align="center" style={{ paddingHorizontal: 20, marginBottom: 12 }}>
            <Text variant="subhead" color="ink" weight="700" style={{ flex: 1 }}>
              {title}
            </Text>
            <Pressable onPress={onClose} haptic="light" accessibilityLabel={title} style={{ padding: 6 }}>
              <Icon name="close" size={18} color={colors.inkMuted} />
            </Pressable>
          </HStack>

          {/* ── New session ── */}
          <View style={{ paddingHorizontal: 16, marginBottom: 18 }}>
            <Pressable
              onPress={() => {
                onClose();
                onNewSession();
              }}
              haptic="light"
              pressedOpacity={0.9}
            >
              <HStack
                align="center"
                gap="sm"
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 16,
                  backgroundColor: colors.surface,
                }}
              >
                <Icon name="plus" size={16} color={accent.solid} weight="bold" />
                <Text variant="bodySemi" color="ink">
                  {newSessionLabel}
                </Text>
              </HStack>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}>
            {/* ── Folders (accordion — expand in place, never navigate) ── */}
            <SectionLabel text={projectsLabel} />
            <Stack gap="xs" style={{ marginBottom: 18 }}>
              {folders.map((folder) => {
                const open = expanded[folder.id] === true;
                return (
                  <View key={folder.id}>
                    <Pressable
                      onPress={() => setExpanded((prev) => ({ ...prev, [folder.id]: !open }))}
                      haptic="light"
                      pressedOpacity={0.9}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                    >
                      <HStack align="center" gap="md" style={{ padding: 8, borderRadius: 14 }}>
                        <View
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: colors.surface,
                          }}
                        >
                          <Icon name="projects" size={15} color={colors.inkMuted} />
                        </View>
                        <Text variant="bodySemi" color="ink" numberOfLines={1} style={{ flex: 1 }}>
                          {folder.name}
                        </Text>
                        <Icon
                          name={open ? 'chevronDown' : 'chevronRight'}
                          size={13}
                          color={colors.inkSubtle}
                        />
                      </HStack>
                    </Pressable>

                    {open
                      ? folder.projects.map((p) => (
                          <ProjectRow
                            key={p.id}
                            name={p.name}
                            caption={p.countLabel}
                            coverUri={p.coverUri}
                            active={p.id === activeProjectId}
                            indent
                            onPress={() => pick(p.id)}
                          />
                        ))
                      : null}
                  </View>
                );
              })}
            </Stack>

            {/* ── Recent projects ── */}
            <SectionLabel text={recentsLabel} />
            {recents.length === 0 ? (
              <Text variant="caption" color="inkMuted" style={{ paddingHorizontal: 8, paddingVertical: 16 }}>
                {emptyLabel}
              </Text>
            ) : (
              <Stack gap="xs">
                {recents.map((r) => (
                  <ProjectRow
                    key={r.id}
                    name={r.name}
                    caption={r.when}
                    coverUri={r.coverUri}
                    active={r.id === activeProjectId}
                    onPress={() => pick(r.id)}
                  />
                ))}
              </Stack>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function ProjectRow({
  name,
  caption,
  coverUri,
  active,
  indent,
  onPress,
}: {
  name: string;
  caption: string;
  coverUri?: string | number;
  active: boolean;
  indent?: boolean;
  onPress: () => void;
}) {
  const { colors, accent } = useTheme();
  return (
    <Pressable onPress={onPress} haptic="light" pressedOpacity={0.9}>
      <HStack
        align="center"
        gap="md"
        style={{
          padding: 8,
          borderRadius: 14,
          marginStart: indent ? 24 : 0,
          backgroundColor: active ? accent.soft : 'transparent',
        }}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            overflow: 'hidden',
            backgroundColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {coverUri ? (
            <Image source={coverUri} contentFit="cover" style={{ width: '100%', height: '100%' }} />
          ) : (
            <Icon name="sparkle" size={14} color={colors.inkMuted} />
          )}
        </View>
        <Stack gap="xs" style={{ flex: 1 }}>
          <Text variant="bodySemi" color="ink" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="caption" color="inkMuted" numberOfLines={1}>
            {caption}
          </Text>
        </Stack>
      </HStack>
    </Pressable>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <Text
      variant="overline"
      color="inkMuted"
      transform="uppercase"
      style={{ paddingHorizontal: 8, marginBottom: 8 }}
    >
      {text}
    </Text>
  );
}
