/**
 * PromptDock — the composer's input surface, pinned above the keyboard:
 *
 *   [attachment thumbnails, when any]
 *   [multiline prompt input]
 *   [+]                    [Generate · N cr ➤]
 *
 * The + opens the attachment sheet; the trailing button carries the
 * price so the header can stay reserved for the user's total balance.
 * Front-end phase: attachments are local URIs only, no uploads.
 */

import { HStack, Pressable, Text, useTheme } from '@clickfy/ui';
import { Image } from 'expo-image';
import { ActivityIndicator, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';

export interface DockAttachment {
  id: string;
  previewUri: string | number;
  /** Slot label for frames mode ("Start" / "End"); refs go unlabeled. */
  slotLabel?: string;
}

interface PromptDockProps {
  prompt: string;
  onPromptChange: (v: string) => void;
  placeholder: string;
  maxLength: number;
  attachments: DockAttachment[];
  onRemoveAttachment: (id: string) => void;
  onOpenAttach: () => void;
  canGenerate: boolean;
  generating: boolean;
  generateLabel: string;
  /** Mode color for the Generate button (green=image, purple=video). */
  tint: { solid: string; fg: string };
  onGenerate: () => void;
}

export function PromptDock({
  prompt,
  onPromptChange,
  placeholder,
  maxLength,
  attachments,
  onRemoveAttachment,
  onOpenAttach,
  canGenerate,
  generating,
  generateLabel,
  tint,
  onGenerate,
}: PromptDockProps) {
  const { colors, accent } = useTheme();

  return (
    <View
      style={{
        marginHorizontal: 16,
        borderRadius: 22,
        // Flat tonal card — the CARD tone on the page bg (surfaceMuted is
        // nearly identical to bg and reads as no card at all).
        backgroundColor: colors.surface,
        paddingHorizontal: 12,
        paddingTop: attachments.length > 0 ? 12 : 8,
        paddingBottom: 10,
        gap: 8,
      }}
    >
      {attachments.length > 0 ? (
        <HStack gap="sm" style={{ flexWrap: 'wrap' }}>
          {attachments.map((a) => (
            <View key={a.id} style={{ width: 56 }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 12,
                  overflow: 'hidden',
                  backgroundColor: colors.surfaceMuted,
                }}
              >
                <Image source={a.previewUri} contentFit="cover" style={{ width: '100%', height: '100%' }} />
                <Pressable
                  onPress={() => onRemoveAttachment(a.id)}
                  haptic="light"
                  accessibilityLabel="Remove attachment"
                  style={{
                    position: 'absolute',
                    top: 3,
                    end: 3,
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: colors.overlayStrong,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="close" size={10} color="#FFFFFF" weight="bold" />
                </Pressable>
              </View>
              {a.slotLabel ? (
                <Text variant="caption" color="inkMuted" align="center" style={{ fontSize: 10, marginTop: 2 }}>
                  {a.slotLabel}
                </Text>
              ) : null}
            </View>
          ))}
        </HStack>
      ) : null}

      <TextInput
        value={prompt}
        onChangeText={onPromptChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        maxLength={maxLength}
        multiline
        style={{
          maxHeight: 120,
          minHeight: 24,
          paddingHorizontal: 4,
          paddingTop: 4,
          color: colors.ink,
          fontSize: 16,
          fontFamily: 'Geist_500Medium',
          letterSpacing: -0.1,
        }}
        selectionColor={accent.solid}
      />

      <HStack align="center">
        <Pressable
          onPress={onOpenAttach}
          haptic="light"
          pressedOpacity={0.85}
          accessibilityLabel="Add attachment"
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="plus" size={18} color={colors.ink} weight="bold" />
        </Pressable>

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={onGenerate}
          disabled={!canGenerate || generating}
          haptic="medium"
          pressedOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel={generateLabel}
          style={{
            height: 36,
            borderRadius: 18,
            paddingHorizontal: 16,
            // Mode color, not theme accent: the button re-states which
            // mode is about to run (green=image, purple=video).
            backgroundColor: canGenerate ? tint.solid : colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 6,
            opacity: generating ? 0.7 : 1,
          }}
        >
          {generating ? (
            <ActivityIndicator size="small" color={tint.fg} />
          ) : (
            <>
              <Text weight="700" style={{ fontSize: 13.5, color: canGenerate ? tint.fg : colors.inkMuted }}>
                {generateLabel}
              </Text>
              <Icon name="arrowUp" size={15} color={canGenerate ? tint.fg : colors.inkMuted} weight="bold" />
            </>
          )}
        </Pressable>
      </HStack>
    </View>
  );
}
