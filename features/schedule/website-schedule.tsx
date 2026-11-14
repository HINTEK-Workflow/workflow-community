"use client";

import { useState } from "react";
import { api } from "@/features/kfid/api";
import { ScheduleDialog } from "./schedule-dialog";
import { ScheduledPanel, useScheduled } from "./scheduled-list";

/**
 * Schemalägg in Min webbsida (2026-11-11): the page as the editor shows it now is approved for a later time – the server
 * checks it like Publicera and stores exactly that markup, so a later edit never changes what goes out (Schemalägg again replaces
 * it). The open page's scheduled items are listed under the editor's bar.
 */
export function useWebsiteSchedule({ pageId, title, body }: {
  pageId: number | null; title: string;
  /** What Publicera would send: the markup, the base it was opened from and the search values. */
  body: () => Record<string, unknown> | null;
}) {
  const target = pageId === null ? undefined : String(pageId);
  const scheduled = useScheduled({ kind: "website", targetId: target });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const here = (scheduled.items ?? []).filter((item) => item.targetId === target);
  const confirm = async (at: string) => {
    const page = body();
    if (!page || pageId === null) return;
    setBusy(true); setError(null);
    try {
      await api("/api/schedule", { method: "POST", body: JSON.stringify({ action: "schedule-website", pageId, ...page, at, confirm: true }) });
      setOpen(false);
      await scheduled.reload();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const active = here.find((item) => item.status === "scheduled" || item.status === "needs_approval");
  return {
    start: () => { setError(null); setOpen(true); },
    dialog: <ScheduleDialog open={open} title="Schemalägg publicering" testId="site-schedule-dialog" busy={busy} error={error}
      text={`${title || "Sidan"} skrivs till webbplatsen vid den tid du väljer, precis som du ser den nu. Sidan som ligger där då sparas först.${active ? " Det ersätter den tidigare schemalagda versionen." : ""}`}
      check="Jag har tittat på sidan." onCancel={() => setOpen(false)} onConfirm={(at) => void confirm(at)} />,
    panel: here.length ? <ScheduledPanel items={scheduled.items} error={scheduled.error} onChanged={scheduled.reload} filter={{ kind: "website", targetId: target }} title="Schemalagd publicering" testId="site-scheduled" /> : null,
  };
}
