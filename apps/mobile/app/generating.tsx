import {
  Box,
  Button,
  Card,
  HStack,
  Stack,
  Text,
  useTheme,
} from '@clickfy/ui';
import type { GenerationProgress } from '@clickfy/sdk';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { setGenerationOutputs } from '@/lib/generation-cache';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { getSDK } from '@/lib/sdk';

/**
 * Fallback label rendered when we don't have progress data yet
 * (queued, first ~1s of a job). Once the Trigger.dev task starts,
 * the real per-stage message replaces this.
 */
const QUEUED_LABEL = 'Waiting in queue…';

export default function GeneratingScreen() {
  const { jobId, templateId } = useLocalSearchParams<{ jobId: string; templateId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const sdk = getSDK();

  const [progress, setProgress] = useState<GenerationProgress | null>(null);

  // Subscribe to job updates. The http client polls /v1/jobs/:id at
  // ~1s intervals and emits a `GenerationProgress` update whenever
  // the row changes meaningfully (status/stage/outputs/error). The
  // subscription self-terminates once the job is `completed` or
  // `failed`; the explicit unsubscribe handles the user navigating
  // away mid-job.
  useEffect(() => {
    if (!jobId) return;
    const unsubscribe = sdk.generation.subscribe(jobId, (next) => {
      setProgress(next);
      if (next.status === 'completed' && next.outputs) {
        setGenerationOutputs(next.jobId, next.outputs);
        // 400ms grace so the "Done" tick has a beat to render before
        // we slam the result screen on top. Without this the screen
        // transition feels jarring on fast jobs (sub-2s Gemini calls).
        setTimeout(() => {
          router.replace({
            pathname: '/result/[jobId]',
            params: {
              jobId: next.jobId,
              templateId: templateId ?? '',
            },
          });
        }, 400);
      }
      // Failed jobs stay on this screen so the user sees the error
      // message and can choose to retry (which means going back).
      // No auto-navigate — surprise navigations after a failure
      // make it feel like the app is hiding the problem.
    });
    return unsubscribe;
  }, [jobId, templateId, router, sdk.generation]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <ScreenHeader />

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 32 }}>
        {/* Animated halo */}
        <Halo />

        <Stack gap="sm" align="center" style={{ maxWidth: 320 }}>
          <Text variant="title" color="ink" align="center" style={{ fontSize: 26, lineHeight: 30 }}>
            Cooking your shot…
          </Text>
          <Text variant="body" color="inkMuted" align="center">
            Usually takes 20–40 seconds. Feel free to leave — we&apos;ll ping you when it&apos;s ready.
          </Text>
        </Stack>

        {/* Progress card. We render the current stage's real label
            (emitted by the Trigger.dev task) plus a "step N of M"
            counter when we have a stage count. We deliberately don't
            try to project a list of future steps because the
            orchestrator doesn't expose them — and a stale list
            (carried over from a previous template) would be worse
            than an honest single-line view. */}
        <Card style={{ width: '100%', maxWidth: 360 }}>
          <View style={{ paddingVertical: 14 }}>
            <HStack align="center" gap="md">
              <StepIndicator
                status={progress?.status === 'completed' ? 'done' : 'active'}
              />
              <Stack gap="xs" style={{ flex: 1 }}>
                <Text
                  variant="bodySemi"
                  color="ink"
                  style={{ fontSize: 14, lineHeight: 18 }}
                >
                  {progress?.stageLabel || QUEUED_LABEL}
                </Text>
                {progress && progress.stageCount > 1 ? (
                  <Text variant="caption" color="inkMuted">
                    Step {progress.stageIndex} of {progress.stageCount}
                  </Text>
                ) : null}
              </Stack>
              {progress?.status === 'processing' ? (
                <Text variant="caption" color={accent.solid} weight="700">
                  Working…
                </Text>
              ) : null}
            </HStack>
          </View>
        </Card>
      </View>

      <Box px="lg" pb="xl" style={{ paddingBottom: insets.bottom + 24 }}>
        {progress?.status === 'failed' ? (
          // Show the error inline above a "Try again" CTA. We send the
          // user to the template page (rather than `router.back()`)
          // because:
          //   • Users coming from Projects have no template form on
          //     the back stack — `back()` would dump them in /projects.
          //   • Even users from the form benefit: a clean template
          //     page resets transient input state so a stale value
          //     can't cause the same failure on retry.
          // We intentionally don't auto-retry — failures might be
          // input-related (NSFW filter, invalid aspect, etc.) and a
          // blind retry would burn another credit on the same input.
          // Credit refunds for infra failures are issued automatically
          // by the orchestrator, so the user starts the retry with
          // their balance restored.
          <Stack gap="sm">
            <Text variant="bodySemi" color="ink" align="center">
              {progress.error || 'Something went wrong while generating.'}
            </Text>
            {templateId ? (
              <Button
                variant="primary"
                full
                onPress={() =>
                  router.replace({
                    pathname: '/template/[id]',
                    params: { id: templateId },
                  })
                }
              >
                Try again
              </Button>
            ) : (
              <Button variant="primary" full onPress={() => router.replace('/(tabs)')}>
                Back to home
              </Button>
            )}
          </Stack>
        ) : (
          <Button variant="ghost" full onPress={() => router.back()}>
            Run in background
          </Button>
        )}
      </Box>
    </View>
  );
}

