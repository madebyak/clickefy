/**
 * Icon — single icon system for the mobile app.
 *
 * Backed by Phosphor Icons (`phosphor-react-native`) — cross-platform,
 * tree-shakable, 6 weights, ~9000 glyphs, aesthetic match for Geist +
 * Instrument Serif. We do *not* use `expo-symbols` here because SF Symbols
 * are iOS-only and Android would render nothing.
 *
 * Usage:
 *   <Icon name="house" weight="fill" size={24} color={colors.ink} />
 *
 * Adding a new icon = one line in the ICONS map below. We deliberately do
 * NOT re-export every Phosphor icon — keeping the surface small forces a
 * curated icon vocabulary across screens.
 */

import type { ComponentType } from 'react';
import { View } from 'react-native';
import { useTheme } from '@clickfy/ui';
import {
  AppleLogo,
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  ArrowSquareOut,
  Bell,
  BookmarkSimple,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Camera,
  Check,
  Clock,
  Diamond,
  DotsThree,
  DownloadSimple,
  Envelope,
  EyeSlash,
  Eye,
  Flag,
  FolderSimple,
  Funnel,
  Gear,
  Gift,
  Heart,
  House,
  Info,
  Image as ImageIcon,
  Images,
  Lightning,
  List,
  LockSimple,
  MagicWand,
  MagnifyingGlass,
  Moon,
  PaperPlaneTilt,
  Pencil,
  Play,
  Plus,
  PushPinSimple,
  Question,
  SealCheck,
  ShareNetwork,
  ShoppingBag,
  SignOut,
  SlidersHorizontal,
  Sparkle,
  Square,
  SquaresFour,
  Star,
  Sun,
  TextT,
  Translate,
  Trash,
  User,
  VideoCamera,
  Warning,
  X,
  type IconProps,
  type IconWeight,
} from 'phosphor-react-native';

/**
 * Canonical icon names. Keep alphabetical to make the map easy to scan.
 * Prefer semantic names ("close", "save") over visual ones ("x", "bookmark")
 * where the icon has a clear product role — except in the few cases where
 * the visual is the meaning (e.g. "chevron-right" for "more").
 */
export type IconName =
  // Tabs / nav
  | 'home'
  | 'categories'
  | 'create'
  | 'projects'
  | 'profile'
  // Common UI
  | 'search'
  | 'filter'
  | 'sliders'
  | 'more'
  | 'menu'
  | 'close'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronUp'
  | 'chevronDown'
  | 'arrowLeft'
  | 'arrowRight'
  | 'arrowExternal'
  | 'refresh'
  // Auth / branding
  | 'apple'
  | 'envelope'
  | 'eye'
  | 'eyeOff'
  | 'lock'
  // Brand / vibes
  | 'sparkle'
  | 'wand'
  | 'star'
  | 'bolt'
  | 'gift'
  // Credits / plan identity
  | 'credit'
  | 'planVerified'
  // Content kinds
  | 'image'
  | 'imageStack'
  | 'video'
  | 'text'
  | 'set'
  // Actions
  | 'camera'
  | 'download'
  | 'share'
  | 'bookmark'
  | 'pin'
  | 'edit'
  | 'trash'
  | 'flag'
  | 'send'
  | 'play'
  // Status
  | 'info'
  | 'warning'
  | 'help'
  | 'clock'
  | 'heart'
  // Settings
  | 'bell'
  | 'gear'
  | 'sun'
  | 'moon'
  | 'language'
  | 'signOut'
  | 'shop'
  | 'plus';

type PhosphorIcon = ComponentType<IconProps>;

/**
 * Directional icons that must visually flip under RTL so they keep pointing
 * the right way (e.g. a "back" chevron points toward the leading edge, a
 * disclosure chevron toward the trailing edge). Non-directional glyphs are
 * left untouched. We mirror based on the theme's `isRTL` (derived from the
 * active locale) — NOT `I18nManager.isRTL`, which is unreliable on the New
 * Architecture (it can report `false` even when RTL is active).
 */
