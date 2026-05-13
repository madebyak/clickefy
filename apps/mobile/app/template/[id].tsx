/**
 * Template detail — follows the reference prototype (`CFTemplateDetail`)
 * spacing and visual treatment exactly, adapted from bottom-sheet overlay
 * to a scroll-based layout for better UX.
 *
 * Layout:
 *   1. Full-bleed hero with gradient scrim
 *   2. Content card (surface bg, rounded top) overlapping the hero
 *   3. Pull indicator → meta pills → title → author → inputs
 *   4. Sticky CTA: "Costs" + credits left, accent button right
 *   5. Glass back/share/heart buttons floating over hero
 */

import {
  Button,
  Pressable,
  Skeleton,
  useTheme,
} from '@clickfy/ui';
import type { CatalogTemplate, TemplateOutputSummary } from '@clickfy/sdk';
import type { TemplateInput } from '@clickfy/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Dimensions, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeroMedia, getHeroHeight } from '@/components/template/HeroMedia';
import { Icon, type IconName } from '@/components/ui/Icon';
import { TEMPLATE_QUERY } from '@/lib/query-config';
import { getSDK } from '@/lib/sdk';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function TemplateDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent, fontFamily: ff } = useTheme();
  const sdk = getSDK();

  const templateQuery = useQuery({
    queryKey: ['template', id],
    queryFn: () => sdk.catalog.getTemplate(id!),
    enabled: !!id,
    ...TEMPLATE_QUERY,
  });

  const t = templateQuery.data;
  const qc = useQueryClient();

  // Locally-controlled favorite state — we mirror the server's
  // `isFavorited` on first load and let the optimistic mutation
  // flip it instantly on tap, rolling back on error. Without the
  // local mirror the heart would lag the tap by a network round
  // trip.
  const [favorited, setFavorited] = useState<boolean>(false);
  useEffect(() => {
    if (typeof t?.isFavorited === 'boolean') setFavorited(t.isFavorited);
  }, [t?.isFavorited]);

  const favoriteMutation = useMutation({
    mutationFn: (next: boolean) => sdk.catalog.setFavorite(t!.id, next),
    onMutate: (next) => {
      setFavorited(next);
      return { previous: !next };
    },
    onError: (_err, _next, ctx) => {
      // Roll back. The saved-templates list will refetch on next
      // visit; we don't pre-emptively invalidate it because the
      // single-template cache update is the source of truth.
      if (ctx) setFavorited(ctx.previous);
    },
    onSuccess: (data) => {
      setFavorited(data.isFavorited);
      // Keep the saved-templates query in sync so the Library tab
      // reflects the change on its next visit without a flash.
      void qc.invalidateQueries({ queryKey: ['library-saved'] });
    },
  });

  const heroHeight = t ? getHeroHeight(t.aspect) : SCREEN_WIDTH * 0.95;

  // ── Entrance animation ──
  const sheetY = useSharedValue(40);
  const sheetOpacity = useSharedValue(0);

  useEffect(() => {
    if (!t) return;
    const e = Easing.out(Easing.cubic);
    sheetOpacity.value = withDelay(120, withTiming(1, { duration: 320, easing: e }));
    sheetY.value = withDelay(120, withTiming(0, { duration: 320, easing: e }));
  }, [t, sheetOpacity, sheetY]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: sheetOpacity.value,
    transform: [{ translateY: sheetY.value }],
  }));

  const handleShare = useCallback(async () => {
    if (!t) return;
    try {
      await Share.share({
        message: `Check out "${t.title}" on Clickfy`,
        url: `https://clickfy.ai/templates/${t.id}`,
      });
    } catch {
      // user dismissed
    }
  }, [t]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 90 + insets.bottom }}
        bounces
      >
        {/* ─── Hero ─── */}
        {t ? (
          <HeroMedia template={t} />
        ) : (
          <View style={{ width: SCREEN_WIDTH, height: heroHeight, backgroundColor: colors.surfaceMuted }} />
        )}

        {/* ─── Content sheet ─── */}
        {!t ? (
          <View style={[s.sheet, { backgroundColor: colors.surface, marginTop: -28 }]}>
            <LoadingSkeleton surfaceMuted={colors.surfaceMuted} border={colors.border} />
          </View>
        ) : (
          <Animated.View
            style={[
              s.sheet,
              { backgroundColor: colors.surface, marginTop: -28 },
              sheetStyle,
            ]}
          >
            {/* Pull indicator */}
            <View style={[s.pullBar, { backgroundColor: colors.borderStrong }]} />

            {/* Meta row — just the kind chip now. The previous
                "12.4k uses" counter and "by Author Name" line both
                added clutter without driving any user behaviour, and
                the analytics they implied are misleading early-stage. */}
            <View style={s.metaRow}>
              <KindChip kind={t.kind} />
            </View>

            {/* Title */}
            <Text style={[s.title, { color: colors.ink, fontFamily: ff.sansBold }]}>
              {t.title}
            </Text>

            {/* Description — light, only when present */}
            {t.description ? (
              <Text style={[s.descriptionLine, { color: colors.inkMuted }]}>
                {t.description}
              </Text>
            ) : null}

            {/* What you'll get — derived from the template's output
                shape. Each entry maps to one row ("4 images", "1 video"),
                which scales cleanly to mixed-media pipelines. */}
            {t.outputs && t.outputs.length > 0 ? (
              <View style={{ marginTop: 18 }}>
                <Text style={[s.sectionLabel, { color: colors.inkMuted }]}>
                  What you&apos;ll get
                </Text>
                <View style={{ gap: 10 }}>
                  {t.outputs.map((out, i) => (
                    <OutputRow key={`${out.kind}-${i}`} output={out} />
                  ))}
                </View>
              </View>
            ) : null}

            {/* Input slots — "You'll provide" */}
            {t.userInputs && t.userInputs.length > 0 ? (
              <View style={{ marginTop: 18 }}>
                <Text style={[s.sectionLabel, { color: colors.inkMuted }]}>
                  You&apos;ll provide
                </Text>
                <View style={{ gap: 10 }}>
                  {t.userInputs.map((input) => (
                    <InputRow key={input.id} input={input} />
                  ))}
                </View>
              </View>
            ) : null}
          </Animated.View>
        )}
      </ScrollView>

      {/* ─── Sticky CTA bar ─── */}
      {t ? (
        <View
          style={[
            s.ctaBar,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom > 0 ? insets.bottom : 22,
            },
          ]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.costsLabel, { color: colors.inkMuted }]}>Costs</Text>
            <Text style={[s.costsValue, { color: colors.ink, fontFamily: ff.monoSemibold }]}>
              {t.credits} credits
            </Text>
          </View>
          <Button
            variant="accent"
            size="lg"
            haptic="medium"
            onPress={() => router.push(`/use/${t.id}`)}
            leading={<Icon name="wand" size={20} color={accent.ink} weight="fill" />}
          >
            Use template
          </Button>
        </View>
      ) : null}

      {/* ─── Floating top controls ─── */}
      <View style={[s.topBar, { top: insets.top + 8 }]}>
        <GlassButton
          icon="chevronLeft"
          onPress={() => router.back()}
          accessibilityLabel="Back"
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <GlassButton
            icon="bookmark"
            iconWeight={favorited ? 'fill' : 'regular'}
            iconColor={favorited ? accent.deep : undefined}
            onPress={() => {
              if (!t) return;
              favoriteMutation.mutate(!favorited);
            }}
            accessibilityLabel={favorited ? 'Remove from saved' : 'Save to library'}
          />
          <GlassButton
            icon="share"
            onPress={handleShare}
            accessibilityLabel="Share template"
          />
        </View>
      </View>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function GlassButton({
  icon,
  iconWeight = 'regular',
  iconColor,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  iconWeight?: 'bold' | 'regular' | 'fill';
  iconColor?: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      pressedOpacity={0.8}
      style={[s.glassBtn, { backgroundColor: colors.glass }]}
    >
      <Icon name={icon} size={20} color={iconColor ?? colors.glassInk} weight={iconWeight} />
    </Pressable>
  );
}

