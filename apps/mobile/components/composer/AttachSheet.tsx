/**
 * AttachSheet — the + sheet: big square actions (Camera / Photos), the
 * Kimi-style grid. Frames-mode models pass slot rows instead ("Start
 * frame" / "End frame") so the user says WHERE the picture goes before
 * picking it.
 *
 * Front-end phase: callers receive the tap and drive a local-only
 * image pick; no uploads happen here.
 */

import { HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';

import { Icon, type IconName } from '@/components/ui/Icon';
import { Sheet } from './Sheet';

export interface AttachAction {
  id: string;
  icon: IconName;
  label: string;
  /** Grayed out with no press (e.g. slots already filled). */
  disabled?: boolean;
}

export function AttachSheet({
  visible,
  title,
  actions,
  onAction,
  onDismissed,
  onClose,
}: {
  visible: boolean;
  title: string;
  actions: AttachAction[];
  /** Called with the tapped action id AFTER the sheet fully dismissed. */
  onAction: (id: string) => void;
  onDismissed?: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} onDismissed={onDismissed} title={title} maxHeight="45%">
      <HStack gap="md" style={{ paddingBottom: 8, flexWrap: 'wrap' }}>
        {actions.map((a) => (
          <Pressable
            key={a.id}
            onPress={
              a.disabled
                ? undefined
                : () => {
                    onClose();
                    onAction(a.id);
                  }
            }
            haptic="light"
            pressedOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            style={{ width: 96, opacity: a.disabled ? 0.4 : 1 }}
          >
            <Stack
              gap="sm"
              align="center"
              style={{
                paddingVertical: 20,
                borderRadius: 18,
                backgroundColor: colors.surface,
              }}
            >
              <Icon name={a.icon} size={24} color={colors.ink} />
              <Text variant="caption" color="ink" weight="600" align="center">
                {a.label}
              </Text>
            </Stack>
          </Pressable>
        ))}
      </HStack>
    </Sheet>
  );
}
