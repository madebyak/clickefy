/**
 * Create tab — prompt-first "create from scratch" generation.
 *
 * The user picks a model, writes their own prompt, optionally attaches
 * images (reference grid / start-end frame / Seedance mode toggle),
 * picks aspect ratio + duration, and generates. The whole screen is
 * model-adaptive: every control reconfigures from the selected model's
 * capabilities (`GET /v1/models`). Results land in Projects tagged
 * "Custom" (source='user').
 */

import { Button, Chip, HStack, Pressable, Stack, Switch, Text, useTheme } from '@clickfy/ui';
import { useUser } from '@clerk/expo';
import { JobSubmissionError, type CreateGenerationInput, type GenModel } from '@clickfy/sdk';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiConsentSheet } from '@/components/AiConsentSheet';
import { AspectRatioPicker } from '@/components/create/AspectRatioPicker';
import { ModelLogo } from '@/components/create/ModelLogo';
import { ModelPickerSheet } from '@/components/create/ModelPickerSheet';
import { Icon } from '@/components/ui/Icon';
import { hasAiConsent, setAiConsent } from '@/lib/ai-consent';
import { getSDK } from '@/lib/sdk';
import { useSession } from '@/lib/use-session';
import { useImageUpload, type PickedUpload } from '@/lib/use-image-upload';

function idempotencyKey(): string {
  const hex = (n: number) =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}

type Slot = 'start' | 'end' | `ref-${number}`;

