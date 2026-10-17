"use client";

/**
 * "Create your own voice" — two ways to a voice the user owns:
 *
 *   Record or upload   1 to 2 minutes of clean speech → ElevenLabs clone.
 *                      Needs the user's confirmation that they hold the
 *                      rights to the voice (the terms require it; the
 *                      server records when and under which wording).
 *   Describe           a few sentences → three previews → keep one.
 *
 * Both are gated by the server (paid plan, a cap per user, free account
 * slots) and charged in credits; the quota the modal shows is the same
 * answer the server gives, fetched when it opens.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Microphone, Pause, Play, Sparkle, Stop, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { toast } from "sonner";

import type { AudioVoice, VoiceDesignPreview } from "@clickfy/sdk";

import { Modal } from "@/components/ui/modal";
import { getSDK } from "@/lib/api";
import { cn } from "@/lib/utils";

type Route = "record" | "describe";

const MIN_SECONDS = 20;
const IDEAL_SECONDS = 60;
const MAX_SECONDS = 180;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function formatClock(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** Browser recording: MediaRecorder into one webm/opus file, with a live clock. */
function useRecorder(onDone: (file: File, seconds: number) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  const stop = () => {
    recRef.current?.stop();
  };

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128_000 });
    chunks.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      const total = (Date.now() - startedAt.current) / 1000;
      setRecording(false);
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      onDone(new File([blob], `recording-${Date.now()}.webm`, { type: "audio/webm" }), total);
    };
    recRef.current = rec;
    startedAt.current = Date.now();
    setSeconds(0);
    setRecording(true);
    rec.start(1000);
    timer.current = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
  };

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (recRef.current?.state === "recording") recRef.current.stop();
  }, []);

  return { recording, seconds, start, stop };
}

type Sample = { file: File; seconds: number | null; url: string };

function probeSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = new Audio(url);
    el.onloadedmetadata = () => {
      resolve(Number.isFinite(el.duration) ? el.duration : null);
      URL.revokeObjectURL(url);
    };
    el.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
  });
}

