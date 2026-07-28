/**
 * Brand logo for a model, keyed by its provider. Renders the inline SVG
 * via `react-native-svg`. Falls back to a modality glyph (image/video)
 * for any provider without a brand asset.
 */

import { useTheme } from '@clickfy/ui';
import { SvgXml } from 'react-native-svg';

import { Icon } from '@/components/ui/Icon';
import { MODEL_LOGO_BY_PROVIDER } from './model-logos';

interface ModelLogoProps {
  provider: string;
  kind: 'image' | 'video';
  size?: number;
  /** Tint for the fallback glyph (unused when a brand logo exists). */
  fallbackColor?: string;
}

export function ModelLogo({ provider, kind, size = 24, fallbackColor }: ModelLogoProps) {
  const { accent } = useTheme();
  const xml = MODEL_LOGO_BY_PROVIDER[provider];
  if (xml) {
    return <SvgXml xml={xml} width={size} height={size} />;
  }
  return (
    <Icon
      name={kind === 'video' ? 'video' : 'image'}
      size={Math.round(size * 0.72)}
      color={fallbackColor ?? accent.solid}
      weight="fill"
    />
  );
}