// V1 mobile only renders legacy types — Phase 4 wires icons for the
// expanded variants (textarea, image_multi, select, etc.).
const INPUT_ICON: Partial<Record<TemplateInput['type'], IconName>> = {
  image: 'camera',
  video: 'video',
  text: 'text',
};

const INPUT_ICON_FALLBACK: IconName = 'text';

function OutputRow({ output }: { output: TemplateOutputSummary }) {
  const { colors } = useTheme();
  const isVideo = output.kind === 'video';
  const label = `${output.count} ${labelFor(output.kind, output.count)}`;
  return (
    <View style={[s.inputRow, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
      <View style={[s.inputIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Icon name={isVideo ? 'video' : 'image'} size={18} color={colors.ink} weight="fill" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.inputLabel, { color: colors.ink }]}>{label}</Text>
        <Text style={[s.inputHint, { color: colors.inkMuted }]}>
          {isVideo ? 'Animated, mp4' : 'High-resolution image'}
        </Text>
      </View>
    </View>
  );
}

function labelFor(kind: 'image' | 'video', count: number): string {
  if (kind === 'image') return count === 1 ? 'image' : 'images';
  return count === 1 ? 'video' : 'videos';
}

function InputRow({ input }: { input: TemplateInput }) {
  const { colors } = useTheme();
  return (
    <View style={[s.inputRow, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
      <View style={[s.inputIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Icon name={INPUT_ICON[input.type] ?? INPUT_ICON_FALLBACK} size={18} color={colors.ink} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.inputLabel, { color: colors.ink }]}>{input.label}</Text>
        {input.helperText ? (
          <Text style={[s.inputHint, { color: colors.inkMuted }]}>{input.helperText}</Text>
        ) : !input.required ? (
          <Text style={[s.inputHint, { color: colors.inkMuted }]}>Optional</Text>
        ) : null}
      </View>
    </View>
  );
}

function KindChip({ kind }: { kind: CatalogTemplate['kind'] }) {
  const { accent } = useTheme();
  const labels: Record<CatalogTemplate['kind'], string> = {
    image: 'IMAGE',
    video: 'VIDEO',
    set: 'SET',
  };
  const icons: Record<CatalogTemplate['kind'], IconName> = {
    image: 'image',
    video: 'play',
    set: 'imageStack',
  };
  return (
    <View style={[s.kindChip, { backgroundColor: accent.soft }]}>
      <Icon name={icons[kind]} size={12} color={accent.deep} weight="fill" />
      <Text style={[s.kindLabel, { color: accent.deep }]}>{labels[kind]}</Text>
    </View>
  );
}

function LoadingSkeleton({ surfaceMuted, border }: { surfaceMuted: string; border: string }) {
  return (
    <View style={{ paddingTop: 28, paddingHorizontal: 20, gap: 14 }}>
      <View style={[s.pullBar, { backgroundColor: border, marginBottom: 14 }]} />
      <Skeleton height={26} width={80} radius={13} />
      <Skeleton height={26} width="80%" />
      <Skeleton height={14} width="40%" />
      <View style={{ marginTop: 16, gap: 10 }}>
        <Skeleton height={12} width={100} />
        <Skeleton height={64} width="100%" radius={16} />
        <Skeleton height={64} width="100%" radius={16} />
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    minHeight: 400,
  },
  pullBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  metaText: {
    fontSize: 12.5,
  },
  kindChip: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  kindLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.6,
    lineHeight: 26 * 1.1,
  },
  descriptionLine: {
    marginTop: 8,
    fontSize: 13.5,
    lineHeight: 19,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  inputIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  inputLabel: {
    fontSize: 14.5,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  inputHint: {
    fontSize: 12.5,
    marginTop: 1,
  },
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  costsLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  costsValue: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  glassBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
