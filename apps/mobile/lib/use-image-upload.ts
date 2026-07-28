/**
 * `useImageUpload` — Apple-recommended image intake for the create flow.
 *
 * Presents the standard iOS action sheet ("Take Photo" / "Choose from
 * Library"), then:
 *   - Camera  → `launchCameraAsync` (UIImagePickerController — PHPicker
 *               cannot capture), returns a single photo.
 *   - Library → `launchImageLibraryAsync` with `allowsMultipleSelection`
 *               (PHPickerViewController on iOS 14+) — privacy-first, no
 *               full-library permission prompt, and supports bulk select
 *               capped by `selectionLimit`.
 *
 * Each picked asset is compressed (HEIC → JPEG + size cap) and uploaded to
 * R2. Returns the persisted metadata for every successful upload.
 */

import * as ImagePicker from 'expo-image-picker';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import type { UploadedMedia } from '@/components/use-template/InputField';
import { compressImage } from '@/lib/compress-image';
import { getSDK } from '@/lib/sdk';

export interface PickedUpload {
  /** Local URI for the preview thumbnail. */
  previewUri: string;
  /** Persisted R2 metadata to submit as a `JobInputValue`. */
  media: UploadedMedia;
}

const DEFAULT_IMAGE_MIME = 'image/jpeg';

function inferMimeType(uri: string, fallback: string): string {
  const lower = uri.split('?')[0]?.toLowerCase() ?? '';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  return fallback;
}

/** Compress + upload a single picked asset. Returns null on failure. */
async function uploadAsset(asset: ImagePicker.ImagePickerAsset): Promise<PickedUpload | null> {
  try {
    let uploadUri = asset.uri;
    let mime = asset.mimeType ?? undefined;
    let sizeBytes = asset.fileSize ?? undefined;

    try {
      const compressed = await compressImage(asset.uri, asset.width ?? 0, asset.height ?? 0);
      uploadUri = compressed.uri;
      mime = compressed.mimeType;
      sizeBytes = compressed.sizeBytes > 0 ? compressed.sizeBytes : undefined;
    } catch {
      const rawMime = (asset.mimeType ?? '').toLowerCase();
      const safe = rawMime === 'image/jpeg' || rawMime === 'image/png' || rawMime === 'image/webp';
      if (!safe) return null;
    }

    const sdk = getSDK();
    const up = await sdk.uploads.uploadUserAsset({
      uri: uploadUri,
      name: asset.fileName ?? uploadUri.split('/').pop() ?? 'upload.jpg',
      type: mime ?? inferMimeType(uploadUri, DEFAULT_IMAGE_MIME),
      sizeBytes,
    });
    return {
      previewUri: asset.uri,
      media: { r2Key: up.key, mimeType: up.contentType, sizeBytes: up.sizeBytes },
    };
  } catch {
    return null;
  }
}

type Source = 'camera' | 'library';

export interface PickImagesOptions {
  /** Allow selecting more than one from the library. */
  multiple?: boolean;
  /** Cap on library multi-select (remaining slots). 0/undefined = no cap. */
  limit?: number;
}

export function useImageUpload() {
  const { t } = useTranslation('create');

  /** Standard iOS "Take Photo / Choose from Library" action sheet. */
  const chooseSource = useCallback(
    (multiple: boolean): Promise<Source | null> =>
      new Promise((resolve) => {
        const camera = t('imageSource.camera');
        const library = multiple ? t('imageSource.libraryMultiple') : t('imageSource.library');
        const cancel = t('imageSource.cancel');
        if (Platform.OS === 'ios') {
          ActionSheetIOS.showActionSheetWithOptions(
            { options: [camera, library, cancel], cancelButtonIndex: 2 },
            (i) => resolve(i === 0 ? 'camera' : i === 1 ? 'library' : null),
          );
        } else {
          Alert.alert(
            t('imageSource.title'),
            undefined,
            [
              { text: camera, onPress: () => resolve('camera') },
              { text: library, onPress: () => resolve('library') },
              { text: cancel, style: 'cancel', onPress: () => resolve(null) },
            ],
            { cancelable: true, onDismiss: () => resolve(null) },
          );
        }
      }),
    [t],
  );

  const pickImages = useCallback(
    async ({ multiple = false, limit }: PickImagesOptions = {}): Promise<PickedUpload[]> => {
      const source = await chooseSource(multiple);
      if (!source) return [];

      let assets: ImagePicker.ImagePickerAsset[] = [];
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return [];
        const res = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.9,
          exif: false,
        });
        if (res.canceled) return [];
        assets = res.assets;
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return [];
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: multiple,
          // iOS PHPicker: 0 = unlimited; pass the remaining slot count.
          selectionLimit: multiple ? Math.max(0, limit ?? 0) : 1,
          quality: 0.9,
          exif: false,
        });
        if (res.canceled) return [];
        assets = res.assets;
      }

      if (assets.length === 0) return [];
      // Compress + upload every asset in parallel; keep the successes.
      const results = await Promise.all(assets.map(uploadAsset));
      const ok = results.filter((r): r is PickedUpload => r !== null);
      if (ok.length === 0 && assets.length > 0) {
        Alert.alert(t('errors.genericTitle'), t('errors.genericMessage'));
      }
      return ok;
    },
    [chooseSource, t],
  );

  return { pickImages };
}
