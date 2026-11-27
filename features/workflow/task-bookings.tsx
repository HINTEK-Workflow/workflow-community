"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { taskBookingLine } from "@/lib/workflow/bookings";

export type TaskBooking = {
  id: string; version: number; title: string; status: string; startsAt: string; endsAt: string; workflowTaskId: string | null;
  assignedToName: string; assignments: { userId: string }[];
};

/** A job's coming bookings (Cloud and the demo; the server filters by tenant and read permission). */
export function useTaskBookings(taskId: string | null | undefined, refreshKey: unknown = null) {
  const [bookings, setBookings] = useState<TaskBooking[] | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!taskId) return;
    let live = true;
    api<{ activities: TaskBooking[] }>(`/api/planned-activities?forTask=${encodeURIComponent(taskId)}&upcoming=1`)
      .then((result) => { if (live) setBookings(result.activities.filter((item) => ["PLANNED", "IN_PROGRESS"].includes(item.status))); })
      .catch(() => { if (live) setBookings([]); });
    return () => { live = false; };
  }, [taskId, reload, refreshKey]);
  return { bookings: taskId ? bookings : [], reload: () => setReload((value) => value + 1) };
}

/**
 * "Bokad: tis 14/10 07–16 · Anna, Erik" or "Ingen bokning" on the job's page, on every display level (projektförslaget
 * 2026-10-09, steg 1, kriterium 5). The booking itself is changed in Planering. With `bookHref` the line has Boka beside it (
 * 2026-11-02): the booking form with the job filled in; on a narrow screen the button wraps under the line.
 */
export function TaskBookingLine({ taskId, refreshKey, bookHref }: { taskId: string; bookHref?: string | null;
  /** Read again when it changes (simulation 2026-10-10: "Bokad: …" stayed after Färdigställ removed the booking). */
  refreshKey?: unknown }) {
  const { bookings } = useTaskBookings(taskId, refreshKey);
  if (bookings === null) return null;
  return <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
    <p data-testid="task-booking-line" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <CalendarClock className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{taskBookingLine(bookings)}</span>
    </p>
    {bookHref ? <Button asChild size="sm" variant="outline"><Link href={bookHref} data-testid="task-book">Boka</Link></Button> : null}
  </div>;
}
