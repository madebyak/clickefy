import { Box, Button, HStack, Pressable, Stack, Text, useTheme } from '@clickfy/ui';
import type { TemplateInput } from '@clickfy/types';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { getSDK } from '@/lib/sdk';

/**
 * Bundle of metadata that travels with a finished media upload. The
 * parent screen rebuilds a `JobInputValue` from this when assembling
 * the `POST /v1/jobs` body — `r2Key` is what the worker actually
 * persists in `jobs.inputs`, but the worker also wants `mimeType` +
 * `sizeBytes` so the prompt-compiler can pick the right adapter
 * sizing and so the job row carries enough context for B4 polling.
 *
 * `null` is the "field cleared" signal: parent should drop any prior
 * upload metadata for this fieldKey.
 */
export interface UploadedMedia {
  r2Key: string;
  mimeType: string;
  sizeBytes: number;
}

export interface InputFieldProps {
  input: TemplateInput;
  value: string;
  onChange: (next: string) => void;
  /**
   * Fires once a media upload finishes. The metadata is everything
   * the worker needs to accept this field as a job input.
   *
   * For text/textarea inputs this callback is never invoked.
   */
  onUploadComplete?: (media: UploadedMedia | null) => void;
}

/**
 * Renders one input from a template's `userInputs[]`.
 * The mobile app never hardcodes which fields a template needs — admin defines
 * the array, this component renders the right control per `input.type`.
 *
 * Supported types: image | video | text
 */
export function InputField({ input, value, onChange, onUploadComplete }: InputFieldProps) {
  if (input.type === 'image' || input.type === 'video') {
    return (
      <MediaInput
        input={input}
        value={value}
        onChange={onChange}
        onUploadComplete={onUploadComplete}
      />
    );
  }
  return <TextInputField input={input} value={value} onChange={onChange} />;
}

// Default mime types per input type. Templates may override via
// `acceptedFormats` but we always send something so the worker's
// allowlist doesn't reject the request on missing metadata.
const DEFAULT_IMAGE_MIME = 'image/jpeg';
const DEFAULT_VIDEO_MIME = 'video/mp4';

// Friendly extension → mime fallback for assets picked from the
// library where ImagePicker doesn't surface a `mimeType`.
function inferMimeType(uri: string, fallback: string): string {
  const lower = uri.split('?')[0]?.toLowerCase() ?? '';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  return fallback;
}

type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'done'; key: string }
  | { phase: 'error'; message: string };

// ─── Media (image / video) input ─────────────────────────────────────

