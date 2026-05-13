import type { CatalogTemplate } from '@clickfy/sdk';
import { Box, Pressable, Text, useTheme } from '@clickfy/ui';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { resolveLocalVideo } from '@/lib/local-videos';
import { VideoPreview } from '@/components/home/VideoPreview';

export interface TemplateCardProps {
  template: CatalogTemplate;
  onPress?: () => void;
  /**
   * Override aspect ratio. Pass this only when a layout explicitly
   * needs a non-default shape (e.g. Bento hero uses `16/10`).
   * Otherwise the card forces a uniform `4/5` crop regardless of the
   * template's own `aspect` — so cards stay aligned in rails even
   * when admins upload thumbnails of varying ratios.
   */
  aspect?: string;
  /** Hide title + meta — image-only mode */
  hideMeta?: boolean;
}

const KIND_ICON: Record<CatalogTemplate['kind'], IconName> = {
  image: 'image',
  video: 'play',
  set: 'imageStack',
};

/** Default card crop. Tall poster shape that reads well on phone widths. */
const DEFAULT_ASPECT = '4/5';

function parseAspect(aspect: string): number {
  const [w, h] = aspect.split('/').map(Number);
  if (!w || !h) return 1;
  return w / h;
}

/**
 * Template card — cover image with kind chip, credit badge, headline.
 * The single most-used surface in the app.
 */
export function TemplateCard({ template, onPress, aspect, hideMeta }: TemplateCardProps) {
  const { colors, accent } = useTheme();
  const router = useRouter();
  // Aspect priority: explicit prop override > uniform default.
  // We deliberately ignore `template.aspect` so the rail keeps a
  // consistent visual rhythm no matter what shape the admin uploads.
  const ratio = useMemo(() => parseAspect(aspect ?? DEFAULT_ASPECT), [aspect]);
  const handlePress = onPress ?? (() => router.push(`/template/${template.id}`));

  // Resolve once per card-mount. `previewVideo` may be a local key
  // (`local:spin`) or a remote URL; if it isn't recognised we fall
  // back to the static cover image render path below.
  const videoSource = useMemo(
    () => resolveLocalVideo(template.previewVideo),
    [template.previewVideo],
  );

  return (
    <Pressable
      onPress={handlePress}
      haptic="light"
      pressedOpacity={0.92}
      accessibilityLabel={template.title}
      style={{ gap: 10 }}
    >
      <View
        style={{
          width: '100%',
          aspectRatio: ratio,
          borderRadius: 18,
          overflow: 'hidden',
          backgroundColor: colors.surfaceMuted,
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        {videoSource ? (
          <VideoPreview
            source={videoSource}
            posterUri={template.coverImage}
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <Image
            source={template.coverImage}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={180}
          />
        )}

        {/* Kind chip — top left */}
        <View
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            height: 26,
            paddingLeft: 8,
            paddingRight: 10,
            borderRadius: 13,
            backgroundColor: colors.overlayStrong,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Icon
            name={KIND_ICON[template.kind]}
            size={11}
            color="#FFFFFF"
            weight="fill"
          />
          <Text
            color="#FFFFFF"
            weight="600"
            transform="uppercase"
            style={{ fontSize: 11, letterSpacing: 0.2, lineHeight: 13 }}
          >
            {template.kind}
          </Text>
        </View>

        {/* Credit chip — bottom right */}
        <View
          style={{
            position: 'absolute',
            bottom: 10,
            right: 10,
            height: 26,
            paddingHorizontal: 9,
            borderRadius: 13,
            backgroundColor: accent.solid,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: accent.ink,
              opacity: 0.9,
            }}
          />
          <Text variant="mono" color={accent.ink} weight="700" style={{ fontSize: 11.5 }}>
            {template.credits}
          </Text>
        </View>
      </View>

      {!hideMeta && (
        <Box px={2}>
          <Text
            variant="subhead"
            color="ink"
            weight="600"
            numberOfLines={1}
            style={{ fontSize: 14.5, letterSpacing: -0.2, lineHeight: 18 }}
          >
            {template.title}
          </Text>
        </Box>
      )}
    </Pressable>
  );
}