const MIRRORED_ICONS: Partial<Record<IconName, true>> = {
  chevronLeft: true,
  chevronRight: true,
  arrowLeft: true,
  arrowRight: true,
  send: true,
};

const ICONS: Record<IconName, PhosphorIcon> = {
  home: House,
  categories: SquaresFour,
  create: Sparkle,
  projects: FolderSimple,
  profile: User,
  search: MagnifyingGlass,
  filter: Funnel,
  sliders: SlidersHorizontal,
  more: DotsThree,
  menu: List,
  close: X,
  check: Check,
  chevronLeft: CaretLeft,
  chevronRight: CaretRight,
  chevronUp: CaretUp,
  chevronDown: CaretDown,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  arrowExternal: ArrowSquareOut,
  refresh: ArrowsClockwise,
  apple: AppleLogo,
  envelope: Envelope,
  eye: Eye,
  eyeOff: EyeSlash,
  lock: LockSimple,
  sparkle: Sparkle,
  wand: MagicWand,
  star: Star,
  bolt: Lightning,
  gift: Gift,
  credit: Diamond,
  planVerified: SealCheck,
  image: ImageIcon,
  imageStack: Images,
  video: VideoCamera,
  text: TextT,
  set: Square,
  camera: Camera,
  download: DownloadSimple,
  share: ShareNetwork,
  bookmark: BookmarkSimple,
  pin: PushPinSimple,
  edit: Pencil,
  trash: Trash,
  flag: Flag,
  send: PaperPlaneTilt,
  play: Play,
  info: Info,
  warning: Warning,
  help: Question,
  clock: Clock,
  heart: Heart,
  bell: Bell,
  gear: Gear,
  sun: Sun,
  moon: Moon,
  language: Translate,
  signOut: SignOut,
  shop: ShoppingBag,
  plus: Plus,
};

export interface IconComponentProps {
  name: IconName;
  /** Phosphor weight. 'regular' is the default; use 'fill' for selected/active, 'duotone' for two-tone. */
  weight?: IconWeight;
  /** Pixel size — width and height. Default 22 to match iOS body symbol metric. */
  size?: number;
  /** Tint color. Default inherits from the consumer (theme typically). */
  color?: string;
  /**
   * Secondary tone color when `weight === 'duotone'`. Defaults to `color`
   * with `duotoneOpacity` applied. Pass an explicit color to break that
   * relationship (e.g. accent-coloured ink + soft accent fill).
   */
  duotoneColor?: string;
  /** Opacity of the secondary tone (0–1). Default 0.25 — Phosphor's stock value. */
  duotoneOpacity?: number;
  /** Pass-through for accessibility */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Renders a Phosphor icon by canonical name.
 *
 * Note: keep this component zero-state. If you need a clickable icon, wrap
 * it in `<Pressable>` from `@clickfy/ui` so haptics + tap target are handled.
 */
export function Icon({
  name,
  weight = 'regular',
  size = 22,
  color,
  duotoneColor,
  duotoneOpacity,
  accessibilityLabel,
  testID,
}: IconComponentProps) {
  const { isRTL } = useTheme();
  const Glyph = ICONS[name];
  if (!Glyph) {
    if (__DEV__) {
      console.warn(`[Icon] Unknown name: "${name}". Add it to the ICONS map.`);
    }
    return null;
  }
  const glyph = (
    <Glyph
      weight={weight}
      size={size}
      color={color}
      {...(weight === 'duotone'
        ? {
            duotoneColor: duotoneColor ?? color,
            duotoneOpacity: duotoneOpacity ?? 0.25,
          }
        : {})}
      // Phosphor doesn't accept testID/aria directly, but RN passes through
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      {...(testID ? { testID } : {})}
    />
  );

  // Mirror directional glyphs under RTL so arrows/chevrons keep their meaning.
  if (isRTL && MIRRORED_ICONS[name]) {
    return <View style={{ transform: [{ scaleX: -1 }] }}>{glyph}</View>;
  }
  return glyph;
}

// Re-export the weight type so consumers don't need to import phosphor directly.
export type { IconWeight };