function MediaInput({ input, value, onChange, onUploadComplete }: InputFieldProps) {
  const { colors, accent } = useTheme();
  const isVideo = input.type === 'video';
  const fallbackMime = isVideo ? DEFAULT_VIDEO_MIME : DEFAULT_IMAGE_MIME;

  // Upload tracking lives inside the component. Each new pick spawns
  // one upload — concurrent picks cancel the previous via this token
  // so a stale slow upload can't clobber the latest selection.
  const [uploadState, setUploadState] = useState<UploadState>({ phase: 'idle' });
  const uploadToken = useRef(0);

  // External clears (parent resetting `value` to '') are handled inline
  // by the trash button below — we intentionally do NOT mirror that in
  // a `useEffect([value, onUploadComplete])`, because `onUploadComplete`
  // is a per-render closure in most parent screens, and depending on it
  // produces an infinite render loop. Keeping the clear path imperative
  // makes the data flow easier to reason about, too.

  const clearSelection = () => {
    uploadToken.current += 1;
    setUploadState({ phase: 'idle' });
    onChange('');
    onUploadComplete?.(null);
  };

  const startUpload = async (assetUri: string, assetMime: string | undefined, assetName?: string) => {
    const myToken = ++uploadToken.current;
    setUploadState({ phase: 'uploading' });

    try {
      const sdk = getSDK();
      const result = await sdk.uploads.uploadUserAsset({
        uri: assetUri,
        name: assetName ?? assetUri.split('/').pop() ?? `upload.${isVideo ? 'mp4' : 'jpg'}`,
        type: assetMime ?? inferMimeType(assetUri, fallbackMime),
      });
      if (myToken !== uploadToken.current) return;
      setUploadState({ phase: 'done', key: result.key });
      onUploadComplete?.({
        r2Key: result.key,
        mimeType: result.contentType,
        sizeBytes: result.sizeBytes,
      });
    } catch (err) {
      if (myToken !== uploadToken.current) return;
      const message = err instanceof Error ? err.message : 'Upload failed.';
      setUploadState({ phase: 'error', message });
      onUploadComplete?.(null);
    }
  };

  const handlePickedAsset = (asset: ImagePicker.ImagePickerAsset) => {
    onChange(asset.uri);
    void startUpload(asset.uri, asset.mimeType ?? undefined, asset.fileName ?? undefined);
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: isVideo ? ['videos'] : ['images'],
      allowsEditing: false,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      handlePickedAsset(result.assets[0]);
    }
  };

  const takeNew = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: isVideo ? ['videos'] : ['images'],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      handlePickedAsset(result.assets[0]);
    }
  };

  const retryUpload = () => {
    if (!value) return;
    void startUpload(value, undefined);
  };

  return (
    <Stack gap="sm">
      <FieldLabel input={input} />

      <Pressable
        onPress={value ? () => {} : pickFromLibrary}
        haptic="light"
        pressedOpacity={0.92}
        accessibilityLabel={`${input.label} ${value ? 'preview' : 'upload'}`}
        style={{
          height: 200,
          borderRadius: 22,
          backgroundColor: colors.surfaceMuted,
          borderWidth: value ? 0 : 1.5,
          borderStyle: value ? 'solid' : 'dashed',
          borderColor: colors.borderStrong,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {value ? (
          <>
            <Image
              source={value}
              contentFit="cover"
              style={{ width: '100%', height: '100%' }}
              transition={120}
            />

            {/* Upload state overlay — fills the bottom strip and
                changes shape per phase. Tiny enough not to occlude
                the preview, opinionated enough that the user knows
                the file is in flight. */}
            {uploadState.phase === 'uploading' ? (
              <View
                style={{
                  position: 'absolute',
                  left: 10,
                  bottom: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 12,
                  backgroundColor: colors.overlayStrong,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text color="#FFFFFF" weight="600" style={{ fontSize: 12 }}>
                  Uploading…
                </Text>
              </View>
            ) : uploadState.phase === 'done' ? (
              <View
                style={{
                  position: 'absolute',
                  left: 10,
                  bottom: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 12,
                  backgroundColor: 'rgba(34,197,94,0.92)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Icon name="check" size={12} color="#FFFFFF" weight="bold" />
                <Text color="#FFFFFF" weight="600" style={{ fontSize: 12 }}>
                  Ready
                </Text>
              </View>
            ) : uploadState.phase === 'error' ? (
              <Pressable
                onPress={retryUpload}
                haptic="warning"
                accessibilityLabel="Retry upload"
                style={{
                  position: 'absolute',
                  left: 10,
                  bottom: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 12,
                  backgroundColor: 'rgba(239,68,68,0.92)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Icon name="refresh" size={12} color="#FFFFFF" weight="bold" />
                <Text color="#FFFFFF" weight="600" style={{ fontSize: 12 }}>
                  Retry upload
                </Text>
              </Pressable>
            ) : null}

            <View
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                flexDirection: 'row',
                gap: 6,
              }}
            >
              <Pressable
                onPress={clearSelection}
                haptic="warning"
                accessibilityLabel="Remove"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: colors.overlayStrong,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="trash" size={16} color="#FFFFFF" />
              </Pressable>
              <Pressable
                onPress={pickFromLibrary}
                haptic="light"
                accessibilityLabel="Replace"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: colors.overlayStrong,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="refresh" size={14} color="#FFFFFF" weight="bold" />
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                backgroundColor: colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#000',
                shadowOpacity: 0.07,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 6 },
              }}
            >
              <Icon
                name={isVideo ? 'video' : 'plus'}
                size={24}
                color={accent.solid}
                weight="bold"
              />
            </View>
            <Text variant="bodySemi" color="ink" style={{ fontSize: 15 }}>
              {isVideo ? 'Add your video' : 'Drop your photo'}
            </Text>
            {input.helperText ? (
              <Text variant="caption" color="inkMuted" align="center" style={{ paddingHorizontal: 24 }}>
                {input.helperText}
              </Text>
            ) : null}
            <HStack gap="sm" mt="sm">
              <Button
                variant="primary"
                size="sm"
                onPress={pickFromLibrary}
                leading={
                  <Icon name="imageStack" size={14} color={colors.surface} />
                }
              >
                {isVideo ? 'Choose video' : 'Choose photo'}
              </Button>
              {!isVideo && (
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={takeNew}
                  leading={
                    <Icon name="camera" size={14} color={colors.ink} weight="fill" />
                  }
                >
                  Take photo
                </Button>
              )}
            </HStack>
          </>
        )}
      </Pressable>
    </Stack>
  );
}

// ─── Text input ──────────────────────────────────────────────────────

function TextInputField({ input, value, onChange }: InputFieldProps) {
  const { colors, accent } = useTheme();
  // Only text-shaped variants reach this branch; narrow once so we can
  // read placeholder/maxLength without `in` guards everywhere.
  const textInput =
    input.type === 'text' || input.type === 'textarea' ? input : null;
  const placeholder = textInput?.placeholder;
  const maxLength = textInput?.maxLength;

  return (
    <Stack gap="sm">
      <FieldLabel input={input} />
      <View
        style={{
          minHeight: 56,
          borderRadius: 16,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.inkMuted}
          maxLength={maxLength}
          multiline={Boolean(maxLength && maxLength > 60)}
          style={{
            flex: 1,
            color: colors.ink,
            fontSize: 16,
            fontFamily: 'Geist_500Medium',
            letterSpacing: -0.1,
            paddingVertical: 0,
          }}
          selectionColor={accent.solid}
        />
        {maxLength ? (
          <Text variant="caption" color="inkSubtle">
            {value.length}/{maxLength}
          </Text>
        ) : null}
      </View>
    </Stack>
  );
}

// ─── Shared label ────────────────────────────────────────────────────

function FieldLabel({ input }: { input: TemplateInput }) {
  return (
    <HStack align="center" gap="xs">
      <Text variant="overline" color="ink" transform="uppercase" weight="700" style={{ letterSpacing: 0.5 }}>
        {input.label}
      </Text>
      {input.required ? (
        <Text variant="overline" color="danger" weight="700">
          *
        </Text>
      ) : (
        <Text variant="overline" color="inkMuted" weight="500" style={{ textTransform: 'none', letterSpacing: 0 }}>
          · optional
        </Text>
      )}
    </HStack>
  );
}
