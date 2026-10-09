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
import { CaretDown, Check, Pause, Play, SlidersHorizontal, Sparkle, SpeakerHigh, UploadSimple, Waveform, Microphone, MusicNotes, X } from "@phosphor-icons/react";
import { toast } from "sonner";

import type { AudioVoice, GenModel, JobInputValue } from "@clickfy/sdk";
import { JobSubmissionError } from "@clickfy/sdk";

import { Modal } from "@/components/ui/modal";
import { Menu, MenuItem } from "@/components/ui/menu";
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

/** A stable colour pair per voice name, so the same voice always wears the same circle. */
function avatarStyle(name: string): { background: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return { background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 40%))` };
}

function VoiceAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white", className)} style={avatarStyle(name)} aria-hidden>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
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

/** The voice list, in a modal, with a one-at-a-time preview player. Choosing closes it. */
function VoiceModal({ voices, value, onChange, onClose, loading, error }: { voices: AudioVoice[]; value: AudioVoice | null; onChange: (v: AudioVoice) => void; onClose: () => void; loading: boolean; error: boolean }) {
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
    <Modal onClose={onClose} label={t("pickVoice")} className="max-w-lg">
      <div className="flex items-center gap-2 border-b border-white/[0.06] p-3">
        <h2 className="me-auto text-sm font-semibold">{t("pickVoice")}</h2>
        <div className="flex gap-0.5 rounded-md bg-surface-3 p-0.5 text-xs">
          {(["all", "en", "ar"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={cn("rounded px-2 py-1", lang === l ? "bg-background text-foreground" : "text-muted-foreground")}>
              {t(`lang_${l}`)}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label={t("close")} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-3 hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      {/* Cloning needs a plan with voice slots; shown now so the door is visible, opened later. */}
      <div className="mx-3 mt-3 flex items-center gap-3 rounded-xl bg-gradient-to-r from-primary/20 to-surface-3 p-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-black"><Sparkle weight="fill" className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t("cloneTitle")}</div>
          <div className="truncate text-xs text-muted-foreground">{t("cloneSub")}</div>
        </div>
        <button type="button" onClick={() => toast.info(t("cloneSoon"))} className="shrink-0 rounded-lg bg-surface-1 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/10">
          {t("cloneCta")}
        </button>
      </div>
      <div className="p-3">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchVoices")}
          className="h-9 w-full rounded-md bg-surface-3 px-3 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="max-h-[50dvh] overflow-y-auto px-2 pb-3">
        {loading ? (
          <p className="p-3 text-xs text-muted-foreground">{t("loadingVoices")}</p>
        ) : error ? (
          <p className="p-3 text-xs text-destructive">{t("voicesFailed")}</p>
        ) : filtered.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{t("noVoices")}</p>
        ) : (
          filtered.map((v) => {
            const selected = value?.voiceId === v.voiceId;
            const meta = [v.language?.toUpperCase(), v.gender, v.accent, v.age].filter(Boolean).join(" · ");
            return (
              <div key={v.voiceId} className={cn("flex items-center gap-3 rounded-lg px-2 py-1.5", selected ? "bg-primary/15" : "hover:bg-surface-3")}>
                <button type="button" onClick={() => { onChange(v); onClose(); }} className="flex min-w-0 flex-1 items-center gap-3 py-0.5 text-start">
                  <VoiceAvatar name={v.name} className="size-9" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{v.name.split(" - ")[0]}{v.source === "account" && <span className="ms-1 text-[10px] text-primary">{t("yourVoice")}</span>}</span>
                    <span className="block truncate text-xs text-muted-foreground">{meta || v.useCase || v.name.split(" - ")[1] || ""}</span>
                  </span>
                  {selected && <Check weight="bold" className="size-4 shrink-0 text-primary" />}
                </button>
                <button
                  type="button"
                  aria-label={playingId === v.voiceId ? t("stopPreview") : t("playPreview")}
                  disabled={!v.previewUrl}
                  onClick={() => preview(v)}
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-foreground hover:bg-white/20 disabled:opacity-30"
                >
                  {playingId === v.voiceId ? <Pause weight="fill" className="size-3.5" /> : <Play weight="fill" className="size-3.5 translate-x-px" />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

/** The compact trigger: the chosen voice's name, a preview button, and a caret that opens the modal. */
function VoiceButton({ voice, onOpen }: { voice: AudioVoice | null; onOpen: () => void }) {
  const t = useTranslations("audio");
  // The playing element lives in state so the cleanup below can stop it; a
  // voice change remounts the button (keyed by the caller) and drops it.
  const [player, setPlayer] = useState<HTMLAudioElement | null>(null);
  const playing = player != null;
  useEffect(() => () => { player?.pause(); }, [player]);
  const toggle = () => {
    if (player) { player.pause(); setPlayer(null); return; }
    if (!voice?.previewUrl) return;
    const el = new Audio(voice.previewUrl);
    el.onended = () => setPlayer(null);
    void el.play().then(() => setPlayer(el)).catch(() => setPlayer(null));
  };
  return (
    <div className="flex h-9 items-center rounded-lg bg-surface-3 text-sm">
      <button type="button" onClick={onOpen} className="flex h-9 items-center gap-2 rounded-s-lg ps-1.5 pe-2.5 hover:bg-white/10">
        {voice ? <VoiceAvatar name={voice.name} className="size-6 text-[10px]" /> : <Microphone className="size-4 text-muted-foreground" />}
        <span className={cn("max-w-[11rem] truncate", !voice && "text-muted-foreground")}>{voice ? voice.name.split(" - ")[0] : t("pickVoice")}</span>
        <CaretDown className="size-3 text-muted-foreground" />
      </button>
      {voice?.previewUrl && (
        <button type="button" onClick={toggle} aria-label={playing ? t("stopPreview") : t("playPreview")} className="grid size-9 place-items-center rounded-e-lg border-s border-white/10 hover:bg-white/10">
          {playing ? <Pause weight="fill" className="size-3.5" /> : <Play weight="fill" className="size-3.5 translate-x-px" />}
        </button>
      )}
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
  const voices = useMemo(() => voicesQuery.data ?? [], [voicesQuery.data]);

  const [tab, setTab] = useState<Tab>("tts");
  const model = models.find((m) => m.audio?.task === tab);
  const speechModel = models.find((m) => m.audio?.task === "tts");
  const engines = speechModel?.audio?.engines ?? [];
  const [engineId, setEngineId] = useState<string | null>(null);
  const engine = engines.find((e) => e.id === engineId) ?? engines.find((e) => e.id === speechModel?.audio?.defaultEngine) ?? engines[0];

  // Speech
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<AudioVoice | null>(null);
  // A voice is preselected the moment the list arrives: the account's own first, else the first listed.
  useEffect(() => {
    if (voice || voices.length === 0) return;
    setVoice(voices.find((v) => v.source === "account") ?? voices[0]!);
  }, [voices, voice]);
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [speed, setSpeed] = useState(1);
  // Kept for engines without a dropdown (older API builds); the engine picker supersedes it.
  const expressive = false;
  // Effects
  const [sfxText, setSfxText] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [influence, setInfluence] = useState(0.3);
  // Voice changer
  const [source, setSource] = useState<{ file: File; seconds: number | null; ref?: Extract<JobInputValue, { kind: "audio" }> } | null>(null);
  const [uploading, setUploading] = useState(false);

  const [busy, setBusy] = useState(false);

  const maxChars = (tab === "tts" ? engine?.maxChars : undefined) ?? model?.audio?.maxChars ?? 5000;
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
            ...(tab === "tts" ? { stability, similarity, speed, ...(engine ? { engine: engine.id } : { expressive }), ...(voice?.language && /^[a-z]{2}$/i.test(voice.language) ? { languageCode: voice.language.toLowerCase() } : {}) } : {}),
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

  const [voiceOpen, setVoiceOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-surface-1/95 p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex gap-1 rounded-lg bg-surface-2 p-1">
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
        <div className="space-y-2">
          {tab === "tts" && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("ttsPlaceholder")}
              rows={3}
              dir="auto"
              className="w-full resize-none rounded-xl bg-surface-2 p-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          )}
          {tab === "sfx" && (
            <textarea
              value={sfxText}
              onChange={(e) => setSfxText(e.target.value.slice(0, model.maxPromptChars))}
              placeholder={t("sfxPlaceholder")}
              rows={2}
              dir="auto"
              className="w-full resize-none rounded-xl bg-surface-2 p-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          )}
          {tab === "sts" && (
            <label className={cn("flex cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-surface-2 px-4 py-3 text-sm", source && "border-primary/50")}>
              <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/webm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }} />
              {source ? (
                <>
                  <SpeakerHigh className="size-5 shrink-0 text-primary" weight="fill" />
                  <span className="min-w-0 truncate font-medium">{source.file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{source.seconds ? `${Math.round(source.seconds)} s` : t("unknownLength")} · {(source.file.size / 1024 / 1024).toFixed(1)} MB</span>
                </>
              ) : (
                <>
                  <UploadSimple className="size-5 shrink-0 text-muted-foreground" />
                  <span>{t("dropRecording")}</span>
                  <span className="text-xs text-muted-foreground">{t("recordingLimits")}</span>
                </>
              )}
            </label>
          )}

          {showSettings && (
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-3">
              {tab === "tts" && (
                <>
                  <Slider label={t("stability")} value={stability} min={0} max={1} step={0.05} onChange={setStability} />
                  <Slider label={t("similarity")} value={similarity} min={0} max={1} step={0.05} onChange={setSimilarity} />
                  <Slider label={t("speed")} value={speed} min={0.7} max={1.2} step={0.05} onChange={setSpeed} />
                </>
              )}
              {tab === "sfx" && (
                <>
                  <label className="block text-xs">
                    <span className="flex justify-between text-muted-foreground"><span>{t("length")}</span><span className="tabular-nums">{duration ? `${duration}s` : t("auto")}</span></span>
                    <input type="range" min={0} max={model.audio?.duration?.max ?? 30} step={0.5} value={duration ?? 0} onChange={(e) => setDuration(Number(e.target.value) || null)} className="mt-1 w-full accent-[var(--color-primary)]" />
                    <span className="text-[10px] text-muted-foreground">{t("lengthHint")}</span>
                  </label>
                  <Slider label={t("influence")} value={influence} min={0} max={1} step={0.05} onChange={setInfluence} hint={t("influenceHint")} />
                </>
              )}
              {tab === "sts" && (
                <>
                  <Slider label={t("stability")} value={stability} min={0} max={1} step={0.05} onChange={setStability} />
                  <Slider label={t("similarity")} value={similarity} min={0} max={1} step={0.05} onChange={setSimilarity} />
                </>
              )}
            </div>
          )}

          {/* Bottom bar: voice, settings, expressive, counter, generate. */}
          <div className="flex flex-wrap items-center gap-2">
            {tab !== "sfx" && <VoiceButton key={voice?.voiceId ?? "none"} voice={voice} onOpen={() => setVoiceOpen(true)} />}
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              aria-pressed={showSettings}
              className={cn("flex h-9 items-center gap-1.5 rounded-lg bg-surface-3 px-2.5 text-sm hover:bg-white/10", showSettings && "text-primary")}
            >
              <SlidersHorizontal className="size-4" />
              {t("advanced")}
            </button>
            {tab === "tts" && engines.length > 0 && engine && (
              <Menu
                align="start"
                side="top"
                trigger={({ toggle }) => (
                  <button type="button" onClick={toggle} className="flex h-9 items-center gap-1.5 rounded-lg bg-surface-3 px-2.5 text-sm hover:bg-white/10">
                    <span className="text-muted-foreground">{t("engine")}</span>
                    <span className="max-w-[9rem] truncate">{engine.label}</span>
                    <CaretDown className="size-3 text-muted-foreground" />
                  </button>
                )}
              >
                {({ close }) => (
                  <>
                    {engines.map((e) => (
                      <MenuItem key={e.id} selected={e.id === engine.id} onClick={() => { setEngineId(e.id); close(); }}>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span>{speechModel?.provider === "elevenlabs" ? `ElevenLabs · ${e.label}` : e.label}</span>
                          <span className="text-xs text-muted-foreground">{e.hint}</span>
                        </span>
                        {e.id === engine.id && <Check weight="bold" className="size-4 shrink-0 text-primary" />}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Menu>
            )}
            <span className={cn("ms-auto text-xs tabular-nums text-muted-foreground", tab === "tts" && text.length > maxChars && "text-destructive")}>
              {tab === "tts" ? `${text.length.toLocaleString()} / ${maxChars.toLocaleString()}` : tab === "sfx" ? `${sfxText.length} / ${model.maxPromptChars}` : ""}
            </span>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-black transition-opacity disabled:opacity-40"
            >
              {busy ? t("working") : t("generate", { credits })}
            </button>
          </div>
        </div>
      )}

      {voiceOpen && (
        <VoiceModal voices={voices} value={voice} onChange={setVoice} onClose={() => setVoiceOpen(false)} loading={voicesQuery.isLoading} error={voicesQuery.isError} />
      )}
    </div>
  );
}