// ─── Animated halo ───────────────────────────────────────────────────

function Halo() {
  const { accent, colors } = useTheme();
  const blurRotation = useSharedValue(0);
  const dashRotation = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    blurRotation.value = withRepeat(
      withTiming(360, { duration: 6000, easing: Easing.linear }),
      -1,
      false,
    );
    dashRotation.value = withRepeat(
      withTiming(360, { duration: 14000, easing: Easing.linear }),
      -1,
      false,
    );
    pulse.value = withRepeat(withTiming(1.06, { duration: 1400 }), -1, true);
    return () => {
      cancelAnimation(blurRotation);
      cancelAnimation(dashRotation);
      cancelAnimation(pulse);
    };
  }, [blurRotation, dashRotation, pulse]);

  const blurStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${blurRotation.value}deg` }],
  }));
  const dashStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${dashRotation.value}deg` }],
  }));
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  return (
    <View style={{ width: 220, height: 220, alignItems: 'center', justifyContent: 'center' }}>
      {/* Outer dashed ring */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 220,
            height: 220,
            borderRadius: 110,
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: accent.solid,
            opacity: 0.5,
          },
          dashStyle,
        ]}
      />

      {/* Conic-style glow approximated with a colored disc + heavy shadow */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 180,
            height: 180,
            borderRadius: 90,
            backgroundColor: accent.deep,
            opacity: 0.45,
            shadowColor: accent.solid,
            shadowOpacity: 1,
            shadowRadius: 50,
            shadowOffset: { width: 0, height: 0 },
          },
          blurStyle,
        ]}
      />

      {/* Inner surface + pulsing icon */}
      <View
        style={{
          width: 164,
          height: 164,
          borderRadius: 82,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 30 },
        }}
      >
        <Animated.View style={pulseStyle}>
          <Icon
            name="wand"
            size={48}
            color={accent.solid}
            weight="fill"
          />
        </Animated.View>
      </View>
    </View>
  );
}

// ─── Step indicator dot ──────────────────────────────────────────────

function StepIndicator({ status }: { status: 'done' | 'active' | 'pending' }) {
  const { colors, accent } = useTheme();
  if (status === 'done') {
    return (
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: accent.solid,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="check" size={13} color={accent.ink} weight="bold" />
      </View>
    );
  }
  if (status === 'active') {
    return (
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: accent.solid,
          backgroundColor: colors.surface,
          shadowColor: accent.solid,
          shadowOpacity: 0.5,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
    );
  }
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceMuted,
      }}
    />
  );
}