export default function CreateScreen() {
  // One idempotency key per submission attempt-sequence (see submit below).
  const submitKeyRef = useRef(idempotencyKey());
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('create');
  const sdk = getSDK();
  const { user: clerkUser } = useUser();
  const consentUserId = clerkUser?.id ?? '';
  const { pickImages } = useImageUpload();
  const { plan } = useSession();

  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: () => sdk.models.listModels(),
    staleTime: 5 * 60_000,
  });
  const models = modelsQuery.data ?? [];

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [sound, setSound] = useState(false);
  const [quality, setQuality] = useState<'std' | 'pro' | '4k' | undefined>(undefined);
  const [seedanceMode, setSeedanceMode] = useState<'frames' | 'references'>('frames');
  const [startFrame, setStartFrame] = useState<PickedUpload | null>(null);
  const [endFrame, setEndFrame] = useState<PickedUpload | null>(null);
  const [references, setReferences] = useState<PickedUpload[]>([]);
  const [uploadingSlot, setUploadingSlot] = useState<Slot | null>(null);

  const [modelSheet, setModelSheet] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedModel = useMemo<GenModel | undefined>(
    () => models.find((m) => m.modelKey === selectedKey),
    [models, selectedKey],
  );

  // Default to the first model once the roster loads.
  useEffect(() => {
    if (!selectedKey && models.length > 0) setSelectedKey(models[0]!.modelKey);
  }, [models, selectedKey]);

  // Reset all model-dependent controls when the model changes.
  useEffect(() => {
    if (!selectedModel) return;
    setAspect(selectedModel.aspectRatios[0]);
    setDuration(selectedModel.durations[0]);
    setQuality(selectedModel.defaultTier);
    setSound(false);
    setSeedanceMode('frames');
    setStartFrame(null);
    setEndFrame(null);
    setReferences([]);
  }, [selectedModel]);

  // Which attachment surface is active for this model + mode.
  const useReferences =
    selectedModel?.attachments === 'references' ||
    (selectedModel?.attachments === 'seedance' && seedanceMode === 'references');
  const useFrames =
    selectedModel?.attachments === 'frames' ||
    (selectedModel?.attachments === 'seedance' && seedanceMode === 'frames');

  const busy = uploadingSlot !== null;

  // Single-slot pick (start / end frame): action sheet → one image.
  const pickSingle = async (slot: Slot, apply: (p: PickedUpload) => void) => {
    if (busy) return;
    setUploadingSlot(slot);
    const res = await pickImages({ multiple: false });
    setUploadingSlot(null);
    if (res[0]) apply(res[0]);
  };

  // References: multi-select (bulk), capped at the model's remaining slots.
  const addReferences = async () => {
    if (busy || !selectedModel) return;
    const remaining = selectedModel.maxImages - references.length;
    if (remaining <= 0) return;
    setUploadingSlot(`ref-${references.length}`);
    const res = await pickImages({ multiple: true, limit: remaining });
    setUploadingSlot(null);
    if (res.length > 0) {
      setReferences((prev) => [...prev, ...res].slice(0, selectedModel.maxImages));
    }
  };

  const canGenerate = useMemo(() => {
    if (!selectedModel || submitting || busy) return false;
    if (prompt.trim().length === 0) return false;
    if (selectedModel.requiresStartFrame && !startFrame) return false;
    return true;
  }, [selectedModel, submitting, busy, prompt, startFrame]);

  // Cost follows the selected quality tier when the model has tiers
  // (e.g. Kling 720p/1080p/4K are priced differently).
  const selectedTier = selectedModel?.tiers?.find((t) => t.mode === quality);
  const cost = selectedTier?.costCredits ?? selectedModel?.costCredits ?? 0;
  const promptCap = selectedModel?.maxPromptChars ?? 2500;

  const runGeneration = async () => {
    if (!selectedModel || !canGenerate) return;
    setSubmitting(true);
    try {
      const asImage = (p: PickedUpload | null) =>
        p ? ({ kind: 'image' as const, ...p.media }) : undefined;

      const input: CreateGenerationInput = {
        modelKey: selectedModel.modelKey,
        prompt: prompt.trim(),
        aspectRatio: selectedModel.aspectRatios.length > 0 ? aspect : undefined,
        duration: selectedModel.kind === 'video' ? duration : undefined,
        sound: selectedModel.supportsSound && sound ? true : undefined,
        quality: selectedModel.tiers ? quality : undefined,
        startFrame: useFrames ? asImage(startFrame) : undefined,
        endFrame: useFrames && selectedModel.supportsEndFrame ? asImage(endFrame) : undefined,
        references: useReferences
          ? references.map((r) => ({ kind: 'image' as const, ...r.media }))
          : [],
        // Stable per-attempt key: a retry after a timeout/double-tap
        // re-sends the SAME key so the server dedupes instead of
        // charging twice. Rotated only after a confirmed success.
        idempotencyKey: submitKeyRef.current,
      };

      const result = await sdk.generation.createGenerate(input);
      submitKeyRef.current = idempotencyKey();
      // PUSH (not replace) so the Create tab stays in the stack underneath:
      // that's what lets the result screen's back button return here (and
      // keeps the user's prompt/model filled in for a quick re-generate).
      router.push({ pathname: '/generating', params: { jobId: result.jobId } });
    } catch (err) {
      const isJobErr = err instanceof JobSubmissionError;
      const title =
        isJobErr && err.code === 'insufficient_credits'
          ? t('errors.insufficientTitle')
          : t('errors.genericTitle');
      const message =
        isJobErr && err.code === 'insufficient_credits'
          ? t('errors.insufficientMessage')
          : err instanceof Error
            ? err.message
            : t('errors.genericMessage');
      Alert.alert(title, message);
    } finally {
      setSubmitting(false);
    }
  };

  const onGeneratePress = async () => {
    if (!canGenerate) return;
    if (await hasAiConsent(consentUserId)) void runGeneration();
    else setShowConsent(true);
  };

  const onConsentAgree = async () => {
    setShowConsent(false);
    await setAiConsent(consentUserId);
    void runGeneration();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <HStack align="center" style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
        <Stack gap="xs" style={{ flex: 1 }}>
          <Text variant="overline" color="inkMuted" transform="uppercase">
            {t('eyebrow')}
          </Text>
          <Text variant="title" color="ink">
            {t('title')}
          </Text>
        </Stack>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 14,
            backgroundColor: accent.soft,
          }}
        >
          <Icon name="credit" size={13} color={accent.solid} weight="fill" />
          <Text color={accent.deep} weight="700" style={{ fontSize: 13 }}>
            {(plan?.credits ?? 0).toLocaleString()}
          </Text>
        </View>
      </HStack>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: 24, gap: 24 }}
        style={{ flex: 1 }}
      >
        {modelsQuery.isLoading ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={accent.solid} />
          </View>
        ) : models.length === 0 ? (
          <View
            style={{
              padding: 18,
              borderRadius: 16,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text variant="body" color="inkMuted" align="center">
              {t('model.unavailable')}
            </Text>
          </View>
        ) : (
          <>
            {/* Model dropdown */}
            <Section label={t('model.label')}>
              <Pressable
                onPress={() => setModelSheet(true)}
                haptic="light"
                pressedOpacity={0.92}
              >
                <HStack
                  align="center"
                  gap="md"
                  style={{
                    padding: 14,
                    borderRadius: 16,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 11,
                      backgroundColor: colors.surfaceMuted,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {selectedModel ? (
                      <ModelLogo
                        provider={selectedModel.provider}
                        kind={selectedModel.kind}
                        size={24}
                        fallbackColor={accent.solid}
                      />
                    ) : (
                      <Icon name="sparkle" size={18} color={accent.solid} weight="fill" />
                    )}
                  </View>
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <Text variant="bodySemi" color="ink">
                      {selectedModel?.name ?? t('model.choose')}
                    </Text>
                    {selectedModel ? (
                      <Text variant="caption" color="inkMuted">
                        {selectedModel.kind === 'video' ? t('model.video') : t('model.image')} ·{' '}
                        {t('model.creditsEach', { count: selectedModel.costCredits })}
                      </Text>
                    ) : null}
                  </Stack>
                  <Icon name="chevronDown" size={18} color={colors.inkMuted} />
                </HStack>
              </Pressable>
            </Section>

            {/* Prompt */}
            <Section label={t('prompt.label')}>
              <View
                style={{
                  minHeight: 120,
                  borderRadius: 16,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: 14,
                }}
              >
                <TextInput
                  value={prompt}
                  onChangeText={setPrompt}
                  placeholder={t('prompt.placeholder')}
                  placeholderTextColor={colors.inkMuted}
                  maxLength={promptCap}
                  multiline
                  textAlignVertical="top"
                  style={{
                    flex: 1,
                    minHeight: 92,
                    color: colors.ink,
                    fontSize: 16,
                    fontFamily: 'Geist_500Medium',
                    letterSpacing: -0.1,
                  }}
                  selectionColor={accent.solid}
                />
                <Text variant="caption" color="inkSubtle" align="right">
                  {prompt.length}/{promptCap}
                </Text>
              </View>
            </Section>

            {/* Attachments (model-adaptive) */}
            {selectedModel ? (
              <AttachmentsSection
                model={selectedModel}
                seedanceMode={seedanceMode}
                onSeedanceMode={setSeedanceMode}
                useReferences={useReferences}
                useFrames={useFrames}
                startFrame={startFrame}
                endFrame={endFrame}
                references={references}
                uploadingSlot={uploadingSlot}
                onPickStart={() => pickSingle('start', setStartFrame)}
                onClearStart={() => setStartFrame(null)}
                onPickEnd={() => pickSingle('end', setEndFrame)}
                onClearEnd={() => setEndFrame(null)}
                onAddReference={addReferences}
                onRemoveReference={(i) =>
                  setReferences((prev) => prev.filter((_, idx) => idx !== i))
                }
              />
            ) : null}

            {/* Aspect ratio (dropdown with proportional glyphs) */}
            {selectedModel && selectedModel.aspectRatios.length > 0 ? (
              <Section label={t('aspect.label')}>
                <AspectRatioPicker
                  ratios={selectedModel.aspectRatios}
                  value={aspect}
                  onChange={setAspect}
                />
              </Section>
            ) : null}

            {/* Duration (video) */}
            {/* Quality tier — per-tier pricing (e.g. Kling 720p/1080p/4K). */}
            {selectedModel?.tiers && selectedModel.tiers.length > 0 ? (
              <Section label={t('quality.label')}>
                <HStack gap="sm" wrap="wrap">
                  {selectedModel.tiers.map((tier) => (
                    <Chip
                      key={tier.mode}
                      label={t('quality.tier', {
                        label: tier.label,
                        count: tier.costCredits,
                      })}
                      active={quality === tier.mode}
                      onPress={() => setQuality(tier.mode)}
                    />
                  ))}
                </HStack>
              </Section>
            ) : null}

            {selectedModel && selectedModel.durations.length > 0 ? (
              <Section label={t('duration.label')}>
                <HStack gap="sm" wrap="wrap">
                  {selectedModel.durations.map((d) => (
                    <Chip
                      key={d}
                      label={t('duration.seconds', { count: d })}
                      active={duration === d}
                      onPress={() => setDuration(d)}
                    />
                  ))}
                </HStack>
              </Section>
            ) : null}

            {/* Native audio — only sound-capable models (Kling 3 Omni). */}
            {selectedModel?.supportsSound ? (
              <Section label={t('sound.label')}>
                <HStack
                  align="center"
                  gap="md"
                  style={{
                    padding: 14,
                    borderRadius: 16,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <Text variant="bodySemi" color="ink">
                      {t('sound.title')}
                    </Text>
                    <Text variant="caption" color="inkMuted">
                      {t('sound.subtitle')}
                    </Text>
                  </Stack>
                  <Switch value={sound} onValueChange={setSound} />
                </HStack>
              </Section>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Sticky generate */}
      {selectedModel ? (
        <View
          style={{
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
            onPress={onGeneratePress}
            leading={<Icon name="wand" size={18} color={accent.ink} weight="fill" />}
          >
            {prompt.trim().length === 0
              ? t('needPrompt')
              : selectedModel.requiresStartFrame && !startFrame
                ? t('needStartFrame')
                : t('generate', { count: cost })}
          </Button>
        </View>
      ) : null}

      <ModelPickerSheet
        visible={modelSheet}
        models={models}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onClose={() => setModelSheet(false)}
      />
      <AiConsentSheet
        visible={showConsent}
        onAgree={onConsentAgree}
        onCancel={() => setShowConsent(false)}
      />
    </KeyboardAvoidingView>
  );
}

// ─── Section wrapper ────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap="sm">
      <Text variant="overline" color="ink" transform="uppercase" weight="700">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

// ─── Attachments ────────────────────────────────────────────────────

interface AttachmentsSectionProps {
  model: GenModel;
  seedanceMode: 'frames' | 'references';
  onSeedanceMode: (m: 'frames' | 'references') => void;
  useReferences: boolean;
  useFrames: boolean;
  startFrame: PickedUpload | null;
  endFrame: PickedUpload | null;
  references: PickedUpload[];
  uploadingSlot: Slot | null;
  onPickStart: () => void;
  onClearStart: () => void;
  onPickEnd: () => void;
  onClearEnd: () => void;
  onAddReference: () => void;
  onRemoveReference: (i: number) => void;
}

function AttachmentsSection(props: AttachmentsSectionProps) {
  const { model } = props;
  const { t } = useTranslation('create');

  return (
    <Stack gap="sm">
      {/* Seedance mode toggle */}
      {model.attachments === 'seedance' ? (
        <HStack gap="sm">
          <Chip
            label={t('attachments.modeFrames')}
            active={props.seedanceMode === 'frames'}
            onPress={() => props.onSeedanceMode('frames')}
          />
          <Chip
            label={t('attachments.modeReferences')}
            active={props.seedanceMode === 'references'}
            onPress={() => props.onSeedanceMode('references')}
          />
        </HStack>
      ) : null}

      {props.useFrames ? (
        <HStack gap="md">
          <View style={{ flex: 1 }}>
            <ImageTile
              label={t('attachments.startFrame')}
              badge={model.requiresStartFrame ? t('attachments.required') : t('attachments.optional')}
              preview={props.startFrame?.previewUri ?? null}
              uploading={props.uploadingSlot === 'start'}
              onPick={props.onPickStart}
              onClear={props.onClearStart}
            />
          </View>
          {model.supportsEndFrame ? (
            <View style={{ flex: 1 }}>
              <ImageTile
                label={t('attachments.endFrame')}
                badge={t('attachments.optional')}
                preview={props.endFrame?.previewUri ?? null}
                uploading={props.uploadingSlot === 'end'}
                onPick={props.onPickEnd}
                onClear={props.onClearEnd}
              />
            </View>
          ) : null}
        </HStack>
      ) : null}

      {props.useReferences ? (
        <Stack gap="sm">
          <Text variant="caption" color="inkMuted">
            {t('attachments.referencesHint', { count: model.maxImages })}
          </Text>
          <HStack gap="sm" wrap="wrap">
            {props.references.map((r, i) => (
              <View key={r.media.r2Key} style={{ width: 100 }}>
                <ImageTile
                  preview={r.previewUri}
                  uploading={false}
                  onPick={() => {}}
                  onClear={() => props.onRemoveReference(i)}
                />
              </View>
            ))}
            {props.references.length < model.maxImages ? (
              <View style={{ width: 100 }}>
                <ImageTile
                  preview={null}
                  uploading={props.uploadingSlot === `ref-${props.references.length}`}
                  onPick={props.onAddReference}
                  onClear={() => {}}
                />
              </View>
            ) : null}
          </HStack>
        </Stack>
      ) : null}
    </Stack>
  );
}

// ─── Single image tile ──────────────────────────────────────────────

function ImageTile({
  label,
  badge,
  preview,
  uploading,
  onPick,
  onClear,
}: {
  label?: string;
  badge?: string;
  preview: string | null;
  uploading: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  const { colors, accent } = useTheme();
  const { t } = useTranslation('create');

  return (
    <Stack gap="xs">
      {label ? (
        <HStack align="center" gap="xs">
          <Text variant="caption" color="ink" weight="700">
            {label}
          </Text>
          {badge ? (
            <Text variant="caption" color="inkMuted">
              {badge}
            </Text>
          ) : null}
        </HStack>
      ) : null}
      <Pressable
        onPress={preview ? () => {} : onPick}
        haptic="light"
        pressedOpacity={0.92}
        accessibilityLabel={label}
        style={{
          height: 100,
          borderRadius: 16,
          backgroundColor: colors.surfaceMuted,
          borderWidth: preview ? 0 : 1.5,
          borderStyle: preview ? 'solid' : 'dashed',
          borderColor: colors.borderStrong,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {preview ? (
          <>
            <Image
              source={preview}
              contentFit="cover"
              style={{ width: '100%', height: '100%' }}
              transition={120}
            />
            <Pressable
              onPress={onClear}
              haptic="warning"
              accessibilityLabel={t('attachments.remove')}
              style={{
                position: 'absolute',
                top: 6,
                end: 6,
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: colors.overlayStrong,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="trash" size={13} color="#FFFFFF" />
            </Pressable>
          </>
        ) : uploading ? (
          <ActivityIndicator color={accent.solid} />
        ) : (
          <Stack gap="xs" align="center">
            <Icon name="plus" size={20} color={accent.solid} weight="bold" />
            <Text variant="caption" color="inkMuted">
              {t('attachments.add')}
            </Text>
          </Stack>
        )}
      </Pressable>
    </Stack>
  );
}
