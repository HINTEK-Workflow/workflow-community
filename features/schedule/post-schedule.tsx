"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { disabledReasonProps } from "@/components/ui/disabled-reason";
import { api } from "@/features/kfid/api";
import { formatSwedish, toSwedishDateTimeInput } from "@/lib/swedish-time";
import type { ScheduledView } from "@/lib/schedule/labels";
import { ScheduleDialog, type SchedulePlan } from "./schedule-dialog";

/**
 * Schemalägg beside Publicera (Inlägg, 2026-11-11): the post is saved first when it has changes, then the person chooses
 * the time and ticks that the text and the picture are read – the press is the approval. Scheduling a post that already has a
 * time replaces it.
 */
export function PostScheduleButton({ postId, reason, busy, where, current, plan, newsletter = null, beforeSchedule, onScheduled, testId = "post-schedule" }: {
  postId: string;
  /** Why it cannot be scheduled (the same as Publicera's), or null. */
  reason: string | null;
  busy: boolean;
  /** "Facebook och @konto", for the dialog's text. */
  where: string;
  /** The post's active scheduled item, if any. */
  current: ScheduledView | null;
  /** The company's rhythm and the other posts' times (2026-11-12): the dialog suggests the next free time. */
  plan?: SchedulePlan | null;
  /** Även som nyhetsbrev (2026-11-12): the newsletter's recipients now when the post also goes as a newsletter, else null. */
  newsletter?: { recipients: number } | null;
  /** Saves the editor's changes first; false stops. */
  beforeSchedule: () => Promise<boolean>;
  onScheduled: () => void | Promise<void>;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async (at: string) => {
    setWorking(true); setError(null);
    try {
      if (!(await beforeSchedule())) { setError("Inlägget kunde inte sparas."); return; }
      await api("/api/schedule", { method: "POST", body: JSON.stringify({ action: "schedule-post", postId, at, confirm: true }) });
      setOpen(false);
      await onScheduled();
    } catch (cause) { setError((cause as Error).message); } finally { setWorking(false); }
  };
  const text = `Inlägget publiceras på ${where || "de valda kanalerna"} vid den tid du väljer, precis som det ser ut nu. Ändrar du det efteråt måste ändringen godkännas igen.${current ? ` Det ersätter tiden ${formatSwedish(current.runAt, { dateStyle: "medium", timeStyle: "short" })}.` : ""}${newsletter ? ` Skickas även som nyhetsbrev till ${newsletter.recipients} mottagare vid samma tid.` : ""}`;
  return <>
    <Button type="button" variant="outline" {...disabledReasonProps({ reason: busy ? null : reason, describedBy: "post-publish-reason", onClick: () => { setError(null); setOpen(true); } })} disabled={busy || working} data-testid={testId}><CalendarClock />Schemalägg</Button>
    <ScheduleDialog open={open} title="Schemalägg inlägget" text={text} check={newsletter ? "Jag har läst texten, tittat på bilden och läst mejlet." : "Jag har läst texten och tittat på bilden."} busy={working} error={error} plan={plan}
      initial={current ? toSwedishDateTimeInput(current.runAt) : null} onCancel={() => setOpen(false)} onConfirm={(at) => void confirm(at)} testId={`${testId}-dialog`} />
  </>;
}
