"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, Clock, Globe, Repeat, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { DialogActions, Modal, Panel } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { ACTIVE_STATUSES, CHANNEL_LABEL, channelText, SCHEDULE_STATUS_LABEL, type ScheduledView, type ScheduleKind } from "@/lib/schedule/labels";
import { COMMON_TIMES, dayHeading, DEFAULT_RHYTHM, groupByDay, rhythmProblem, rhythmText, type Rhythm } from "@/lib/schedule/rhythm";
import { WEEKDAY_SHORT } from "@/lib/schedule/series";
import { formatSwedish, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { cn } from "@/lib/utils";
import { ScheduleDialog, type SchedulePlan } from "./schedule-dialog";

/**
 * Schemalagt (2026-11-11): the company's scheduled publications – posts and pages – with Ändra tid, Avbryt, Publicera nu
 * and, for a post changed after it was scheduled, Godkänn igen. The same list on Inlägg (everything) and in Min webbsida (the
 * open page's). Every action is the server's to allow; the buttons only ask.
 *
 * 2026-11-12: grouped by day (Idag, Imorgon, Onsdag 19 november), each row with the time, the channels as small marks, the title
 * and the status; on Inlägg the company's rhythm (Återkommande) stands in the card's header with Ändra rytm.
 */
const WHEN = { dateStyle: "medium", timeStyle: "short" } as const;
const CLOCK = { hour: "2-digit", minute: "2-digit" } as const;
const postHref = (id: string) => `/?view=company_posts&post=${encodeURIComponent(id)}`;
const seriesHref = (id: string) => `/?view=company_posts&series=${encodeURIComponent(id)}`;

export function useScheduled(filter: { kind?: ScheduleKind; targetId?: string } = {}) {
  const [items, setItems] = useState<ScheduledView[] | null>(null);
  const [rhythm, setRhythm] = useState<Rhythm>(DEFAULT_RHYTHM);
  const [error, setError] = useState("");
  const query = new URLSearchParams({ ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.targetId ? { target: filter.targetId } : {}) }).toString();
  const load = useCallback(async () => {
    try {
      const answer = await api<{ items: ScheduledView[]; rhythm?: Rhythm }>(`/api/schedule${query ? `?${query}` : ""}`, { cache: "no-store" });
      setItems(answer.items); if (answer.rhythm) setRhythm(answer.rhythm); setError("");
    } catch (cause) { setError((cause as Error).message); setItems((current) => current ?? []); }
  }, [query]);
  useLoadEffect(load);
  return { items, rhythm, setRhythm, error, reload: load, setItems };
}

/** The rhythm and the times other posts have (all but `except`'s own), for the dialog's suggestion. */
export function postPlan(items: ScheduledView[] | null, rhythm: Rhythm, except?: string | null): SchedulePlan {
  return { rhythm, taken: (items ?? []).filter((item) => item.kind === "post" && item.targetId !== except && (ACTIVE_STATUSES as readonly string[]).includes(item.status)).map((item) => item.runAt) };
}

const CHANNEL_MARK: Record<string, string> = { facebook: "f", instagram: "IG", facebook_story: "f·s", instagram_story: "IG·s", linkedin: "in" };

