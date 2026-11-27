"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { Camera, ImagePlus, Images, LoaderCircle, Mic, Square, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { currentPageContext } from "@/features/workflow/flow-hint-store";
import { CHAT_IMAGE_ACCEPT, CHAT_IMAGE_MAX_BYTES, IMAGE_TOO_LARGE, VOICE_MAX_SECONDS } from "@/lib/ai/chat-media";
import { cn } from "@/lib/utils";

/**
 * Bilder och röst i Workflow AI:s chatt (2026-11-21). Two small buttons at the field's lower left – Bild and Mikrofon – kept
 * apart from the panel so the chat itself changes little. Nothing leaves the browser for anyone but Workflow's own server: a photo
 * goes with the question to /api/ai/chat, a recording to /api/ai/transcribe; the browser's own speech recognition is never used
 * (it sends the audio to a third party). The microphone is asked for only when the person presses the button.
 */
export type MediaSupport = { ready: boolean; reason: string | null };
export type ChatMedia = { images: MediaSupport; voice: MediaSupport };
/** A photo chosen for the next question: a new file, or one already on the open work order. */
export type ChatAttachedImage = { kind: "file"; file: File; name: string; previewUrl: string } | { kind: "attachment"; attachmentId: string; name: string; previewUrl: string };

/** The chat request: JSON as before, or a form with the JSON in `payload` and the new photo in `image`. */
export function chatRequestInit(payload: Record<string, unknown>, image: ChatAttachedImage | null): { headers?: Record<string, string>; body: BodyInit } {
  if (!image) return { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
  if (image.kind === "attachment") return { headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, imageAttachmentId: image.attachmentId }) };
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  form.append("image", image.file, image.name);
  return { body: form };
}

/** The question when only a photo was given. */
export const IMAGE_ONLY_QUESTION = "Vad visar bilden?";

type PageTask = { taskId?: string; kind?: string };
const openTask = () => (currentPageContext() as PageTask | null) ?? null;

/** Bild: take a photo (the phone's camera) or choose a file, or point at a photo already on the open work order. */
function ImageButton({ support, onPick, onNotice, disabled }: { support: MediaSupport; onPick: (image: ChatAttachedImage) => void; onNotice: (text: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<{ id: string; filename: string }[] | null>(null);
  const camera = useRef<HTMLInputElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const [task, setTask] = useState<PageTask | null>(null);
  // The open work order's photos, read when the menu opens (the tasks route checks the person's rights as always).
  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    const page = openTask();
    setTask(page);
    setPhotos(null);
    if (!page?.taskId) return;
    fetch(`/api/workflow-tasks?id=${encodeURIComponent(page.taskId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { tasks?: { attachments?: { id: string; filename: string; mimeType: string }[] }[] } | null) => {
        setPhotos((data?.tasks?.[0]?.attachments ?? []).filter((file) => file.mimeType.startsWith("image/")).slice(0, 12));
      })
      .catch(() => setPhotos([]));
  };
  const chosen = (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    if (file.size > CHAT_IMAGE_MAX_BYTES) { onNotice(IMAGE_TOO_LARGE); return; }
    onPick({ kind: "file", file, name: file.name || "foto.jpg", previewUrl: URL.createObjectURL(file) });
    setOpen(false);
  };
  const inputs = <>
    <input ref={camera} type="file" accept={CHAT_IMAGE_ACCEPT} capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { chosen(event.target.files); event.target.value = ""; }} data-testid="assistant-image-camera" />
    <input ref={picker} type="file" accept={CHAT_IMAGE_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { chosen(event.target.files); event.target.value = ""; }} data-testid="assistant-image-file" />
  </>;
  if (!support.ready) return <IconButton label="Bifoga en bild" title={support.reason ?? undefined} aria-disabled="true" className="size-10 rounded-full text-muted-foreground opacity-60" disabled={disabled}
    onClick={() => onNotice(`Bilder går inte att använda: ${support.reason ?? "inte påslaget."}`)} data-testid="assistant-image" data-ready="false"><ImagePlus /></IconButton>;
  const row = "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary";
  return <Popover.Root open={open} onOpenChange={openChange}>
    {inputs}
    <Popover.Trigger asChild><IconButton label="Bifoga en bild" className="size-10 rounded-full" disabled={disabled} data-testid="assistant-image" data-ready="true"><ImagePlus /></IconButton></Popover.Trigger>
    <Popover.Portal><Popover.Content side="top" align="start" sideOffset={6} className="z-[70] w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-2 shadow-lg" data-testid="assistant-image-menu">
      <button type="button" className={row} onClick={() => camera.current?.click()} data-testid="assistant-image-take"><Camera className="size-4" />Ta foto</button>
      <button type="button" className={row} onClick={() => picker.current?.click()} data-testid="assistant-image-choose"><Images className="size-4" />Välj bild</button>
      {task?.taskId ? <div className="mt-1 border-t pt-2">
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{task.kind === "WORK_ORDER" ? "Bild från arbetsordern" : "Bild från uppgiften"}</p>
        {photos === null ? <p className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Hämtar…</p>
          : photos.length ? <div className="grid grid-cols-4 gap-1.5 px-1" data-testid="assistant-image-attachments">
            {photos.map((photo) => <button key={photo.id} type="button" className="aspect-square overflow-hidden rounded-md border focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Använd ${photo.filename}`} title={photo.filename}
              onClick={() => { onPick({ kind: "attachment", attachmentId: photo.id, name: photo.filename, previewUrl: `/api/workflow-task-files/${encodeURIComponent(photo.id)}` }); setOpen(false); }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the work order's own photo from Workflow's server */}
              <img src={`/api/workflow-task-files/${encodeURIComponent(photo.id)}`} alt="" loading="lazy" className="size-full object-cover" />
            </button>)}
          </div>
          : <p className="px-2 py-1 text-xs text-muted-foreground">Inga bilder här ännu.</p>}
      </div> : null}
      <p className="mt-1 px-2 pb-1 text-[0.6875rem] leading-4 text-muted-foreground">Bilden läses av Workflow AI och sparas inte i chatten. Platsuppgifter i bilden tas bort först.</p>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

