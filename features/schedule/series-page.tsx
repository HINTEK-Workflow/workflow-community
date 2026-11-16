"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarRange, Eye, Layers, ListChecks, Repeat, Sparkles, Trash2 } from "lucide-react";
import { PageBackButton, PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Field, Panel } from "@/features/kfid/ui";
import { HashtagField } from "@/features/meta/hashtag-field";
import { PostLookFields, type LogoAvailability, type PostLook } from "@/features/meta/post-look-fields";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import type { LinkedInView } from "@/lib/linkedin/server";
import type { MetaView } from "@/lib/meta/server";
import { BODY_MAX, HEADING_MAX } from "@/lib/meta/text";
import type { SeriesView } from "@/lib/schedule/series-server";
import { SCHEDULE_STATUS_LABEL, type ScheduleStatus } from "@/lib/schedule/labels";
import { SERIES_PARTS_DEFAULT, SERIES_PARTS_MAX, SERIES_PARTS_MIN, seriesClashes, seriesCount, seriesProblem, seriesTimes, type SeriesPart } from "@/lib/schedule/post-series";
import { DEFAULT_RHYTHM, rhythmText, scheduleSentence, scheduleTimeProblem, type Rhythm } from "@/lib/schedule/rhythm";
import { WEEKDAY_SHORT } from "@/lib/schedule/series";
import { SERIES_THEMES } from "@/lib/schedule/themes";
import { formatSwedish, fromSwedishDateTimeInput, swedishDayKey, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { cn } from "@/lib/utils";
import { RhythmDialog } from "./scheduled-list";

/**
 * Ny serie (2026-11-13, replaces the theme series of 2026-11-11 for new series): a number of ordinary posts that share a
 * template, a logo, hashtags and channels, each part with its own Rubrik, Kort text and Text. The times follow the company's
 * publishing rhythm from the next free slot (Monday, Wednesday and Friday at 08:00: twelve parts are about a month), and each can be
 * changed before saving; a time within an hour of another post is pointed out. Schemalägg with the read-through tick makes the
 * drafts and schedules each exactly as Schemalägg does for one post – every part is then its own post and item (Ändra tid, Avbryt,
 * Publicera nu) and can be edited, moved or removed on its own. No AI. Series made before (themes, a queue) still open below.
 */
const POSTS_VIEW = "/?view=company_posts";
const seriesHref = (id: string) => `${POSTS_VIEW}&series=${encodeURIComponent(id)}`;
const postHref = (id: string) => `${POSTS_VIEW}&post=${encodeURIComponent(id)}`;
const WHEN = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } as const;
const themeOptions = SERIES_THEMES.map((theme) => theme.id);
const themeLabels = Object.fromEntries(SERIES_THEMES.map((theme) => [theme.id, theme.title]));

export function SeriesPage({ id, connection, linkedin = null, logos = null, onChanged }: { id: string; connection: MetaView | null; linkedin?: LinkedInView | null; logos?: LogoAvailability | null; onChanged: () => Promise<void> }) {
  return id === "new" ? <NewSeries connection={connection} linkedin={linkedin} logos={logos} onChanged={onChanged} /> : <OpenSeries id={id} onChanged={onChanged} />;
}

type PartText = Omit<SeriesPart, "at">;
const blankPart: PartText = { heading: "", body: "", caption: "" };

/** The picture of one part as the server draws it, asked again a moment after typing stops. */
function usePartPicture(input: { heading: string; body: string } & PostLook) {
  const [url, setUrl] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const key = JSON.stringify({ heading: input.heading, body: input.body, template: input.template, logoVariant: input.logoVariant, logoSize: input.logoSize, logoPlate: input.logoPlate });
  useEffect(() => {
    let stopped = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/meta/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", ...JSON.parse(key) }) });
        if (!response.ok || stopped) return;
        const next = URL.createObjectURL(await response.blob());
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = next;
        setUrl(next);
      } catch { /* the preview waits for the next change */ }
    }, 450);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [key]);
  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current); }, []);
  return url;
}