/** The channels as small marks with their names (Facebook, Instagram, LinkedIn; a globe for the website). */
export function ChannelMarks({ channels, className }: { channels: readonly string[]; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center gap-1", className)} aria-label={channelText(channels)} role="img">
    {channels.map((channel) => <span key={channel} title={CHANNEL_LABEL[channel] ?? channel} aria-hidden="true"
      className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 text-[10px] font-semibold leading-none text-muted-foreground">
      {channel === "website" ? <Globe className="size-3" /> : CHANNEL_MARK[channel] ?? channel.slice(0, 2)}</span>)}
  </span>;
}

export function ScheduledPanel({ items, error, onChanged, filter, rhythm, onRhythmChanged, title = "Schemalagt", empty = "Inget är schemalagt.", testId = "scheduled" }: {
  items: ScheduledView[] | null; error?: string; onChanged: () => void | Promise<void>;
  /** Only this target's items (the list from the server is the company's). */
  filter?: { kind?: ScheduleKind; targetId?: string };
  /** Inlägg: the company's rhythm, shown in the header with Ändra rytm, and used by Ändra tid's suggestion. */
  rhythm?: Rhythm; onRhythmChanged?: (rhythm: Rhythm) => void;
  title?: string; empty?: string; testId?: string;
}) {
  const [confirm, confirmElement] = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [moving, setMoving] = useState<ScheduledView | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [editingRhythm, setEditingRhythm] = useState(false);
  const shown = (items ?? []).filter((item) => (!filter?.kind || item.kind === filter.kind) && (!filter?.targetId || item.targetId === filter.targetId));
  const act = async (item: ScheduledView, body: Record<string, unknown>, done: string) => {
    setBusy(item.id); setMessage(null);
    try {
      const answer = await api<{ message?: string; status?: string }>("/api/schedule", { method: "POST", body: JSON.stringify({ id: item.id, ...body }) });
      setMessage({ text: answer.message || done, error: answer.status === "failed" });
      await onChanged();
      return true;
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); return false; } finally { setBusy(null); }
  };
  const what = (item: ScheduledView) => item.kind === "post" ? "Inlägget" : "Sidan";
  const cancel = async (item: ScheduledView) => {
    if (await confirm({ title: "Avbryta?", message: `${what(item)} publiceras inte ${formatSwedish(item.runAt, WHEN)}. ${item.kind === "post" ? "Utkastet finns kvar." : "Sidan ändras inte."}`, confirmLabel: "Avbryt publiceringen", cancelLabel: "Behåll", tone: "danger" }))
      await act(item, { action: "cancel" }, "Publiceringen är avbruten.");
  };
  const now = async (item: ScheduledView) => {
    if (await confirm({ title: "Publicera nu?", message: `${what(item)} publiceras direkt${item.channels.length ? ` (${channelText(item.channels)})` : ""} och syns för alla.`, confirmLabel: "Publicera nu",
      checkbox: item.kind === "post" ? { label: "Jag har läst texten och tittat på bilden.", required: true, testId: "scheduled-now-check" } : undefined }))
      await act(item, { action: "publish-now", confirm: true }, "Publicerat.");
  };
  // Även som nyhetsbrev (2026-11-12): the channels went out, the newsletter did not – send that part alone, once.
  const newsletterNow = async (item: ScheduledView) => {
    if (await confirm({ title: "Skicka nyhetsbrevet?", message: "Inlägget är redan publicerat. Nu skickas bara nyhetsbrevet, en gång, till dem som får nyhetsbrevet.", confirmLabel: "Skicka nyhetsbrevet",
      checkbox: { label: "Jag har läst mejlet.", required: true, testId: "scheduled-newsletter-check" } }))
      await act(item, { action: "publish-now", confirm: true }, "Nyhetsbrevet skickas.");
  };
  // Ta bort ur listan (2026-11-13): a cancelled or failed item leaves the list; the draft stays.
  const removeFromList = async (item: ScheduledView) => {
    if (await confirm({ title: "Ta bort ur listan?", message: `Raden tas bort ur Schemalagt. ${item.kind === "post" ? "Utkastet finns kvar under Inlägg." : "Sidan ändras inte."}`, confirmLabel: "Ta bort ur listan", tone: "danger" }))
      await act(item, { action: "remove" }, "Borttagen ur listan.");
  };
  const approve = async (item: ScheduledView) => {
    if (await confirm({ title: "Godkänna ändringen?", message: `Inlägget har ändrats sedan det schemalades. Det publiceras som det ser ut nu, ${formatSwedish(item.runAt, WHEN)}.`, confirmLabel: "Godkänn",
      checkbox: { label: "Jag har läst texten och tittat på bilden.", required: true, testId: "scheduled-approve-check" } }))
      await act(item, { action: "approve", confirm: true }, "Ändringen är godkänd.");
  };
  const move = async (at: string) => {
    if (!moving) return;
    setBusy(moving.id); setMoveError(null);
    try { await api("/api/schedule", { method: "POST", body: JSON.stringify({ action: "reschedule", id: moving.id, at }) }); setMoving(null); setMessage({ text: "Tiden är ändrad." }); await onChanged(); }
    catch (cause) { setMoveError((cause as Error).message); } finally { setBusy(null); }
  };
  const groups = groupByDay(shown, (item) => item.publishedAt ?? item.runAt);
  const today = new Date();

  return <Panel icon={CalendarClock} title={title} count={items ? shown.filter((item) => (ACTIVE_STATUSES as readonly string[]).includes(item.status)).length : undefined}
    description={rhythm ? `Återkommande: ${rhythmText(rhythm)}. Nya tider föreslås i den rytmen.` : undefined}
    actions={rhythm && onRhythmChanged ? <Button type="button" variant="outline" size="sm" onClick={() => setEditingRhythm(true)} data-testid={`${testId}-rhythm`}><Repeat />Ändra rytm</Button> : undefined}>
    {confirmElement}
    {rhythm && onRhythmChanged ? <RhythmDialog open={editingRhythm} rhythm={rhythm} onClose={() => setEditingRhythm(false)} onSaved={(next) => { onRhythmChanged(next); setEditingRhythm(false); setMessage({ text: `Rytmen är ${rhythmText(next)}.` }); }} /> : null}
    <ScheduleDialog open={Boolean(moving)} title="Ändra tid" text={moving ? `${what(moving)} ${moving.title ? `"${moving.title}" ` : ""}publiceras vid den nya tiden.` : ""} initial={moving ? toSwedishDateTimeInput(moving.runAt) : null}
      plan={moving?.kind === "post" && rhythm ? postPlan(items, rhythm, moving.targetId) : null}
      confirmLabel="Spara tiden" busy={Boolean(busy)} error={moveError} onCancel={() => { setMoving(null); setMoveError(null); }} onConfirm={(at) => void move(at)} testId="scheduled-move" />
    <div className="space-y-3" data-testid={testId}>
      {message ? <p className={cn("notice", message.error && "text-destructive")} role="status" data-testid={`${testId}-message`}>{message.text}</p> : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {!items ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p> : !shown.length ? <p className="text-sm text-muted-foreground" data-testid={`${testId}-empty`}>{empty}</p>
        : groups.map((group) => <section key={group.day} aria-label={dayHeading(group.at, today)} data-testid={`${testId}-day-${group.day}`}>
          <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{dayHeading(group.at, today)}</h3>
          <ul className="divide-y rounded-lg border">{group.items.map((item) => {
            const status = SCHEDULE_STATUS_LABEL[item.status] ?? SCHEDULE_STATUS_LABEL.scheduled;
            const open = item.status === "scheduled" || item.status === "needs_approval";
            return <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3" data-testid={`${testId}-row-${item.id}`}>
              <span className="w-12 shrink-0 text-sm font-semibold tabular-nums" data-testid={`${testId}-time-${item.id}`}>{formatSwedish(item.publishedAt ?? item.runAt, CLOCK)}</span>
              <div className="min-w-0 flex-1 basis-52">
                <div className="flex min-w-0 items-center gap-2">
                  <ChannelMarks channels={item.channels} />
                  {item.kind === "post" ? <Link href={postHref(item.targetId)} className="truncate text-sm font-medium hover:underline">{item.title || "Utan rubrik"}</Link>
                    : <span className="truncate text-sm font-medium">{item.title || "Sidan"}</span>}
                  <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium", indicatorBadge(status.tone))} data-testid={`${testId}-status-${item.id}`}>{status.label}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground"><Clock className="mr-1 inline size-3 align-[-2px]" aria-hidden="true" />
                  {channelText(item.channels)}{item.scheduledByName ? ` · ${item.scheduledByName}` : ""}
                  {item.status === "scheduled" && item.attempts > 0 ? ` · försöker igen ${formatSwedish(item.nextAttemptAt, { timeStyle: "short" })}` : ""}</p>
                {item.lastError && item.status !== "published" ? <p className={cn("mt-0.5 text-xs", item.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{item.lastError}</p> : null}
                {item.seriesId ? <Link href={seriesHref(item.seriesId)} className="mt-0.5 inline-block text-xs text-primary hover:underline" data-testid={`${testId}-series-${item.id}`}>Öppna serien</Link> : null}
                {item.status === "needs_approval" ? <p className="mt-0.5 text-xs text-muted-foreground">Ändrat efter schemaläggningen. Publiceras inte förrän ändringen är godkänd.</p> : null}
              </div>
              {open || item.status === "failed" || item.status === "cancelled" ? <div className="flex flex-wrap gap-1.5">
                {item.status === "needs_approval" ? <Button type="button" size="sm" disabled={Boolean(busy)} onClick={() => void approve(item)} data-testid={`${testId}-approve-${item.id}`}><Check />Godkänn</Button> : null}
                {item.status !== "cancelled" ? <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => { setMoveError(null); setMoving(item); }} data-testid={`${testId}-move-${item.id}`}><CalendarClock />{item.status === "failed" ? "Ny tid" : "Ändra tid"}</Button> : null}
                {item.status === "scheduled" ? <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void now(item)} data-testid={`${testId}-now-${item.id}`}><Send />Publicera nu</Button> : null}
                {item.status === "failed" && item.newsletterRetry ? <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void newsletterNow(item)} data-testid={`${testId}-newsletter-${item.id}`}><Send />Skicka nyhetsbrevet</Button> : null}
                {open ? <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={Boolean(busy)} onClick={() => void cancel(item)} data-testid={`${testId}-cancel-${item.id}`}><X />Avbryt</Button> : null}
                {item.status === "failed" || item.status === "cancelled" ? <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={Boolean(busy)} onClick={() => void removeFromList(item)} data-testid={`${testId}-remove-${item.id}`}><Trash2 />Ta bort ur listan</Button> : null}
              </div> : null}
            </li>;
          })}</ul>
        </section>)}
    </div>
  </Panel>;
}