/** The chosen photo above the field, with Ta bort. */
export function ChatImageChip({ image, onRemove }: { image: ChatAttachedImage; onRemove: () => void }) {
  return <div className="mx-auto mb-1.5 flex w-full max-w-3xl items-center gap-2 rounded-xl border bg-card p-1.5 pr-2 text-xs" data-testid="assistant-image-chip">
    {/* eslint-disable-next-line @next/next/no-img-element -- a local preview or the work order's own photo */}
    <img src={image.previewUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" />
    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{image.name}</span><span className="block truncate text-muted-foreground">Workflow AI läser bilden när du skickar.</span></span>
    <IconButton label="Ta bort bilden" size="icon-sm" onClick={onRemove} data-testid="assistant-image-remove"><X /></IconButton>
  </div>;
}

/** The recording format the browser can make, in the order the server reads them best. */
function recordingType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * Mikrofon: record (at most 60 s), stop, and the server turns it into text that goes into the field for the person to check and
 * send. Never sent by itself. The state is plain: "Spelar in 0:12 av 1:00" with a stop button, then "Gör om till text …". Esc on the
 * stop button throws the recording away; closing the chat does too.
 */
function MicButton({ support, onTranscript, onNotice, disabled }: { support: MediaSupport; onTranscript: (text: string) => void; onNotice: (text: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const discard = useRef(false);
  const timer = useRef<number | null>(null);
  const release = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);
  const stop = useCallback((throwAway = false) => {
    discard.current = throwAway;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    release();
  }, [release]);
  // Closing the chat in the middle of a recording throws it away and frees the microphone.
  useEffect(() => () => { discard.current = true; if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop(); release(); }, [release]);

  const send = async (blob: Blob, length: number) => {
    setState("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, "tal");
      form.append("seconds", String(Math.round(length)));
      const response = await fetch("/api/ai/transcribe", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Tal till text svarade inte. Försök igen.");
      if (data.text?.trim()) onTranscript(data.text.trim());
      else onNotice("Inget tal hördes. Försök igen och prata nära telefonen.");
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "Tal till text svarade inte. Försök igen.");
    } finally { setState("idle"); }
  };
  const start = async () => {
    if (!support.ready) { onNotice(`Tal till text går inte att använda: ${support.reason ?? "inte påslaget."}`); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { onNotice("Den här webbläsaren kan inte spela in ljud."); return; }
    let media: MediaStream;
    try { media = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { onNotice("Workflow fick inte använda mikrofonen. Tillåt mikrofonen för sidan i webbläsarens inställningar och försök igen."); return; }
    const type = recordingType();
    const next = new MediaRecorder(media, type ? { mimeType: type, audioBitsPerSecond: 32_000 } : undefined);
    stream.current = media; recorder.current = next; chunks.current = []; discard.current = false;
    next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
    next.onstop = () => {
      const length = (Date.now() - started.current) / 1000;
      const blob = new Blob(chunks.current, { type: next.mimeType || type || "audio/webm" });
      chunks.current = [];
      recorder.current = null;
      if (discard.current || !blob.size) { setState("idle"); return; }
      void send(blob, length);
    };
    started.current = Date.now();
    setSeconds(0);
    next.start(1000);
    setState("recording");
    timer.current = window.setInterval(() => {
      const elapsed = (Date.now() - started.current) / 1000;
      setSeconds(elapsed);
      if (elapsed >= VOICE_MAX_SECONDS) stop();
    }, 250);
  };

  if (state === "recording") return <span className="flex items-center gap-1.5">
    <IconButton label="Stoppa inspelningen" variant="outline" className="size-10 rounded-full border-destructive/50 text-destructive" autoFocus
      onClick={() => stop()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); stop(true); onNotice("Inspelningen togs bort."); } }} data-testid="assistant-mic-stop"><Square className="size-4 fill-current" /></IconButton>
    <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground" data-testid="assistant-mic-state">
      <span className="size-2 animate-pulse rounded-full bg-destructive motion-reduce:animate-none" aria-hidden="true" />
      <span aria-hidden="true">Spelar in {clock(seconds)} av {clock(VOICE_MAX_SECONDS)}</span>
      <span className="sr-only" role="status">Spelar in. Tryck på Stoppa inspelningen när du är klar, högst {VOICE_MAX_SECONDS} sekunder.</span>
    </span>
  </span>;
  if (state === "transcribing") return <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" data-testid="assistant-mic-state">
    <span className="grid size-10 place-items-center"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /></span>Gör om till text …
  </span>;
  return <IconButton label="Tala in ett meddelande" title={support.ready ? `Tala in ett meddelande (högst ${VOICE_MAX_SECONDS} sekunder)` : support.reason ?? undefined}
    aria-disabled={support.ready ? undefined : "true"} className={cn("size-10 rounded-full", !support.ready && "text-muted-foreground opacity-60")} disabled={disabled}
    onClick={() => void start()} data-testid="assistant-mic" data-ready={support.ready ? "true" : "false"}><Mic /></IconButton>;
}

/**
 * The buttons at the field's lower left: Bild, then what the field offers between them (the mode, 2026-11-22), then Mikrofon. Without a
 * status (still loading) only the slot is shown.
 */
export function ChatMediaBar({ media, onPickImage, onTranscript, onNotice, disabled, className, beforeMic }: {
  media: ChatMedia | undefined; onPickImage: (image: ChatAttachedImage) => void; onTranscript: (text: string) => void; onNotice: (text: string) => void; disabled?: boolean; className?: string;
  /** Drawn left of the microphone (the chat's mode picker). */
  beforeMic?: ReactNode;
}) {
  if (!media) return beforeMic ? <div className={cn("flex items-center gap-0.5", className)}>{beforeMic}</div> : null;
  return <div className={cn("flex items-center gap-0.5", className)} data-testid="assistant-media">
    <ImageButton support={media.images} onPick={onPickImage} onNotice={onNotice} disabled={disabled} />
    {beforeMic}
    <MicButton support={media.voice} onTranscript={onTranscript} onNotice={onNotice} disabled={disabled} />
  </div>;
}
