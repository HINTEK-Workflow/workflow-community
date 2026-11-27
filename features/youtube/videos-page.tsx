"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CalendarClock, Clapperboard, ExternalLink, Film, ImagePlus, Plug, Plus, RotateCcw, Save, Send, Trash2, Upload, X } from "lucide-react";
import { PageHeader, SplitPane, SplitPaneNav } from "@/components/page-shell";
import { ListFilterBar } from "@/components/list-filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DisabledReason, disabledReasonProps } from "@/components/ui/disabled-reason";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { DialogActions, Modal, Panel, RowsSkeleton } from "@/features/kfid/ui";
import { DelayedSkeleton } from "@/components/skeleton";
import { ScheduledPanel, useScheduled } from "@/features/schedule/scheduled-list";
import { ScheduleDialog } from "@/features/schedule/schedule-dialog";
import { formatSwedish, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { cn } from "@/lib/utils";
import type { ScheduledView } from "@/lib/schedule/labels";
import {
  filterVideos, parseTags, PRIVACY_OPTIONS, privacyLabel, publishProblem, sizeText, TAGS_MAX_CHARS, tagsLength, THUMBNAIL_MAX_BYTES, TITLE_MAX, uploadPercent,
  VIDEO_FILTERS, VIDEO_STATUS_LABEL, type VideoFilter, type VideoPrivacy, type VideoView,
} from "@/lib/youtube/model";
import { uploadVideoFile, type PieceAnswer } from "@/lib/youtube/piece-upload";

/**
 * Filmer (2026-11-20: "jag vill kunna ladda upp och hantera filmen på samma sätt som inlägg och posta dem på YouTube"): the
 * third tab of Mer › Webb och inlägg. The list to the left with the same search and filter as the company's other lists, the open
 * film to the right: the film file, the cover picture (an own picture or a frame of the film), the title, description, tags,
 * category, playlist, who may see it and YouTube's question about children, and Spara, Schemalägg and Publicera. The film is never
 * edited here. The page never loads anything from YouTube: the cover picture comes from our own server, and the film's link opens
 * YouTube in a new tab.
 */
export const VIDEOS_VIEW = "/?view=company_videos";
const videoHref = (id: string) => `${VIDEOS_VIEW}&video=${encodeURIComponent(id)}`;
const CONNECTIONS = "/?view=advanced&section=web";

type Choice = { id: string; name: string };
type ConnectionInfo = { status: string; statusMessage: string | null; channel: Choice | null; playlists: Choice[]; categories: Choice[]; privateLocked: boolean; publishingApproved: boolean };
type Listing = { videos: VideoView[]; connection: ConnectionInfo; block: string | null; limits: { maxBytes: number } };

const ACCEPT_VIDEO = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm";
const WHEN = { dateStyle: "medium", timeStyle: "short" } as const;

export function VideosPage({ video: chosen }: { video: string | null }) {
  const router = useRouter();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<VideoFilter>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => {
    try { setListing(await api<Listing>("/api/youtube/videos", { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(load);
  const scheduled = useScheduled({ kind: "video" });
  const replace = useCallback((next: VideoView) => setListing((current) => current ? { ...current, videos: current.videos.map((item) => (item.id === next.id ? next : item)) } : current), []);
  const create = async () => {
    setCreating(true);
    try {
      const result = await api<{ video: VideoView }>("/api/youtube/videos", { method: "POST", body: JSON.stringify({ action: "create" }) });
      setListing((current) => current ? { ...current, videos: [result.video, ...current.videos] } : current);
      router.push(videoHref(result.video.id));
    } catch (cause) { setError((cause as Error).message); } finally { setCreating(false); }
  };
  const remove = (id: string) => { setListing((current) => current ? { ...current, videos: current.videos.filter((item) => item.id !== id) } : current); router.push(VIDEOS_VIEW); void scheduled.reload(); };

  const newButton = <Button type="button" onClick={() => void create()} disabled={creating || !listing} data-testid="video-new"><Plus />Ny film</Button>;
  const header = <PageHeader title="Webb och inlägg" description="Färdiga filmer till företagets YouTube-kanal. Inget laddas upp förrän du trycker Publicera eller Schemalägg." actions={newButton} />;
  if (error && !listing) return <div className="space-y-4">{header}<p className="notice text-destructive" role="alert">{error}</p></div>;
  const videos = listing?.videos ?? [];
  const shown = filterVideos(videos, filter, query);
  const open = videos.find((item) => item.id === chosen) ?? null;
  const counts = Object.fromEntries(VIDEO_FILTERS.map((item) => [item.key, item.key === "all" ? videos.length : videos.filter((video) => video.listStatus === item.key).length]));
  const connection = listing?.connection ?? null;
  return <div className="space-y-4" data-testid="videos-page">
    {header}
    {listing?.block ? <div className="notice flex flex-wrap items-center gap-3" data-testid="videos-guard">
      <p className="min-w-0 flex-1">{listing.block} Du kan ändå lägga in filmer och ladda upp filerna.</p>
      <Button type="button" variant="outline" size="sm" asChild><Link href={CONNECTIONS} data-testid="videos-open-connections"><Plug />Öppna Kopplingar</Link></Button>
    </div> : null}
    {connection?.privateLocked ? <div className="notice" role="status" data-testid="videos-private-locked">
      <p>YouTube gör filmerna privata tills Google har granskat företagets API-projekt. När granskningen är klar kan du ändra vem som får se varje film här.</p>
    </div> : null}
    <ScheduledPanel items={scheduled.items} error={scheduled.error} filter={{ kind: "video" }} empty="Ingen film är schemalagd." testId="videos-scheduled"
      onChanged={async () => { await scheduled.reload(); await load(); }} />
    <ListFilterBar testId="videos-filter" label="Sök och filtrera filmer"
      chips={{ label: "Visa filmer", value: filter, onChange: setFilter, testId: "videos-chips", chips: VIDEO_FILTERS.map((item) => ({ value: item.key, label: item.label, count: listing ? counts[item.key] ?? 0 : null })) }}
      search={{ label: "Sök film", placeholder: "Sök på titel, beskrivning eller tagg", value: query, onChange: setQuery, testId: "videos-search" }} />
    {!listing ? <DelayedSkeleton><div className="rounded-lg border bg-card px-3.5 py-3"><RowsSkeleton rows={4} label="Hämtar filmerna…" /></div></DelayedSkeleton> : <SplitPane chosen={Boolean(open)} testId="videos-split" list={shown.length
      ? <SplitPaneNav label="Filmer" area="tools" items={shown.map((item) => ({
        href: videoHref(item.id), title: item.title.trim() || "Utan titel", icon: Film, testId: `video-row-${item.id}`, current: item.id === open?.id,
        status: { label: VIDEO_STATUS_LABEL[item.listStatus].label, tone: VIDEO_STATUS_LABEL[item.listStatus].tone,
          detail: [item.youtube ? privacyLabel(item.youtube.privacy) : null, item.status === "uploading" && item.upload ? `${uploadPercent(item.upload.sent, item.upload.total)} %` : null, formatSwedish(item.publishedAt ?? item.createdAt, { dateStyle: "medium" })].filter(Boolean).join(" · ") },
      }))} />
      : <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground" data-testid="videos-empty">{videos.length ? "Ingen film matchar sökningen." : "Inga filmer ännu. Tryck Ny film och välj en färdig filmfil."}</div>}>
      {open && connection ? <VideoEditor key={open.id} video={open} connection={connection} block={listing.block} maxBytes={listing.limits.maxBytes} onSaved={replace} onRemoved={remove}
        scheduled={scheduled.items?.find((item) => item.targetId === open.id && ["scheduled", "needs_approval", "running"].includes(item.status)) ?? null}
        onScheduleChanged={async () => { await scheduled.reload(); await load(); }} />
        : <div className="hidden rounded-lg border border-dashed p-6 text-sm text-muted-foreground md:block">Välj en film i listan.</div>}
    </SplitPane>}
  </div>;
}

type Draft = { title: string; description: string; tags: string; categoryId: string; privacy: VideoPrivacy; madeForKids: boolean | null; playlistId: string };
const draftOf = (video: VideoView): Draft => ({ title: video.title, description: video.description, tags: video.tags.join(", "), categoryId: video.categoryId ?? "", privacy: video.privacy, madeForKids: video.madeForKids, playlistId: video.playlistId ?? "" });
const same = (left: Draft, right: Draft) => JSON.stringify(left) === JSON.stringify(right);

function VideoEditor({ video, connection, block, maxBytes, onSaved, onRemoved, scheduled, onScheduleChanged }: {
  video: VideoView; connection: ConnectionInfo; block: string | null; maxBytes: number; onSaved: (video: VideoView) => void; onRemoved: (id: string) => void;
  scheduled: ScheduledView | null; onScheduleChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(video));
  const [saved, setSaved] = useState<Draft>(() => draftOf(video));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [sending, setSending] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [framing, setFraming] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const [confirm, confirmElement] = useConfirm();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = !same(draft, saved);
  const uploading = video.status === "uploading";
  const published = video.status === "published" && Boolean(video.youtube);
  const tags = parseTags(draft.tags);

  // While the server uploads the film to YouTube: its progress every three seconds.
  const savedRef = useRef(onSaved);
  useEffect(() => { savedRef.current = onSaved; });
  useEffect(() => {
    if (!uploading) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try { const answer = await api<{ video: VideoView }>(`/api/youtube/videos?id=${encodeURIComponent(video.id)}`, { cache: "no-store" }); if (!stopped) savedRef.current(answer.video); }
      catch { /* asked again in a moment */ }
    }, 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [uploading, video.id]);
  useEffect(() => () => { stopRef.current = true; }, []);

  const body = () => ({ title: draft.title, description: draft.description, tags, categoryId: draft.categoryId || null, privacy: draft.privacy, madeForKids: draft.madeForKids, playlistId: draft.playlistId || null });
  const save = async (): Promise<VideoView | null> => {
    setBusy(true); setMessage(null);
    try {
      const answer = await api<{ video: VideoView }>("/api/youtube/videos", { method: "POST", body: JSON.stringify({ action: "update", id: video.id, ...body() }) });
      onSaved(answer.video); setSaved(draftOf(answer.video)); setDraft(draftOf(answer.video));
      setMessage({ text: published ? "Sparat och ändrat på YouTube." : "Sparat." });
      return answer.video;
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); return null; } finally { setBusy(false); }
  };
  const act = async (input: Record<string, unknown>, done: string) => {
    setBusy(true); setMessage(null);
    try { const answer = await api<{ video: VideoView }>("/api/youtube/videos", { method: "POST", body: JSON.stringify({ id: video.id, ...input }) }); onSaved(answer.video); setMessage({ text: done }); return answer.video; }
    catch (cause) { setMessage({ text: (cause as Error).message, error: true }); return null; } finally { setBusy(false); }
  };

  const chooseFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > maxBytes) { setMessage({ text: `Filmen är ${sizeText(file.size)}. Den får vara högst ${sizeText(maxBytes)}.`, error: true }); return; }
    setLocalFile(file); setMessage(null); setSending(0); setNotice(""); stopRef.current = false;
    try {
      const next = await uploadVideoFile(video.id, file, { request: (url, init) => api<PieceAnswer>(url, init, { change: false }) },
        { progress: (share) => setSending(share), notice: setNotice, stopped: () => stopRef.current });
      onSaved(next); setMessage({ text: `Filmfilen är uppladdad till Workflow (${sizeText(file.size)}).` });
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); } finally { setSending(null); setNotice(""); }
  };
  const uploadThumbnail = async (blob: Blob, source: "own" | "frame") => {
    if (blob.size > THUMBNAIL_MAX_BYTES) { setMessage({ text: "Omslagsbilden får vara högst 2 MB.", error: true }); return; }
    setBusy(true); setMessage(null);
    try {
      const form = new FormData();
      form.set("kind", "thumbnail"); form.set("id", video.id); form.set("source", source); form.set("file", new File([blob], source === "frame" ? "bildruta.jpg" : "omslag", { type: blob.type }));
      const answer = await api<{ video: VideoView }>("/api/youtube/videos", { method: "POST", body: form });
      onSaved(answer.video); setMessage({ text: published ? "Omslagsbilden är bytt, också på YouTube." : "Omslagsbilden är sparad." });
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); } finally { setBusy(false); }
  };

  const problem = publishProblem({ title: draft.title, description: draft.description, tags, fileReady: video.file.ready, madeForKids: draft.madeForKids, privacy: draft.privacy, categoryId: draft.categoryId || null });
  const publishReason = uploading ? "Filmen laddas upp just nu." : published ? "Filmen finns redan på YouTube." : sending !== null ? "Vänta tills filmfilen är uppladdad." : block ?? problem;
  const publish = async () => {
    const ok = await confirm({ title: "Publicera på YouTube?", message: `Filmen laddas upp till kanalen ${connection.channel?.name ?? ""} som ${privacyLabel(draft.privacy).toLowerCase()}. Uppladdningen sker på servern och fortsätter även om du stänger sidan.${connection.privateLocked && draft.privacy !== "private" ? " YouTube gör den privat tills Google har granskat API-projektet." : ""}`,
      confirmLabel: "Publicera", checkbox: { label: "Jag har läst titeln och beskrivningen och tittat på omslagsbilden.", required: true, testId: "video-publish-check" } });
    if (!ok) return;
    if (dirty && !(await save())) return;
    await act({ action: "publish", confirm: true }, "Filmen laddas upp till YouTube.");
    await onScheduleChanged();
  };
  const schedule = async (at: string) => {
    setScheduleError(null); setBusy(true);
    try {
      if (dirty && !(await save())) { setScheduleError("Filmen kunde inte sparas."); return; }
      await api("/api/schedule", { method: "POST", body: JSON.stringify({ action: "schedule-video", videoId: video.id, at, confirm: true }) });
      setScheduling(false); setMessage({ text: "Filmen är schemalagd." });
      await onScheduleChanged();
    } catch (cause) { setScheduleError((cause as Error).message); } finally { setBusy(false); }
  };
  const cancelUpload = async () => {
    if (await confirm({ title: "Avbryta uppladdningen?", message: "Filmen blir ett utkast igen. Det YouTube redan har fått publiceras inte.", confirmLabel: "Avbryt uppladdningen", cancelLabel: "Fortsätt" }))
      await act({ action: "cancel-upload" }, "Uppladdningen är avbruten.");
  };
  const removeFromYouTube = async () => {
    if (await confirm({ title: "Ta bort från YouTube?", message: "Filmen tas bort från kanalen, med sina visningar och kommentarer. Det går inte att ångra. Filmen och filen finns kvar här i Workflow.", confirmLabel: "Ta bort från YouTube", tone: "danger",
      checkbox: { label: "Jag förstår att filmen försvinner från YouTube.", required: true, testId: "video-remove-youtube-check" } }))
      await act({ action: "remove-youtube", confirm: true }, "Filmen är borttagen från YouTube.");
  };
  const remove = async () => {
    if (!(await confirm({ title: "Ta bort filmen ur Workflow?", message: `Filmen och filmfilen tas bort ur Workflow.${video.youtube ? " På YouTube ligger den kvar." : ""}`, confirmLabel: "Ta bort", tone: "danger" }))) return;
    setBusy(true);
    try { await api("/api/youtube/videos", { method: "POST", body: JSON.stringify({ action: "delete", id: video.id }) }); onRemoved(video.id); }
    catch (cause) { setMessage({ text: (cause as Error).message, error: true }); setBusy(false); }
  };

  const sent = video.upload ? uploadPercent(video.upload.sent, video.upload.total) : 0;
  const thumbnailUrl = video.thumbnail ? `/api/youtube/videos?thumbnail=${encodeURIComponent(video.id)}&v=${encodeURIComponent(video.thumbnail.version ?? "")}` : null;
  return <div className="space-y-4" data-testid="video-editor">
    {confirmElement}
    <div className="flex flex-wrap items-center justify-end gap-2" data-testid="video-actions">
      {uploading ? <Button type="button" variant="outline" disabled={busy} onClick={() => void cancelUpload()} data-testid="video-cancel-upload"><Ban />Avbryt uppladdningen</Button> : <>
        <Button type="button" variant="ghost" className="text-destructive" disabled={busy || sending !== null} onClick={() => void remove()} data-testid="video-delete"><Trash2 />Ta bort</Button>
        <Button type="button" variant="outline" disabled={busy || !dirty} onClick={() => void save()} data-testid="video-save"><Save />{published ? "Spara på YouTube" : "Spara"}</Button>
        {!published ? <>
          <Button type="button" variant="outline" {...disabledReasonProps({ reason: busy ? null : publishReason, describedBy: "video-publish-reason", onClick: () => { setScheduleError(null); setScheduling(true); } })} disabled={busy} data-testid="video-schedule"><CalendarClock />Schemalägg</Button>
          {video.status === "failed" ? <Button type="button" variant="outline" disabled={busy || Boolean(block)} onClick={() => void act({ action: "retry" }, "Uppladdningen försöker igen.")} data-testid="video-retry"><RotateCcw />Försök igen</Button> : null}
          <Button type="button" {...disabledReasonProps({ reason: busy ? null : publishReason, describedBy: "video-publish-reason", onClick: () => void publish() })} disabled={busy} data-testid="video-publish"><Send />Publicera</Button>
        </> : null}
      </>}
    </div>
    {!uploading && !published ? <DisabledReason id="video-publish-reason" reason={publishReason} className="text-right" /> : null}
    <ScheduleDialog open={scheduling} title="Schemalägg filmen" text={`Filmen laddas upp till YouTube vid den tid du väljer, precis som den ser ut nu. Ändrar du den efteråt måste ändringen godkännas igen.${scheduled ? ` Det ersätter tiden ${formatSwedish(scheduled.runAt, WHEN)}.` : ""}`}
      check="Jag har läst titeln och beskrivningen och tittat på omslagsbilden." busy={busy} error={scheduleError} initial={scheduled ? toSwedishDateTimeInput(scheduled.runAt) : null}
      onCancel={() => setScheduling(false)} onConfirm={(at) => void schedule(at)} testId="video-schedule-dialog" />
    {message ? <p className={cn("notice", message.error && "text-destructive")} role="status" data-testid="video-message">{message.text}</p> : null}
    {scheduled ? <p className="text-xs text-muted-foreground" data-testid="video-scheduled">{scheduled.status === "needs_approval" ? "Ändrad efter schemaläggningen – godkänn under Schemalagt" : "Schemalagd"} till {formatSwedish(scheduled.runAt, WHEN)}.</p> : null}

    {uploading || video.status === "failed" ? <Panel title={uploading ? "Laddas upp till YouTube" : "Uppladdningen misslyckades"}>
      <div className="space-y-2" data-testid="video-upload-progress">
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={sent} aria-label="Uppladdat till YouTube">
          <div className={cn("h-full rounded-full", video.status === "failed" ? "bg-destructive" : "bg-primary")} style={{ width: `${sent}%` }} />
        </div>
        <p className="text-sm" data-testid="video-upload-state">{sent} % av {sizeText(video.upload?.total ?? 0)}.{uploading ? " Uppladdningen sker på servern, så du kan stänga sidan." : ""}</p>
        {video.upload?.error ? <p className={cn("text-sm", video.status === "failed" ? "text-destructive" : "text-muted-foreground")} data-testid="video-upload-error">{video.upload.error}</p> : null}
      </div>
    </Panel> : null}

    {published && video.youtube ? <Panel title="På YouTube">
      <div className="space-y-2 text-sm" data-testid="video-on-youtube">
        <p>Publicerad {video.publishedAt ? formatSwedish(video.publishedAt, WHEN) : ""} som {privacyLabel(video.youtube.privacy).toLowerCase()}.</p>
        {video.youtube.lockedPrivate ? <p className="text-muted-foreground" data-testid="video-locked-private">Du valde {privacyLabel(video.privacy).toLowerCase()}, men YouTube håller filmen privat tills Google har granskat API-projektet.</p> : null}
        {video.upload?.error ? <p className="text-muted-foreground" data-testid="video-steps-note">{video.upload.error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" asChild><a href={video.youtube.url} target="_blank" rel="noopener noreferrer" data-testid="video-open-youtube"><ExternalLink />Öppna på YouTube</a></Button>
          <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => void removeFromYouTube()} data-testid="video-remove-youtube"><X />Ta bort från YouTube</Button>
        </div>
        <p className="text-xs text-muted-foreground">Ändrar du titel, beskrivning, taggar, kategori, vem som får se filmen eller omslagsbilden och trycker Spara på YouTube, ändras filmen där direkt.</p>
      </div>
    </Panel> : null}

    <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Panel title="Filmfilen" description="En färdig film i formatet MP4, MOV eller WebM. Den laddas upp till Workflow först och därifrån till YouTube.">
          <div className="space-y-3" data-testid="video-file">
            {video.file.ready ? <p className="text-sm" data-testid="video-file-ready"><Clapperboard className="mr-1.5 inline size-4 align-[-3px]" aria-hidden="true" />{video.file.name ?? "Filmen"} · {sizeText(video.file.size ?? 0)}</p>
              : <p className="text-sm text-muted-foreground">Ingen filmfil ännu. Den får vara högst {sizeText(maxBytes)}.</p>}
            {sending !== null ? <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sending * 100)} aria-label="Uppladdat till Workflow"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(sending * 100)}%` }} /></div>
              <p className="text-xs text-muted-foreground" data-testid="video-file-progress">{Math.round(sending * 100)} % uppladdat. Låt sidan vara öppen tills filen är uppladdad.</p>
              {notice ? <p className="text-xs text-muted-foreground" role="status" data-testid="video-file-notice">{notice}</p> : null}
            </div> : null}
            {!video.youtube && !uploading ? <label className={cn("inline-flex", (busy || sending !== null) && "pointer-events-none opacity-60")}>
              <input type="file" accept={ACCEPT_VIDEO} className="sr-only" disabled={busy || sending !== null} onChange={(event) => { void chooseFile(event.target.files?.[0] ?? null); event.target.value = ""; }} data-testid="video-file-input" />
              <span className="inline-flex h-[var(--control-h)] cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-[var(--surface-hover)]"><Upload className="size-4" aria-hidden="true" />{video.file.ready ? "Byt filmfil" : "Välj filmfil"}</span>
            </label> : null}
          </div>
        </Panel>
        <Panel title="Omslagsbild" description="Visas på YouTube innan filmen spelas. En egen bild eller en bildruta ur filmen, JPEG eller PNG, högst 2 MB.">
          <div className="space-y-3" data-testid="video-thumbnail">
            {/* eslint-disable-next-line @next/next/no-img-element -- the film's own cover picture from the app's own server. */}
            {thumbnailUrl ? <img src={thumbnailUrl} alt="Omslagsbilden" className="aspect-video w-full max-w-md rounded-md border object-cover" data-testid="video-thumbnail-image" />
              : <div className="flex aspect-video w-full max-w-md items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">Ingen omslagsbild. YouTube väljer då en bildruta själv.</div>}
            <div className="flex flex-wrap gap-2">
              <label className={cn("inline-flex", (busy || uploading) && "pointer-events-none opacity-60")}>
                <input type="file" accept="image/jpeg,image/png" className="sr-only" disabled={busy || uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadThumbnail(file, "own"); event.target.value = ""; }} data-testid="video-thumbnail-input" />
                <span className="inline-flex h-[var(--control-h)] cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-[var(--surface-hover)]"><ImagePlus className="size-4" aria-hidden="true" />Ladda upp bild</span>
              </label>
              <Button type="button" variant="outline" disabled={busy || uploading} onClick={() => setFraming(true)} data-testid="video-frame"><Film />Välj bildruta</Button>
              {video.thumbnail ? <Button type="button" variant="ghost" className="text-destructive" disabled={busy || uploading} onClick={() => void act({ action: "thumbnail-remove" }, "Omslagsbilden är borttagen.")} data-testid="video-thumbnail-remove"><Trash2 />Ta bort bilden</Button> : null}
            </div>
          </div>
        </Panel>
        <FrameDialog open={framing} file={localFile} onFile={setLocalFile} onClose={() => setFraming(false)} onChosen={async (blob) => { setFraming(false); await uploadThumbnail(blob, "frame"); }} />
      </div>
      <Panel title="Om filmen" description="Det som står på YouTube.">
        <fieldset disabled={uploading} className="space-y-3">
          <div className="field-stack"><div className="flex items-center justify-between gap-2"><label htmlFor="video-title" className="text-xs font-medium">Titel</label>
            <span className={cn("text-xs tabular-nums", draft.title.length > TITLE_MAX ? "text-destructive" : "text-muted-foreground")}>{draft.title.length}/{TITLE_MAX}</span></div>
            <Input id="video-title" value={draft.title} maxLength={TITLE_MAX + 20} onChange={(event) => set("title", event.target.value)} data-testid="video-title" /></div>
          <div className="field-stack"><label htmlFor="video-description" className="text-xs font-medium">Beskrivning</label>
            <textarea id="video-description" className="form-textarea min-h-32" value={draft.description} maxLength={5000} onChange={(event) => set("description", event.target.value)} data-testid="video-description" />
            <p className="text-xs text-muted-foreground">Länkar i beskrivningen blir klickbara på YouTube.</p></div>
          <div className="field-stack"><div className="flex items-center justify-between gap-2"><label htmlFor="video-tags" className="text-xs font-medium">Taggar</label>
            <span className={cn("text-xs tabular-nums", tagsLength(tags) > TAGS_MAX_CHARS ? "text-destructive" : "text-muted-foreground")}>{tagsLength(tags)}/{TAGS_MAX_CHARS}</span></div>
            <Input id="video-tags" value={draft.tags} placeholder="elinstallation, laddbox, solceller" onChange={(event) => set("tags", event.target.value)} aria-describedby="video-tags-help" data-testid="video-tags" />
            <p id="video-tags-help" className="text-xs text-muted-foreground">Skilj taggarna åt med komma. De hjälper YouTube att visa filmen för rätt personer.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field-stack"><label htmlFor="video-category" className="text-xs font-medium">Kategori</label>
              <select id="video-category" className="form-select" value={draft.categoryId} onChange={(event) => set("categoryId", event.target.value)} data-testid="video-category">
                <option value="">Personer och bloggar (standard)</option>
                {connection.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></div>
            <div className="field-stack"><label htmlFor="video-playlist" className="text-xs font-medium">Spellista</label>
              <select id="video-playlist" className="form-select" value={draft.playlistId} onChange={(event) => set("playlistId", event.target.value)} data-testid="video-playlist">
                <option value="">Ingen spellista</option>
                {connection.playlists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {!connection.playlists.length ? <p className="text-xs text-muted-foreground">Kanalen har inga spellistor. Skapa en på YouTube och tryck Kontrollera under Kopplingar.</p> : null}</div>
          </div>
          <fieldset className="field-stack" data-testid="video-privacy">
            <legend className="text-xs font-medium">Vem får se filmen</legend>
            {PRIVACY_OPTIONS.map((option) => <label key={option.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-[var(--surface-hover)]">
              <input type="radio" name={`video-privacy-${video.id}`} value={option.key} checked={draft.privacy === option.key} onChange={() => set("privacy", option.key)} className="size-4 accent-[var(--primary)]" data-testid={`video-privacy-${option.key}`} />
              <span className="min-w-0"><span className="block text-sm font-medium">{option.label}</span><span className="block text-xs text-muted-foreground">{option.hint}</span></span>
            </label>)}
          </fieldset>
          <fieldset className="field-stack" data-testid="video-kids">
            <legend className="text-xs font-medium">Är filmen gjord för barn?</legend>
            <p className="text-xs text-muted-foreground">YouTube kräver svaret. En film för barn får till exempel inga kommentarer.</p>
            <div className="flex flex-wrap gap-x-6">
              {([[false, "Nej, den är inte gjord för barn"], [true, "Ja, den är gjord för barn"]] as const).map(([value, label]) => <label key={String(value)} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name={`video-kids-${video.id}`} checked={draft.madeForKids === value} onChange={() => set("madeForKids", value)} className="size-4 accent-[var(--primary)]" data-testid={`video-kids-${value ? "yes" : "no"}`} />{label}</label>)}
            </div>
          </fieldset>
        </fieldset>
      </Panel>
    </div>
  </div>;
}

/**
 * Välj bildruta: the film file from this computer in the browser's own player (a blob address, nothing leaves the browser), a
 * slider for the moment, and the frame drawn as a JPEG of at most 1280 × 720 that is uploaded as the cover picture.
 */
function FrameDialog({ open, file, onFile, onClose, onChosen }: { open: boolean; file: File | null; onFile: (file: File) => void; onClose: () => void; onChosen: (blob: Blob) => void | Promise<void> }) {
  const [src, setSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [at, setAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const player = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!file || !open) return;
    const url = URL.createObjectURL(file);
    const timer = window.setTimeout(() => { setSrc(url); setError(null); }, 0);
    return () => { window.clearTimeout(timer); URL.revokeObjectURL(url); setSrc(null); };
  }, [file, open]);
  const take = () => {
    const element = player.current;
    if (!element || !element.videoWidth) { setError("Bildrutan kunde inte läsas. Pröva en annan tidpunkt."); return; }
    const scale = Math.min(1, 1280 / element.videoWidth, 720 / element.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(element.videoWidth * scale); canvas.height = Math.round(element.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => { if (blob) void onChosen(blob); else setError("Bildrutan kunde inte sparas."); }, "image/jpeg", 0.85);
  };
  return <Modal open={open} onOpenChange={(next) => { if (!next) onClose(); }} title="Välj bildruta" size="compact" nativeScreen>
    <div className="space-y-3" data-testid="video-frame-dialog">
      {!file ? <>
        <p className="text-sm text-muted-foreground">Välj filmfilen på din dator. Den visas bara här i webbläsaren och laddas inte upp igen.</p>
        <label className="inline-flex"><input type="file" accept={ACCEPT_VIDEO} className="sr-only" onChange={(event) => { const chosen = event.target.files?.[0]; if (chosen) onFile(chosen); }} data-testid="video-frame-file" />
          <span className="inline-flex h-[var(--control-h)] cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-[var(--surface-hover)]"><Upload className="size-4" aria-hidden="true" />Välj filmfil</span></label>
      </> : <>
        {src ? <video ref={player} src={src} muted playsInline preload="auto" className="aspect-video w-full rounded-md border bg-black object-contain" onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration || 0); event.currentTarget.currentTime = Math.min(1, (event.currentTarget.duration || 0) / 2); }} data-testid="video-frame-player" /> : null}
        <div className="field-stack"><label htmlFor="video-frame-at" className="text-xs font-medium">Tidpunkt</label>
          <input id="video-frame-at" type="range" min={0} max={Math.max(0, duration)} step={0.1} value={at} onChange={(event) => { const value = Number(event.target.value); setAt(value); if (player.current) player.current.currentTime = value; }} className="w-full accent-[var(--primary)]" data-testid="video-frame-at" />
          <p className="text-xs text-muted-foreground tabular-nums">{at.toFixed(1).replace(".", ",")} s av {duration.toFixed(0)} s</p></div>
      </>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Använd bildrutan", icon: <ImagePlus />, onClick: take, disabledReason: !file || !src ? "Välj filmfilen först." : null, testId: "video-frame-use" }} />
    </div>
  </Modal>;
}
