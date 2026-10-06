"use client";

/**
 * The Audio section's composer: three tabs on the three ElevenLabs
 * models the API serves for `kind=audio`.
 *
 *   Speech         text → voice           3 credits per started 1,000 chars
 *   Sound effects  description → clip     1 credit
 *   Voice changer  recording → new voice  2 credits per started minute
 *
 * The price shown is the same arithmetic the server charges
 * (`resolveCreditCost` with the model's unit prices), so what the button
 * says is what the ledger will say. Results land on the canvas like any
 * other generation: `startGeneration` files the job into the active
 * project and the masonry shows an audio tile when it completes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { Pause, Play, SpeakerHigh, UploadSimple, Waveform, Microphone, MusicNotes } from "@phosphor-icons/react";
import { toast } from "sonner";

import type { AudioVoice, GenModel, JobInputValue } from "@clickfy/sdk";
import { JobSubmissionError } from "@clickfy/sdk";

import { useStudio } from "@/components/studio/studio-context";
import { useModels } from "@/lib/use-models";
import { getSDK } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "tts" | "sfx" | "sts";
const TABS: Array<{ key: Tab; icon: typeof Microphone }> = [
  { key: "tts", icon: Microphone },
  { key: "sfx", icon: MusicNotes },
  { key: "sts", icon: Waveform },
];

/** Mirrors `resolveCreditCost`'s unit branch, so the quote matches the charge. */
function quote(model: GenModel | undefined, chars: number, seconds: number): number {
  const p = model?.audio?.pricing;
  if (!p) return model?.costCredits ?? 0;
  if (p.per1kChars) return Math.max(1, Math.ceil(chars / 1000)) * p.per1kChars;
  if (p.perMinute) return Math.max(1, Math.ceil(seconds / 60)) * p.perMinute;
  return p.flat ?? model?.costCredits ?? 0;
}

function useVoices() {
  const { isLoaded, isSignedIn } = useAuth();
  return useQuery({
    queryKey: ["audio", "voices"],
    queryFn: () => getSDK().audio.listVoices(),
    enabled: isLoaded && !!isSignedIn,
    staleTime: 30 * 60_000,
  });
}

