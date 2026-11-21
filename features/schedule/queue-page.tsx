"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CalendarCheck, ListOrdered, Megaphone, Repeat, X } from "lucide-react";
import { PageBackButton, PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Field, Panel } from "@/features/kfid/ui";
import type { QueueCandidate } from "@/lib/schedule/queue-server";
import { DEFAULT_RHYTHM, moveInOrder, QUEUE_MAX, rhythmText, scheduleSentence, spreadQueue, type Rhythm } from "@/lib/schedule/rhythm";
import { swedishDayKey, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { cn } from "@/lib/utils";
import { ChannelMarks, RhythmDialog } from "./scheduled-list";

/**
 * Schemalägg i tur och ordning (2026-11-12, "posta en serie inlägg som ligger och väntar"): the admin ticks the drafts that
 * wait, puts them in order (up and down), and sees each one's day and time – the company's rhythm's next free times, never two
 * posts in the same slot. One press with the read-through tick approves them all, each exactly as it is now and as its own item
 * under Schemalagt (Ändra tid, Publicera nu, Avbryt). The server spreads them again and refuses when the times have changed.
 */
const POSTS_VIEW = "/?view=company_posts";
const seriesHref = (id: string) => `${POSTS_VIEW}&series=${encodeURIComponent(id)}`;
type QueueData = { candidates: QueueCandidate[]; rhythm: Rhythm; taken: string[] };

export function QueuePage({ onChanged }: { onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [data, setData] = useState<QueueData | null>(null);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [fromDay, setFromDay] = useState(() => swedishDayKey(new Date()));
  const [editingRhythm, setEditingRhythm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try {
      const next = await api<QueueData>("/api/schedule?queue=1", { cache: "no-store" });
      setData(next); setError("");
      // A draft that no longer waits leaves the order.
      setOrder((current) => current.filter((id) => next.candidates.some((candidate) => candidate.id === id && !candidate.problem)));
    } catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(load);

  const rhythm = data?.rhythm ?? DEFAULT_RHYTHM;
  const byId = useMemo(() => new Map((data?.candidates ?? []).map((candidate) => [candidate.id, candidate])), [data]);
  const plan = useMemo(() => (order.length ? spreadQueue(order, rhythm, { taken: (data?.taken ?? []).map((value) => new Date(value)), fromDay }) : []), [order, rhythm, data, fromDay]);
  const planError = "error" in plan ? plan.error : null;
  const entries = "error" in plan ? [] : plan;
  const ready = (data?.candidates ?? []).filter((candidate) => !candidate.problem);
  const toggle = (id: string, on: boolean) => setOrder((current) => (on ? (current.includes(id) || current.length >= QUEUE_MAX ? current : [...current, id]) : current.filter((value) => value !== id)));
  const allChosen = ready.length > 0 && ready.every((candidate) => order.includes(candidate.id));
  const reason = !order.length ? "Välj minst ett utkast." : planError;

  const schedule = async () => {
    if (!entries.length) return;
    if (!(await confirm({ title: "Schemalägga i tur och ordning?", message: `${entries.length === 1 ? "Inlägget publiceras" : `${entries.length} inlägg publiceras var och ett`} på sin tid, precis som ${entries.length === 1 ? "det ser" : "de ser"} ut nu. Du kan ändra tid, avbryta eller publicera nu för vart och ett under Schemalagt.`,
      confirmLabel: "Schemalägg", checkbox: { label: entries.length === 1 ? "Jag har läst texten och tittat på bilden." : "Jag har läst texterna och tittat på bilderna.", required: true, testId: "queue-check" } }))) return;
    setBusy(true); setMessage(null);
    try {
      const answer = await api<{ seriesId: string; scheduled: number; skipped: string[] }>("/api/schedule", { method: "POST", body: JSON.stringify({
        action: "queue-schedule", confirm: true, fromDay, items: entries.map((entry) => ({ postId: entry.postId, at: toSwedishDateTimeInput(entry.at) })),
      }) });
      await onChanged();
      if (answer.skipped.length) { setMessage({ text: `${answer.scheduled} inlägg är schemalagda. Inte schemalagda: ${answer.skipped.join("; ")}.`, error: !answer.scheduled }); setOrder([]); await load(); setBusy(false); return; }
      router.push(seriesHref(answer.seriesId));
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); await load(); setBusy(false); }
  };

  if (error && !data) return <div className="space-y-4"><PageHeader title="I tur och ordning" actions={<PageBackButton href={POSTS_VIEW} label="Inlägg" />} /><p className="notice text-destructive" role="alert">{error}</p></div>;
  return <div className="space-y-4" data-testid="queue-page">
    {confirmElement}
    <RhythmDialog open={editingRhythm} rhythm={rhythm} onClose={() => setEditingRhythm(false)} onSaved={(next) => { setEditingRhythm(false); setData((current) => (current ? { ...current, rhythm: next } : current)); }} />
    <PageHeader title="I tur och ordning" description="Välj vilka väntande utkast som ska med och i vilken ordning. De läggs på nästa lediga tider i er rytm. Inget publiceras förrän du schemalägger."
      actions={<>
        <PageBackButton href={POSTS_VIEW} label="Inlägg" testId="queue-back" />
        <Button type="button" disabled={busy || !data || Boolean(reason)} disabledReason={busy ? null : reason} onClick={() => void schedule()} data-testid="queue-schedule"><CalendarCheck />{busy ? "Schemalägger…" : order.length ? `Schemalägg ${order.length}` : "Schemalägg"}</Button>
      </>} />
    {message ? <p className={cn("notice", message.error && "text-destructive")} role="status" data-testid="queue-message">{message.text}</p> : null}
    <Panel icon={Repeat} title="Rytm" actions={<Button type="button" variant="outline" size="sm" onClick={() => setEditingRhythm(true)} data-testid="queue-rhythm"><Repeat />Ändra rytm</Button>}>
      <div className="grid items-end gap-3 sm:grid-cols-2">
        <p className="text-sm" data-testid="queue-rhythm-text">Återkommande {rhythmText(rhythm)}. En tid som ett annat inlägg redan har hoppas över.</p>
        <Field id="queue-from" label="Första dag" type="date" value={fromDay} onChange={setFromDay} />
      </div>
    </Panel>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Panel icon={Megaphone} title="Utkast som väntar" count={data?.candidates.length}
        actions={ready.length ? <Button type="button" variant="outline" size="sm" onClick={() => setOrder(allChosen ? [] : [...order, ...ready.map((candidate) => candidate.id).filter((id) => !order.includes(id))].slice(0, QUEUE_MAX))} data-testid="queue-all">{allChosen ? "Välj inga" : "Välj alla"}</Button> : undefined}>
        {!data ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p>
          : !data.candidates.length ? <p className="text-sm text-muted-foreground" data-testid="queue-none">Inga utkast väntar. Ett utkast som redan är schemalagt eller ingår i en serie visas inte här.</p>
          : <ul className="divide-y rounded-lg border" data-testid="queue-candidates">{data.candidates.map((candidate) => {
            const chosen = order.includes(candidate.id);
            return <li key={candidate.id} className={cn("flex items-start gap-3 p-3", candidate.problem && "text-muted-foreground")}>
              <Checkbox id={`queue-pick-${candidate.id}`} checked={chosen} disabled={Boolean(candidate.problem) || (!chosen && order.length >= QUEUE_MAX)} onCheckedChange={(value) => toggle(candidate.id, value === true)} className="mt-0.5" data-testid={`queue-pick-${candidate.id}`} />
              <label htmlFor={`queue-pick-${candidate.id}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="flex min-w-0 items-center gap-2"><ChannelMarks channels={candidate.channels} /><span className="truncate text-sm font-medium">{candidate.heading || "Utan rubrik"}</span></span>
                {candidate.problem ? <span className="mt-0.5 block text-xs">{candidate.problem}</span> : null}
              </label>
            </li>;
          })}</ul>}
      </Panel>
      <Panel icon={ListOrdered} title="Ordning och tider" count={order.length}>
        {!order.length ? <p className="text-sm text-muted-foreground" data-testid="queue-empty">Kryssa i utkasten i den ordning de ska publiceras. Du kan flytta dem här.</p>
          : planError ? <p className="text-sm text-destructive" role="alert" data-testid="queue-plan-error">{planError}</p>
          : <ol className="divide-y rounded-lg border" data-testid="queue-order">{entries.map((entry, index) => {
            const candidate = byId.get(entry.postId);
            return <li key={entry.postId} className="flex items-center gap-2 p-3" data-testid={`queue-row-${entry.postId}`}>
              <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{index + 1}.</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" data-testid={`queue-when-${entry.postId}`}>{scheduleSentence(entry.at).replace(/^Publiceras /, "").replace(/^./, (letter) => letter.toUpperCase())}</p>
                <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><ChannelMarks channels={candidate?.channels ?? []} /><span className="truncate">{candidate?.heading || "Utan rubrik"}</span></p>
              </div>
              <IconButton label="Flytta upp" disabled={index === 0 || busy} onClick={() => setOrder((current) => moveInOrder(current, index, -1))} data-testid={`queue-up-${entry.postId}`}><ArrowUp /></IconButton>
              <IconButton label="Flytta ned" disabled={index === entries.length - 1 || busy} onClick={() => setOrder((current) => moveInOrder(current, index, 1))} data-testid={`queue-down-${entry.postId}`}><ArrowDown /></IconButton>
              <IconButton label="Ta bort ur ordningen" disabled={busy} onClick={() => toggle(entry.postId, false)} data-testid={`queue-remove-${entry.postId}`}><X /></IconButton>
            </li>;
          })}</ol>}
      </Panel>
    </div>
  </div>;
}
