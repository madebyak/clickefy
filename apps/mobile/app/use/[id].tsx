import {
  Button,
  Chip,
  HStack,
  Skeleton,
  Stack,
  Text,
  useTheme,
} from '@clickfy/ui';
import { JobSubmissionError, type JobInputValue } from '@clickfy/sdk';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { Icon } from '@/components/ui/Icon';
import { InputField, type UploadedMedia } from '@/components/use-template/InputField';
import { TEMPLATE_QUERY } from '@/lib/query-config';
import { getSDK } from '@/lib/sdk';

const ASPECT_OPTIONS = ['1:1', '4:5', '16:9', '9:16'];

/**
 * Fresh idempotency key per submit. The worker's contract just wants
 * "the same key returns the same job"; collisions across submissions
 * would only mean a retry surfaces a different jobId (not a credit
 * leak), and `Math.random()` over 32 hex chars makes collisions
 * astronomically rare for a single device's submission history.
 *
 * Avoids pulling `uuid` + `react-native-get-random-values` into the
 * mobile bundle just for a non-cryptographic uniqueness token.
 */
function idempotencyKey(): string {
  const hex = (n: number) =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}

export default function UseTemplateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const sdk = getSDK();

  const templateQuery = useQuery({
    queryKey: ['template', id],
    queryFn: () => sdk.catalog.getTemplate(id!),
    enabled: !!id,
    ...TEMPLATE_QUERY,
  });
  const t = templateQuery.data;

  // Form state — keyed by input.fieldKey. Image/video values are
  // local URIs (used for preview); the upload-completed metadata
  // (r2Key + mime + size) lives in a parallel map so the form can
  // submit a canonical `JobInputValue` to the worker.
  const [values, setValues] = useState<Record<string, string>>({});
  const [mediaMeta, setMediaMeta] = useState<Record<string, UploadedMedia | null>>({});
  const [aspect, setAspect] = useState('4:5');
  const [submitting, setSubmitting] = useState(false);

  const setField = (key: string, val: string) =>
    setValues((prev) => ({ ...prev, [key]: val }));

  // `InputField` only invokes this callback imperatively (on press
  // handlers and after an upload resolves), so a fresh function
  // identity per render is fine — there's no effect dep watching it.
  const setMediaForKey = (fieldKey: string) => (media: UploadedMedia | null) => {
    setMediaMeta((prev) => ({ ...prev, [fieldKey]: media }));
  };

  const totalCredits = t?.credits ?? 0;

  /**
   * True when every required input is "ready":
   *   - text/textarea: non-empty value
   *   - image/video:   non-empty value AND upload completed (metadata set)
   *
   * Gating the Generate button while uploads are in flight matches
   * what the worker enforces — submitting an r2Key that hasn't landed
   * in R2 yet would 422 with `r2_key_not_found`.
   */
  const canGenerate = useMemo(() => {
    if (!t || !t.userInputs) return false;
    return t.userInputs.filter((i) => i.required).every((i) => {
      const v = (values[i.fieldKey] ?? '').trim();
      if (v.length === 0) return false;
      if (i.type === 'image' || i.type === 'video') {
        return Boolean(mediaMeta[i.fieldKey]);
      }
      return true;
    });
  }, [t, values, mediaMeta]);

  const onGenerate = async () => {
    if (!t || !canGenerate) return;
    setSubmitting(true);
    try {
      // Build the typed `inputs` payload the worker expects. Text
      // inputs flow through verbatim; image/video inputs reach for
      // the metadata captured at upload time. Optional fields with
      // no value are simply omitted from the map.
      const inputs: Record<string, JobInputValue> = {};
      for (const def of t.userInputs ?? []) {
        const raw = values[def.fieldKey] ?? '';
        if (def.type === 'image' || def.type === 'video') {
          const meta = mediaMeta[def.fieldKey];
          if (meta) {
            inputs[def.fieldKey] = {
              kind: def.type === 'video' ? 'video' : 'image',
              r2Key: meta.r2Key,
              mimeType: meta.mimeType,
              sizeBytes: meta.sizeBytes,
            };
          }
        } else if (raw.trim().length > 0) {
          inputs[def.fieldKey] = { kind: 'text', value: raw };
        }
      }

      const result = await sdk.generation.submit({
        templateId: t.id,
        inputs,
        options: t.userCanChooseAspectRatio ? { aspectRatio: aspect } : undefined,
        idempotencyKey: idempotencyKey(),
      });

      router.replace({
        pathname: '/generating',
        params: { jobId: result.jobId, templateId: t.id },
      });
    } catch (err) {
      // Render specific copy per structured error code; fall back to
      // the raw message for anything we don't recognize so the user
      // at least sees something actionable rather than silence.
      const isJobErr = err instanceof JobSubmissionError;
      const title =
        isJobErr && err.code === 'insufficient_credits'
          ? 'Not enough credits'
          : isJobErr && err.code === 'r2_key_not_found'
            ? 'Upload not found'
            : 'Could not start generation';
      const message =
        err instanceof Error ? err.message : 'Something went wrong — try again.';
      Alert.alert(title, message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        variant="close"
        eyebrow="Step 1 of 1"
        title="Use template"
        rightIcon="help"
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: 180 }}
      >
        {!t ? (
          <FormSkeleton />
        ) : (
          <Stack gap="xl">
            {/* Template thumb header */}
            <HStack gap="md" align="center">
              <View
                style={{
                  width: 64,
                  height: 80,
                  borderRadius: 14,
                  overflow: 'hidden',
                  backgroundColor: colors.surfaceMuted,
                }}
              >
                <Image
                  source={t.coverImage}
                  contentFit="cover"
                  style={{ width: '100%', height: '100%' }}
                />
              </View>
              <Stack gap="xs" style={{ flex: 1 }}>
                <Text variant="subhead" color="ink" weight="700" numberOfLines={1}>
                  {t.title}
                </Text>
                <View
                  style={{
                    alignSelf: 'flex-start',
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 12,
                    backgroundColor: accent.soft,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 4,
                  }}
                >
                  <View
                    style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent.solid }}
                  />
                  <Text color={accent.deep} weight="700" style={{ fontSize: 12 }}>
                    {t.credits} credits
                  </Text>
                </View>
              </Stack>
            </HStack>

            {/* Dynamic inputs — one per template.userInputs entry */}
            {(t.userInputs ?? []).map((input) => (
              <InputField
                key={input.id}
                input={input}
                value={values[input.fieldKey] ?? ''}
                onChange={(val) => setField(input.fieldKey, val)}
                onUploadComplete={setMediaForKey(input.fieldKey)}
              />
            ))}

            {/* Aspect ratio (when template allows) */}
            {t.userCanChooseAspectRatio ? (
              <Stack gap="sm">
                <Text variant="overline" color="ink" transform="uppercase" weight="700">
                  Aspect ratio
                </Text>
                <HStack gap="sm" wrap="wrap">
                  {ASPECT_OPTIONS.map((a) => (
                    <Chip key={a} label={a} active={aspect === a} onPress={() => setAspect(a)} />
                  ))}
                </HStack>
              </Stack>
            ) : null}
          </Stack>
        )}
      </ScrollView>

      {/* Sticky generate */}
      {t ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: insets.bottom + 16,
            backgroundColor: colors.bg,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Button
            variant="accent"
            size="lg"
            full
            disabled={!canGenerate}
            loading={submitting}
            haptic="medium"
            onPress={onGenerate}
            leading={
              <Icon name="wand" size={18} color={accent.ink} weight="fill" />
            }
          >
            {canGenerate ? `Generate · ${totalCredits} credits` : 'Add required inputs'}
          </Button>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function FormSkeleton() {
  return (
    <Stack gap="lg">
      <Skeleton height={80} radius={14} />
      <Skeleton height={20} width={100} />
      <Skeleton height={200} radius={22} />
      <Skeleton height={20} width={100} />
      <Skeleton height={56} radius={16} />
      <Skeleton height={20} width={140} />
      <Skeleton height={56} radius={16} />
    </Stack>
  );
}