/** The voice list with a one-at-a-time preview player. */
function VoicePicker({ voices, value, onChange, loading }: { voices: AudioVoice[]; value: AudioVoice | null; onChange: (v: AudioVoice) => void; loading: boolean }) {
  const t = useTranslations("audio");
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<"all" | "en" | "ar">("all");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return voices.filter((v) => {
      if (lang !== "all" && (v.language ?? "").toLowerCase() !== lang) return false;
      if (!q) return true;
      return [v.name, v.accent, v.gender, v.useCase, v.description].some((s) => s?.toLowerCase().includes(q));
    });
  }, [voices, query, lang]);

  const preview = (v: AudioVoice) => {
    if (!v.previewUrl) return;
    const el = audioRef.current ?? (audioRef.current = new Audio());
    if (playingId === v.voiceId) { el.pause(); setPlayingId(null); return; }
    el.src = v.previewUrl;
    el.onended = () => setPlayingId(null);
    void el.play().then(() => setPlayingId(v.voiceId)).catch(() => setPlayingId(null));
  };
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-surface-2">
      <div className="flex items-center gap-2 border-b border-white/[0.06] p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchVoices")}
          className="h-8 min-w-0 flex-1 rounded-md bg-surface-3 px-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex gap-0.5 rounded-md bg-surface-3 p-0.5 text-xs">
          {(["all", "en", "ar"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={cn("rounded px-2 py-1", lang === l ? "bg-background text-foreground" : "text-muted-foreground")}>
              {t(`lang_${l}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto p-1">
        {loading ? (
          <p className="p-3 text-xs text-muted-foreground">{t("loadingVoices")}</p>
        ) : filtered.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{t("noVoices")}</p>
        ) : (
          filtered.map((v) => {
            const selected = value?.voiceId === v.voiceId;
            const meta = [v.language?.toUpperCase(), v.gender, v.accent, v.age].filter(Boolean).join(" · ");
            return (
              <div key={v.voiceId} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5", selected ? "bg-primary/15" : "hover:bg-surface-3")}>
                <button
                  type="button"
                  aria-label={playingId === v.voiceId ? t("stopPreview") : t("playPreview")}
                  disabled={!v.previewUrl}
                  onClick={() => preview(v)}
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-foreground disabled:opacity-30"
                >
                  {playingId === v.voiceId ? <Pause weight="fill" className="size-3" /> : <Play weight="fill" className="size-3 translate-x-px" />}
                </button>
                <button type="button" onClick={() => onChange(v)} className="min-w-0 flex-1 text-start">
                  <div className="truncate text-sm font-medium">{v.name}{v.source === "account" && <span className="ms-1 text-[10px] text-primary">{t("yourVoice")}</span>}</div>
                  <div className="truncate text-xs text-muted-foreground">{meta || v.useCase || ""}</div>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="block text-xs">
      <span className="flex justify-between text-muted-foreground"><span>{label}</span><span className="tabular-nums">{value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[var(--color-primary)]" />
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function AudioComposer() {
  const t = useTranslations("audio");
  const { startGeneration } = useStudio();
  const { models, isLoading: modelsLoading } = useModels("audio");
  const voicesQuery = useVoices();
  const voices = voicesQuery.data ?? [];

  const [tab, setTab] = useState<Tab>("tts");
  const model = models.find((m) => m.audio?.task === tab);

  // Speech
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<AudioVoice | null>(null);
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [speed, setSpeed] = useState(1);
  const [expressive, setExpressive] = useState(false);
  // Effects
  const [sfxText, setSfxText] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [influence, setInfluence] = useState(0.3);
  // Voice changer
  const [source, setSource] = useState<{ file: File; seconds: number | null; ref?: Extract<JobInputValue, { kind: "audio" }> } | null>(null);
  const [uploading, setUploading] = useState(false);

  const [busy, setBusy] = useState(false);

  const maxChars = model?.audio?.maxChars ?? 5000;
  const credits = quote(model, tab === "tts" ? text.length : sfxText.length, source?.seconds ?? 0);

  // A dropped file: read its length in the browser so the price is known before upload.
  const pickFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const el = new Audio(url);
    el.onloadedmetadata = () => {
      setSource({ file, seconds: Number.isFinite(el.duration) ? el.duration : null });
      URL.revokeObjectURL(url);
    };
    el.onerror = () => { setSource({ file, seconds: null }); URL.revokeObjectURL(url); };
  };

  const canSubmit =
    !!model && !busy && !uploading &&
    (tab === "tts" ? text.trim().length > 0 && text.length <= maxChars && !!voice
      : tab === "sfx" ? sfxText.trim().length > 0
        : !!source && !!voice);

  const submit = async () => {
    if (!model || !canSubmit) return;
    setBusy(true);
    try {
      let references: Array<Extract<JobInputValue, { kind: "audio" }>> = [];
      if (tab === "sts" && source) {
        setUploading(true);
        try {
          const sdk = getSDK();
          let audioRef = source.ref;
          if (!audioRef) {
            const up = await sdk.uploads.uploadUserAsset({ file: source.file, name: source.file.name, type: source.file.type, sizeBytes: source.file.size });
            // Register in My Assets so the server knows the probed length and the clip can be reused.
            await sdk.media
              .register({ r2Key: up.key, name: source.file.name, kind: "audio", mimeType: up.contentType, sizeBytes: up.sizeBytes, durationSeconds: source.seconds ?? null })
              .catch(() => undefined);
            audioRef = { kind: "audio" as const, r2Key: up.key, mimeType: up.contentType, sizeBytes: up.sizeBytes };
            setSource({ ...source, ref: audioRef });
          }
          references = [audioRef];
        } finally {
          setUploading(false);
        }
      }
      await startGeneration({
        kind: "audio",
        count: 1,
        input: {
          modelKey: model.modelKey,
          prompt: tab === "tts" ? text : tab === "sfx" ? sfxText : "",
          references,
          audio: {
            ...(voice && tab !== "sfx" ? { voiceId: voice.voiceId, voiceName: voice.name, ...(voice.publicOwnerId ? { publicOwnerId: voice.publicOwnerId } : {}) } : {}),
            ...(tab === "tts" ? { stability, similarity, speed, expressive, ...(voice?.language && /^[a-z]{2}$/i.test(voice.language) ? { languageCode: voice.language.toLowerCase() } : {}) } : {}),
            ...(tab === "sfx" ? { ...(duration ? { durationSeconds: duration } : {}), promptInfluence: influence } : {}),
            ...(tab === "sts" ? { stability, similarity } : {}),
          },
          ...(tab === "sts" && source?.seconds ? { inputAudioSeconds: Math.ceil(source.seconds) } : {}),
        },
      });
      toast.success(t("queued"));
    } catch (err) {
      if (err instanceof JobSubmissionError && err.code === "insufficient_credits") toast.error(t("insufficientCredits"));
      else toast.error(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-surface-1/95 p-3 shadow-2xl backdrop-blur">
      <div className="mb-3 flex gap-1 rounded-lg bg-surface-2 p-1">
        {TABS.map(({ key, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors", tab === key ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="size-4" weight={tab === key ? "fill" : "regular"} />
            {t(`tab_${key}`)}
          </button>
        ))}
      </div>

      {modelsLoading ? (
        <p className="p-4 text-sm text-muted-foreground">{t("loading")}</p>
      ) : !model ? (
        <p className="p-4 text-sm text-muted-foreground">{t("unavailable")}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            {tab === "tts" && (
              <>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t("ttsPlaceholder")}
                  rows={5}
                  dir="auto"
                  className="w-full resize-none rounded-xl bg-surface-2 p-3 text-sm outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className={cn("tabular-nums", text.length > maxChars && "text-destructive")}>{text.length.toLocaleString()} / {maxChars.toLocaleString()}</span>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={expressive} onChange={(e) => setExpressive(e.target.checked)} disabled={!model.audio?.expressive} />
                    {t("expressive")}
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Slider label={t("stability")} value={stability} min={0} max={1} step={0.05} onChange={setStability} />
                  <Slider label={t("similarity")} value={similarity} min={0} max={1} step={0.05} onChange={setSimilarity} />
                  <Slider label={t("speed")} value={speed} min={0.7} max={1.2} step={0.05} onChange={setSpeed} />
                </div>
              </>
            )}
            {tab === "sfx" && (
              <>
                <textarea
                  value={sfxText}
                  onChange={(e) => setSfxText(e.target.value.slice(0, model.maxPromptChars))}
                  placeholder={t("sfxPlaceholder")}
                  rows={4}
                  dir="auto"
                  className="w-full resize-none rounded-xl bg-surface-2 p-3 text-sm outline-none placeholder:text-muted-foreground"
                />
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs">
                    <span className="flex justify-between text-muted-foreground"><span>{t("length")}</span><span className="tabular-nums">{duration ? `${duration}s` : t("auto")}</span></span>
                    <input type="range" min={0} max={model.audio?.duration?.max ?? 30} step={0.5} value={duration ?? 0} onChange={(e) => setDuration(Number(e.target.value) || null)} className="mt-1 w-full accent-[var(--color-primary)]" />
                    <span className="text-[10px] text-muted-foreground">{t("lengthHint")}</span>
                  </label>
                  <Slider label={t("influence")} value={influence} min={0} max={1} step={0.05} onChange={setInfluence} hint={t("influenceHint")} />
                </div>
              </>
            )}
            {tab === "sts" && (
              <>
                <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-surface-2 p-5 text-center text-sm", source && "border-primary/50")}>
                  <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/webm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }} />
                  {source ? (
                    <>
                      <SpeakerHigh className="size-6 text-primary" weight="fill" />
                      <span className="font-medium">{source.file.name}</span>
                      <span className="text-xs text-muted-foreground">{source.seconds ? `${Math.round(source.seconds)} s` : t("unknownLength")} · {(source.file.size / 1024 / 1024).toFixed(1)} MB</span>
                    </>
                  ) : (
                    <>
                      <UploadSimple className="size-6 text-muted-foreground" />
                      <span>{t("dropRecording")}</span>
                      <span className="text-xs text-muted-foreground">{t("recordingLimits")}</span>
                    </>
                  )}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <Slider label={t("stability")} value={stability} min={0} max={1} step={0.05} onChange={setStability} />
                  <Slider label={t("similarity")} value={similarity} min={0} max={1} step={0.05} onChange={setSimilarity} />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {tab !== "sfx" && (
              <>
                <div className="text-xs text-muted-foreground">{voice ? t("voiceSelected", { name: voice.name }) : t("pickVoice")}</div>
                <VoicePicker voices={voices} value={voice} onChange={setVoice} loading={voicesQuery.isLoading} />
                {voicesQuery.isError && <p className="text-xs text-destructive">{t("voicesFailed")}</p>}
              </>
            )}
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="mt-auto flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-black transition-opacity disabled:opacity-40"
            >
              {busy ? t("working") : t("generate", { credits })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