export function CreateVoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (voice: AudioVoice) => void }) {
  const t = useTranslations("audio");
  const queryClient = useQueryClient();
  const quota = useQuery({ queryKey: ["audio", "voices", "quota"], queryFn: () => getSDK().audio.voiceQuota(), staleTime: 15_000 });
  const [route, setRoute] = useState<Route>("record");
  const [busy, setBusy] = useState(false);

  // ── Record or upload ──
  const [samples, setSamples] = useState<Sample[]>([]);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const addSample = async (file: File) => {
    if (samples.length >= MAX_FILES) return toast.error(t("voiceTooManyFiles", { max: MAX_FILES }));
    if (file.size > MAX_FILE_BYTES) return toast.error(t("voiceFileTooLarge"));
    const seconds = await probeSeconds(file);
    setSamples((prev) => [...prev, { file, seconds, url: URL.createObjectURL(file) }]);
  };
  const recorder = useRecorder((file, seconds) => {
    if (seconds < MIN_SECONDS) {
      toast.error(t("voiceTooShort", { seconds: MIN_SECONDS }));
      return;
    }
    setSamples((prev) => [...prev, { file, seconds, url: URL.createObjectURL(file) }]);
  });
  useEffect(() => () => samples.forEach((s) => URL.revokeObjectURL(s.url)), [samples]);
  const totalSeconds = samples.reduce((sum, s) => sum + (s.seconds ?? 0), 0);
  const canClone = !busy && samples.length > 0 && name.trim().length > 0 && consent && !quota.data?.blocked;

  const clone = async () => {
    if (!canClone) return;
    setBusy(true);
    try {
      const { voice } = await getSDK().audio.cloneVoice({ name: name.trim(), files: samples.map((s) => s.file), consent: true });
      await queryClient.invalidateQueries({ queryKey: ["audio", "voices"] });
      toast.success(t("voiceCreated", { name: voice.name }));
      onCreated(voice);
    } catch (err) {
      toast.error(friendly(err, t));
    } finally {
      setBusy(false);
    }
  };

  // ── Describe ──
  const [description, setDescription] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [previews, setPreviews] = useState<VoiceDesignPreview[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [designName, setDesignName] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const playPreview = (p: VoiceDesignPreview) => {
    const el = playerRef.current ?? (playerRef.current = new Audio());
    if (playing === p.generatedVoiceId) {
      el.pause();
      setPlaying(null);
      return;
    }
    el.src = `data:${p.mediaType};base64,${p.audioBase64}`;
    el.onended = () => setPlaying(null);
    void el.play().then(() => setPlaying(p.generatedVoiceId)).catch(() => setPlaying(null));
  };
  useEffect(() => () => playerRef.current?.pause(), []);

  const design = async () => {
    if (description.trim().length < 20 || busy) return;
    setBusy(true);
    setPreviews([]);
    setChosen(null);
    try {
      const text = sampleText.trim();
      const result = await getSDK().audio.designVoice({ description: description.trim(), ...(text.length >= 100 ? { text } : {}) });
      setPreviews(result.previews);
      if (result.previews[0]) setChosen(result.previews[0].generatedVoiceId);
    } catch (err) {
      toast.error(friendly(err, t));
    } finally {
      setBusy(false);
    }
  };
  const canSave = !busy && !!chosen && designName.trim().length > 0 && !quota.data?.blocked;
  const save = async () => {
    if (!canSave || !chosen) return;
    setBusy(true);
    try {
      const { voice } = await getSDK().audio.saveDesignedVoice({ generatedVoiceId: chosen, name: designName.trim(), description: description.trim() });
      await queryClient.invalidateQueries({ queryKey: ["audio", "voices"] });
      toast.success(t("voiceCreated", { name: voice.name }));
      onCreated(voice);
    } catch (err) {
      toast.error(friendly(err, t));
    } finally {
      setBusy(false);
    }
  };

  const q = quota.data;
  const blockedLine = q?.blocked ? t(`voiceBlocked_${q.blocked}`, { cap: q.cap }) : null;

  return (
    <Modal onClose={onClose} label={t("cloneTitle")} className="max-w-lg">
      <div className="flex items-center gap-2 border-b border-white/[0.06] p-3">
        <h2 className="me-auto text-sm font-semibold">{t("cloneTitle")}</h2>
        {q && (
          <span className="text-xs text-muted-foreground">{t("voiceQuota", { used: q.used, cap: q.cap })}</span>
        )}
        <button type="button" onClick={onClose} aria-label={t("close")} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-3 hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      <div className="mx-3 mt-3 flex gap-1 rounded-lg bg-surface-2 p-1">
        {(["record", "describe"] as const).map((r) => (
          <button key={r} type="button" onClick={() => setRoute(r)} className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors", route === r ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {r === "record" ? <Microphone className="size-4" weight={route === r ? "fill" : "regular"} /> : <Sparkle className="size-4" weight={route === r ? "fill" : "regular"} />}
            {t(`voiceRoute_${r}`)}
          </button>
        ))}
      </div>

      {blockedLine && (
        <p className="mx-3 mt-3 rounded-lg bg-status-red/10 px-3 py-2 text-xs text-status-red">{blockedLine}</p>
      )}

      {route === "record" ? (
        <div className="space-y-3 p-3">
          <p className="text-xs text-muted-foreground">{t("voiceRecordHint", { ideal: IDEAL_SECONDS, max: MAX_SECONDS })}</p>

          <div className="flex items-center gap-2">
            {recorder.recording ? (
              <button type="button" onClick={recorder.stop} className="flex h-10 items-center gap-2 rounded-lg bg-status-red px-4 text-sm font-semibold text-white">
                <Stop weight="fill" className="size-4" />
                {t("voiceStop")} · {formatClock(recorder.seconds)}
              </button>
            ) : (
              <button type="button" disabled={busy || samples.length >= MAX_FILES} onClick={() => void recorder.start().catch(() => toast.error(t("voiceMicDenied")))} className="flex h-10 items-center gap-2 rounded-lg bg-surface-3 px-4 text-sm font-medium hover:bg-white/10 disabled:opacity-40">
                <Microphone weight="fill" className="size-4 text-status-red" />
                {t("voiceRecord")}
              </button>
            )}
            <label className={cn("flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-surface-3 px-4 text-sm font-medium hover:bg-white/10", (busy || samples.length >= MAX_FILES) && "pointer-events-none opacity-40")}>
              <UploadSimple className="size-4" />
              {t("voiceUpload")}
              <input type="file" multiple accept="audio/*" className="hidden" onChange={(e) => { Array.from(e.target.files ?? []).forEach((f) => void addSample(f)); e.target.value = ""; }} />
            </label>
          </div>

          {recorder.recording && (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className={cn("h-full rounded-full transition-[width]", recorder.seconds >= IDEAL_SECONDS ? "bg-status-green" : "bg-primary")} style={{ width: `${Math.min(100, (recorder.seconds / MAX_SECONDS) * 100)}%` }} />
            </div>
          )}

          {samples.length > 0 && (
            <ul className="space-y-1">
              {samples.map((s, i) => (
                <li key={s.url} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-xs">
                  <audio src={s.url} controls preload="metadata" className="h-8 min-w-0 flex-1" />
                  <span className="shrink-0 tabular-nums text-muted-foreground">{s.seconds != null ? formatClock(s.seconds) : "—"}</span>
                  <button type="button" aria-label={t("voiceRemoveSample")} onClick={() => setSamples((prev) => prev.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-surface-3 hover:text-status-red">
                    <Trash className="size-3.5" />
                  </button>
                </li>
              ))}
              <li className={cn("px-2 text-[11px]", totalSeconds >= IDEAL_SECONDS ? "text-status-green" : "text-muted-foreground")}>
                {t("voiceTotal", { clock: formatClock(totalSeconds) })}
              </li>
            </ul>
          )}

          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder={t("voiceNamePlaceholder")} className="h-9 w-full rounded-md bg-surface-3 px-3 text-sm outline-none placeholder:text-muted-foreground" />

          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[var(--color-primary)]" />
            <span>{t("voiceConsent")}</span>
          </label>

          <button type="button" disabled={!canClone} onClick={clone} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-black disabled:opacity-40">
            {busy ? t("working") : t("voiceCloneCta", { credits: q?.cloneCredits ?? 20 })}
          </button>
        </div>
      ) : (
        <div className="space-y-3 p-3">
          <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 1000))} rows={3} dir="auto" placeholder={t("voiceDescribePlaceholder")} className="w-full resize-none rounded-xl bg-surface-2 p-3 text-sm outline-none placeholder:text-muted-foreground" />
          <textarea value={sampleText} onChange={(e) => setSampleText(e.target.value.slice(0, 1000))} rows={2} dir="auto" placeholder={t("voiceSampleTextPlaceholder")} className="w-full resize-none rounded-xl bg-surface-2 p-3 text-sm outline-none placeholder:text-muted-foreground" />
          <button type="button" disabled={busy || description.trim().length < 20 || !!q?.blocked} onClick={design} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-surface-3 text-sm font-medium hover:bg-white/10 disabled:opacity-40">
            <Sparkle weight="fill" className="size-4 text-primary" />
            {busy && previews.length === 0 ? t("voiceDesigning") : t("voiceDesignCta")}
          </button>

          {previews.length > 0 && (
            <ul className="space-y-1">
              {previews.map((p, i) => (
                <li key={p.generatedVoiceId} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5", chosen === p.generatedVoiceId ? "bg-primary/15" : "bg-surface-2")}>
                  <button type="button" onClick={() => setChosen(p.generatedVoiceId)} className="flex min-w-0 flex-1 items-center gap-2 text-start text-sm">
                    <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", chosen === p.generatedVoiceId ? "border-primary bg-primary text-black" : "border-white/20")}>
                      {chosen === p.generatedVoiceId && <Check weight="bold" className="size-3" />}
                    </span>
                    {t("voicePreviewN", { n: i + 1 })}
                    {p.durationSecs != null && <span className="text-xs text-muted-foreground">· {Math.round(p.durationSecs)}s</span>}
                  </button>
                  <button type="button" onClick={() => playPreview(p)} aria-label={playing === p.generatedVoiceId ? t("stopPreview") : t("playPreview")} className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20">
                    {playing === p.generatedVoiceId ? <Pause weight="fill" className="size-3.5" /> : <Play weight="fill" className="size-3.5 translate-x-px" />}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {previews.length > 0 && (
            <>
              <input value={designName} onChange={(e) => setDesignName(e.target.value.slice(0, 60))} placeholder={t("voiceNamePlaceholder")} className="h-9 w-full rounded-md bg-surface-3 px-3 text-sm outline-none placeholder:text-muted-foreground" />
              <button type="button" disabled={!canSave} onClick={save} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-black disabled:opacity-40">
                {busy ? t("working") : t("voiceSaveCta", { credits: q?.designCredits ?? 10 })}
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Server refusals carry a sentence; show it. Anything cryptic gets the generic line. */
function friendly(err: unknown, t: ReturnType<typeof useTranslations>): string {
  const message = err instanceof Error ? err.message : "";
  const m = /\d{3}: (\{.*\})$/.exec(message);
  if (m) {
    try {
      const body = JSON.parse(m[1]!) as { error?: { code?: string; message?: string } };
      if (body.error?.code === "insufficient_credits") return t("insufficientCredits");
      if (body.error?.message) return body.error.message;
    } catch {
      /* fall through */
    }
  }
  return t("voiceCreateFailed");
}