/**
 * Ändra rytm (Återkommande, 2026-11-12): the weekdays and the clock time the company publishes posts on. It only decides which
 * times are suggested; nothing is scheduled and no post is repeated by it.
 */
export function RhythmDialog({ open, rhythm, onClose, onSaved }: { open: boolean; rhythm: Rhythm; onClose: () => void; onSaved: (rhythm: Rhythm) => void }) {
  return <Modal open={open} onOpenChange={(next) => { if (!next) onClose(); }} title="Publiceringsrytm" size="compact" nativeScreen>
    {open ? <RhythmForm rhythm={rhythm} onClose={onClose} onSaved={onSaved} /> : null}
  </Modal>;
}

function RhythmForm({ rhythm, onClose, onSaved }: { rhythm: Rhythm; onClose: () => void; onSaved: (rhythm: Rhythm) => void }) {
  const [weekdays, setWeekdays] = useState<number[]>(rhythm.weekdays);
  const [time, setTime] = useState(rhythm.time);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = rhythmProblem({ weekdays, time });
  const toggle = (day: number) => setWeekdays((current) => (current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort()));
  const save = async () => {
    setBusy(true); setError(null);
    try { onSaved((await api<{ rhythm: Rhythm }>("/api/schedule", { method: "POST", body: JSON.stringify({ action: "rhythm-set", weekdays, time }) })).rhythm); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  return <form className="space-y-4" data-testid="rhythm-dialog" onSubmit={(event) => { event.preventDefault(); if (!problem && !busy) void save(); }}>
    <p className="text-sm text-muted-foreground">De dagar och den tid ni brukar publicera. Schemalägg föreslår nästa lediga tid, och flera utkast i tur och ordning läggs på de tiderna. Inget inlägg upprepas.</p>
    <div className="field-stack"><span className="text-xs font-medium" id="rhythm-days-label">Dagar</span>
      <div role="group" aria-labelledby="rhythm-days-label" className="flex flex-wrap gap-1.5" data-testid="rhythm-days">
        {WEEKDAY_SHORT.map((label, day) => <Button key={label} type="button" size="sm" variant={weekdays.includes(day) ? "secondary" : "outline"} aria-pressed={weekdays.includes(day)}
          className={cn("min-w-12", weekdays.includes(day) && "font-semibold")} onClick={() => toggle(day)} data-testid={`rhythm-day-${day}`}>{label}</Button>)}
      </div></div>
    <div className="field-stack">
      <label htmlFor="rhythm-time" className="text-xs font-medium">Klockslag</label>
      <div role="group" aria-label="Vanliga klockslag" className="flex flex-wrap gap-1.5">
        {COMMON_TIMES.map((value) => <Button key={value} type="button" size="sm" variant={time === value ? "secondary" : "outline"} aria-pressed={time === value} className={cn("min-w-14", time === value && "font-semibold")}
          onClick={() => setTime(value)} data-testid={`rhythm-time-${value.replace(":", "")}`}>{value}</Button>)}
      </div>
      <Input id="rhythm-time" type="time" value={time} step={300} onChange={(event) => setTime(event.target.value)} className="max-w-36" data-testid="rhythm-time" />
      <p className="text-xs text-muted-foreground">{problem ?? `Svensk tid: ${rhythmText({ weekdays, time })}.`}</p>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive" data-testid="rhythm-error">{error}</p> : null}
    <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara rytmen", type: "submit", icon: <Repeat />, busy, busyLabel: "Sparar…", disabledReason: problem, testId: "rhythm-save" }} />
  </form>;
}