function NewSeries({ connection, linkedin, logos, onChanged }: { connection: MetaView | null; linkedin: LinkedInView | null; logos: LogoAvailability | null; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [name, setName] = useState(() => `Serie ${formatSwedish(new Date(), { month: "long" })}`);
  const [countText, setCountText] = useState(String(SERIES_PARTS_DEFAULT));
  const count = seriesCount(countText);
  const [look, setLook] = useState<PostLook>({ template: "color", logoVariant: "auto", logoSize: "medium", logoPlate: "box" });
  const [hashtags, setHashtags] = useState("");
  const [channels, setChannels] = useState(() => ({ toFacebook: true, toInstagram: Boolean(connection?.instagram), toLinkedIn: false }));
  // Every possible part is kept, so a smaller count and then a larger one gives the texts back; the first `count` are the series.
  const [texts, setTexts] = useState<PartText[]>(() => Array.from({ length: SERIES_PARTS_MAX }, () => ({ ...blankPart })));
  // A time the person changed by hand; the others follow the rhythm.
  const [chosenTimes, setChosenTimes] = useState<Record<number, string>>({});
  const [fromDay, setFromDay] = useState(() => swedishDayKey(new Date()));
  const [plan, setPlan] = useState<{ rhythm: Rhythm; taken: string[] } | null>(null);
  const [editingRhythm, setEditingRhythm] = useState(false);
  const [shownPart, setShown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const loadPlan = useCallback(async () => {
    try { setPlan(await api<{ rhythm: Rhythm; taken: string[] }>("/api/schedule?plan=1", { cache: "no-store" })); } catch { setPlan({ rhythm: DEFAULT_RHYTHM, taken: [] }); }
  }, []);
  useLoadEffect(loadPlan);
  const [earlier, setEarlier] = useState<{ id: string; name: string; startDay: string; endDay: string; items: number }[] | null>(null);
  const loadEarlier = useCallback(async () => {
    try { setEarlier((await api<{ series: { id: string; name: string; startDay: string; endDay: string; items: number }[] }>("/api/schedule?series=all", { cache: "no-store" })).series); } catch { setEarlier([]); }
  }, []);
  useLoadEffect(loadEarlier);


  const rhythm = plan?.rhythm ?? DEFAULT_RHYTHM;
  const taken = useMemo(() => (plan?.taken ?? []).map((value) => new Date(value)), [plan]);
  const suggested = useMemo(() => seriesTimes(count, rhythm, { taken, fromDay }), [count, rhythm, taken, fromDay]);
  const shown = Math.min(shownPart, count - 1);
  const parts: SeriesPart[] = texts.slice(0, count).map((text, index) => ({ ...text, at: chosenTimes[index] ?? (suggested[index] ? toSwedishDateTimeInput(suggested[index]) : "") }));
  const times = parts.map((part) => (scheduleTimeProblem(part.at) ? null : fromSwedishDateTimeInput(part.at)));
  const clashes = seriesClashes(times, taken);
  const shared = { ...look, hashtags, ...channels };
  const problem = seriesProblem(shared, parts);
  const reason = !plan ? "Hämtar tiderna…" : problem?.message ?? null;
  const setText = (index: number, patch: Partial<PartText>) => setTexts((current) => current.map((text, at) => (at === index ? { ...text, ...patch } : text)));
  const metaOff = !connection || connection.status === "missing" || !connection.page;
  const linkedInOff = !linkedin?.connected || !linkedin.author;
  const picture = usePartPicture({ heading: parts[shown]?.heading || "Rubrik", body: parts[shown]?.body ?? "", ...look });

  const schedule = async () => {
    if (problem) return;
    if (!(await confirm({ title: "Schemalägga serien?", message: `${parts.length} inlägg skapas och publiceras var och ett på sin tid, precis som de ser ut nu. Du kan ändra, flytta eller ta bort vart och ett efteråt.`,
      confirmLabel: "Schemalägg", checkbox: { label: "Jag har läst texterna och tittat på bilderna.", required: true, testId: "series-check" } }))) return;
    setBusy(true); setMessage(null);
    try {
      const answer = await api<{ seriesId: string; scheduled: number; skipped: string[] }>("/api/schedule", { method: "POST", body: JSON.stringify({ action: "series-posts", confirm: true, name, ...shared, parts }) });
      await onChanged();
      router.push(seriesHref(answer.seriesId));
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); await loadPlan(); setBusy(false); }
  };

  return <div className="space-y-4" data-testid="series-new">
    {confirmElement}
    <RhythmDialog open={editingRhythm} rhythm={rhythm} onClose={() => setEditingRhythm(false)} onSaved={(next) => { setEditingRhythm(false); setPlan((current) => ({ rhythm: next, taken: current?.taken ?? [] })); }} />
    <PageHeader title="Ny serie" description="Flera inlägg med samma mall, logotyp, hashtaggar och kanaler. Tiderna följer er rytm. Inget publiceras förrän du schemalägger."
      actions={<>
        <PageBackButton href={POSTS_VIEW} label="Inlägg" testId="series-back" />
        <Button type="button" disabled={busy || Boolean(reason)} disabledReason={busy ? null : reason} onClick={() => void schedule()} data-testid="series-create"><CalendarCheck />{busy ? "Schemalägger…" : `Schemalägg ${count}`}</Button>
      </>} />
    {message ? <p className={cn("notice", message.error && "text-destructive")} role="status" data-testid="series-message">{message.text}</p> : null}
    <Panel icon={Layers} title="Gemensamt" description="Gäller alla delar.">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="series-name" label="Namn" value={name} onChange={setName} />
          <Field id="series-count" label="Antal delar" type="number" value={countText} onChange={setCountText} help={`${SERIES_PARTS_MIN}–${SERIES_PARTS_MAX}. Med tre dagar i veckan blir ${SERIES_PARTS_DEFAULT} delar ungefär en månad.`} />
        </div>
        <PostLookFields prefix="series" logos={logos} value={look} onChange={setLook} />
        <HashtagField id="series-hashtags" value={hashtags} onChange={setHashtags} />
        <div className="flex flex-wrap gap-x-6 gap-y-2" data-testid="series-channels">
          <label className={cn("flex min-h-11 cursor-pointer items-center gap-2 text-sm", metaOff && !channels.toFacebook && "text-muted-foreground")}><Checkbox checked={channels.toFacebook} disabled={metaOff && !channels.toFacebook} onCheckedChange={(value) => setChannels((current) => ({ ...current, toFacebook: value === true }))} data-testid="series-to-facebook" />Facebook{connection?.page ? ` (${connection.page.name})` : ""}</label>
          <label className={cn("flex min-h-11 cursor-pointer items-center gap-2 text-sm", !connection?.instagram && "text-muted-foreground")}><Checkbox checked={channels.toInstagram} disabled={!connection?.instagram && !channels.toInstagram} onCheckedChange={(value) => setChannels((current) => ({ ...current, toInstagram: value === true }))} data-testid="series-to-instagram" />Instagram{connection?.instagram?.username ? ` (@${connection.instagram.username})` : ""}</label>
          <label className={cn("flex min-h-11 cursor-pointer items-center gap-2 text-sm", linkedInOff && !channels.toLinkedIn && "text-muted-foreground")}><Checkbox checked={channels.toLinkedIn} disabled={linkedInOff && !channels.toLinkedIn} onCheckedChange={(value) => setChannels((current) => ({ ...current, toLinkedIn: value === true }))} data-testid="series-to-linkedin" />LinkedIn{linkedin?.author ? ` (${linkedin.author.name})` : ""}</label>
        </div>
      </div>
    </Panel>
    <Panel icon={Repeat} title="Rytm" actions={<Button type="button" variant="outline" size="sm" onClick={() => setEditingRhythm(true)} data-testid="series-rhythm"><Repeat />Ändra rytm</Button>}>
      <div className="grid items-end gap-3 sm:grid-cols-2">
        <p className="text-sm" data-testid="series-rhythm-text">Återkommande {rhythmText(rhythm)}, från nästa lediga tid. Du kan ändra varje tid nedan.</p>
        <Field id="series-from" label="Första dag" type="date" value={fromDay} onChange={(value) => { setFromDay(value); setChosenTimes({}); }} />
      </div>
    </Panel>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Panel icon={ListChecks} title="Delarna" count={count} description="Rubrik och kort text står i bilden. Texten står i inlägget.">
        <ol className="space-y-3" data-testid="series-parts">{parts.map((part, index) => {
          const timeProblem = scheduleTimeProblem(part.at);
          const at = times[index];
          return <li key={index} className={cn("rounded-lg border p-3", shown === index && "border-primary")} data-testid={`series-part-${index}`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Del {index + 1}</h3>
              <Button type="button" variant={shown === index ? "secondary" : "outline"} size="sm" aria-pressed={shown === index} onClick={() => setShown(index)} data-testid={`series-part-${index}-show`}><Eye />Visa bilden</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="field-stack md:col-span-2">
                <label htmlFor={`series-part-${index}-at`} className="text-xs font-medium">Tid</label>
                <Input id={`series-part-${index}-at`} type="datetime-local" value={part.at} step={300} className="max-w-60" onChange={(event) => setChosenTimes((current) => ({ ...current, [index]: event.target.value }))} data-testid={`series-part-${index}-at`} />
                <p className={cn("text-xs", timeProblem ? "text-destructive" : "text-muted-foreground")} data-testid={`series-part-${index}-when`}>{timeProblem ?? (at ? `${scheduleSentence(at)}.` : "")}</p>
                {clashes[index] ? <p className="text-xs text-muted-foreground" data-testid={`series-part-${index}-clash`}>Ett annat inlägg publiceras redan inom en timme från den tiden.</p> : null}
              </div>
              <div className="field-stack"><div className="flex items-center justify-between gap-2"><label htmlFor={`series-part-${index}-heading`} className="text-xs font-medium">Rubrik</label><Count value={part.heading} max={HEADING_MAX} /></div>
                <Input id={`series-part-${index}-heading`} value={part.heading} maxLength={HEADING_MAX} onFocus={() => setShown(index)} onChange={(event) => setText(index, { heading: event.target.value })} data-testid={`series-part-${index}-heading`} /></div>
              <div className="field-stack"><div className="flex items-center justify-between gap-2"><label htmlFor={`series-part-${index}-body`} className="text-xs font-medium">Kort text</label><Count value={part.body} max={BODY_MAX} /></div>
                <textarea id={`series-part-${index}-body`} className="form-textarea min-h-16" value={part.body} maxLength={BODY_MAX} onFocus={() => setShown(index)} onChange={(event) => setText(index, { body: event.target.value })} data-testid={`series-part-${index}-body`} /></div>
              <div className="field-stack md:col-span-2"><label htmlFor={`series-part-${index}-caption`} className="text-xs font-medium">Text</label>
                <textarea id={`series-part-${index}-caption`} className="form-textarea min-h-20" value={part.caption} onFocus={() => setShown(index)} onChange={(event) => setText(index, { caption: event.target.value })} data-testid={`series-part-${index}-caption`} /></div>
            </div>
          </li>;
        })}</ol>
        {problem ? <p className="mt-3 text-sm text-muted-foreground" role="status" data-testid="series-problem">{problem.message}</p> : null}
      </Panel>
      <Panel icon={Eye} title="Förhandsvisning" description={`Del ${shown + 1}`} className="xl:sticky xl:top-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a picture drawn by the app's own server, as a blob address. */}
        {picture ? <img src={picture} alt={`Bilden till del ${shown + 1}`} className="block aspect-[4/5] w-full rounded-lg border object-cover" data-testid="series-picture" /> : <div className="aspect-[4/5] w-full animate-pulse rounded-lg bg-slate-100" aria-label="Bilden ritas" />}
      </Panel>
    </div>
    {earlier?.length ? <Panel icon={CalendarRange} title="Tidigare serier" count={earlier.length}>
      <ul className="divide-y rounded-lg border" data-testid="series-earlier">{earlier.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
        <Link href={seriesHref(item.id)} className="text-sm font-medium hover:underline">{item.name}</Link>
        <span className="text-xs text-muted-foreground">{item.startDay} till {item.endDay} · {item.items} inlägg</span>
      </li>)}</ul>
    </Panel> : null}
  </div>;
}

function Count({ value, max }: { value: string; max: number }) {
  return <span className={cn("text-xs tabular-nums", value.length > max ? "text-destructive" : "text-muted-foreground")}>{value.length}/{max}</span>;
}

const SOURCE_LABEL = { ai: "AI-utkast", rules: "Temats text", own: "Eget inlägg" } as const;

function OpenSeries({ id, onChanged }: { id: string; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [series, setSeries] = useState<SeriesView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { setSeries((await api<{ series: SeriesView }>(`/api/schedule?series=${encodeURIComponent(id)}`, { cache: "no-store" })).series); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, [id]);
  useLoadEffect(load);

  const post = (body: Record<string, unknown>) => api<{ series: SeriesView; source?: "ai" | "rules"; reason?: string | null; scheduled?: number; skipped?: string[] }>("/api/schedule", { method: "POST", body: JSON.stringify({ seriesId: id, ...body }) });
  const draftable = (view: SeriesView) => view.items.filter((item) => item.postStatus !== "published" && !item.schedule);

  /** Skriv med AI, one draft at a time with its progress; the first refusal (AI off, no credits) stops and says why. */
  const writeAll = useCallback(async (view: SeriesView, only?: string) => {
    const items = draftable(view).filter((item) => !only || item.id === only);
    if (!items.length) return;
    setBusy("ai"); setMessage(null); setProgress({ done: 0, total: items.length });
    let latest = view;
    const replaced: string[] = [];
    try {
      for (const [index, item] of items.entries()) {
        const answer = await post({ action: "series-ai", itemId: item.id });
        latest = answer.series; setSeries(answer.series); setProgress({ done: index + 1, total: items.length });
        if (answer.source === "rules" && answer.reason && !answer.reason.startsWith("AI-texten")) { setMessage({ text: `${answer.reason} Temats egen text används.` }); break; }
        if (answer.reason) replaced.push(answer.reason);
      }
      if (replaced.length) setMessage({ text: `${replaced.length === 1 ? "Ett utkast" : `${replaced.length} utkast`} fick temats egen text, eftersom AI-texten hade uppgifter som inte finns i underlaget.` });
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); }
    finally { setBusy(null); setProgress(null); void onChanged(); }
    return latest;
  }, [id, onChanged]); // eslint-disable-line react-hooks/exhaustive-deps -- post and draftable only read their arguments.

  // Right after Skapa utkast (…&draft=ai): Workflow AI writes every draft once, then the address forgets it.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!series || autoStarted.current || new URLSearchParams(window.location.search).get("draft") !== "ai") return;
    autoStarted.current = true;
    router.replace(seriesHref(id));
    void writeAll(series);
  }, [series, id, router, writeAll]);

  const swap = async (itemId: string, theme: string) => {
    setBusy(itemId); setMessage(null);
    try { setSeries((await post({ action: "series-theme", itemId, theme })).series); await onChanged(); }
    catch (cause) { setMessage({ text: (cause as Error).message, error: true }); } finally { setBusy(null); }
  };
  const scheduleAll = async () => {
    if (!series) return;
    const count = draftable(series).length;
    if (!(await confirm({ title: "Schemalägga serien?", message: `${count} inlägg publiceras var och ett på sin tid, precis som de ser ut nu. Du kan ändra tid, avbryta eller publicera nu för vart och ett under Schemalagt.`, confirmLabel: "Schemalägg serien",
      checkbox: { label: "Jag har läst texterna och tittat på bilderna.", required: true, testId: "series-schedule-check" } }))) return;
    setBusy("schedule"); setMessage(null);
    try {
      const answer = await post({ action: "series-schedule", confirm: true });
      setSeries(answer.series);
      setMessage({ text: `${answer.scheduled ?? 0} inlägg är schemalagda.${answer.skipped?.length ? ` Inte schemalagda: ${answer.skipped.join("; ")}.` : ""}`, error: Boolean(answer.skipped?.length) && !answer.scheduled });
      await onChanged();
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); } finally { setBusy(null); }
  };
  const remove = async () => {
    const asked = series?.kind === "queue" || series?.kind === "posts"
      ? { title: series.kind === "queue" ? "Ta bort kön?" : "Ta bort serien?", message: "Schemaläggningen avbryts för inläggen som inte är publicerade. Utkasten ligger kvar under Inlägg." }
      : { title: "Ta bort serien?", message: "Utkasten som inte är publicerade tas bort, och deras schemaläggning avbryts. Publicerade inlägg ligger kvar." };
    if (!(await confirm({ ...asked, confirmLabel: "Ta bort", tone: "danger" }))) return;
    setBusy("delete");
    try { await post({ action: "series-delete" }); await onChanged(); router.push(POSTS_VIEW); }
    catch (cause) { setMessage({ text: (cause as Error).message, error: true }); setBusy(null); }
  };

  if (error && !series) return <div className="space-y-4"><PageHeader title="Serie" actions={<PageBackButton href={POSTS_VIEW} label="Inlägg" />} /><p className="notice text-destructive" role="alert">{error}</p></div>;
  const left = series ? draftable(series).length : 0;
  // A queue (Schemalägg i tur och ordning, 2026-11-12) and Ny serie (2026-11-13) hold the company's own posts: no themes and no AI texts.
  const queue = series ? series.kind !== "themes" : false;
  return <div className="space-y-4" data-testid="series-open">
    {confirmElement}
    <PageHeader title={series?.name ?? "Serie"} description={series ? `${series.startDay} till ${series.endDay}, ${series.weekdays.map((day) => WEEKDAY_SHORT[day]).join(", ")} kl. ${series.time}.` : "Hämtar serien…"}
      actions={<PageBackButton href={POSTS_VIEW} label="Inlägg" testId="series-back" />} />
    <div className="flex flex-wrap items-center justify-end gap-2" data-testid="series-actions">
      <Button type="button" variant="ghost" className="text-destructive" disabled={!series || Boolean(busy)} onClick={() => void remove()} data-testid="series-delete"><Trash2 />{series?.kind === "queue" ? "Ta bort kön" : "Ta bort serien"}</Button>
      {queue ? null : <Button type="button" variant="outline" disabled={!series || Boolean(busy) || !left} onClick={() => series && void writeAll(series)} data-testid="series-ai-all"><Sparkles />Skriv alla med AI</Button>}
      <Button type="button" disabled={!series || Boolean(busy) || !left} disabledReason={series && !left && !busy ? "Alla inlägg är redan schemalagda." : null} onClick={() => void scheduleAll()} data-testid="series-schedule"><CalendarCheck />{queue ? "Schemalägg igen" : "Schemalägg serien"}</Button>
    </div>
    {progress ? <p className="notice" role="status" data-testid="series-progress">Skriver utkast {progress.done + (progress.done < progress.total ? 1 : 0)} av {progress.total}…</p> : null}
    {message ? <p className={cn("notice", message.error && "text-destructive")} role="status" data-testid="series-message">{message.text}</p> : null}
    <Panel icon={ListChecks} title="Inläggen" count={series?.items.length} description="Öppna ett inlägg för att läsa och ändra texten och bilden.">
      {!series ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p>
        : <ol className="divide-y rounded-lg border" data-testid="series-items">{series.items.map((item, index) => {
          const status = item.schedule ? SCHEDULE_STATUS_LABEL[item.schedule.status as ScheduleStatus] : item.postStatus === "published" ? SCHEDULE_STATUS_LABEL.published : { label: "Utkast", tone: "neutral" as const };
          const locked = Boolean(item.schedule) || item.postStatus === "published";
          return <li key={item.id} className="grid items-center gap-x-3 gap-y-2 p-3 md:grid-cols-[10rem_minmax(0,14rem)_minmax(0,1fr)_auto]" data-testid={`series-item-${item.id}`}>
            <span className="text-sm tabular-nums">{formatSwedish(item.schedule?.runAt ?? item.slotAt, WHEN)}</span>
            {queue ? <span className="text-sm text-muted-foreground">{SOURCE_LABEL.own}</span> : <Field id={`series-item-theme-${index}`} label={`Tema ${index + 1}`} value={item.theme} onChange={(value) => void swap(item.id, value)} options={themeOptions} optionLabels={themeLabels} disabled={locked || Boolean(busy)} className="[&_.field-label]:sr-only" />}
            <div className="min-w-0">
              <Link href={postHref(item.postId)} className="block truncate text-sm font-medium hover:underline" data-testid={`series-open-${item.id}`}>{item.heading || "Utan rubrik"}</Link>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium", indicatorBadge(status.tone))}>{status.label}</span>
                {queue ? null : SOURCE_LABEL[item.textSource]}
              </span>
            </div>
            {queue ? <span /> : <Button type="button" variant="outline" size="sm" disabled={locked || Boolean(busy)} onClick={() => void writeAll(series, item.id)} data-testid={`series-ai-${item.id}`}><Sparkles />Skriv med AI</Button>}
          </li>;
        })}</ol>}
    </Panel>
  </div>;
}
