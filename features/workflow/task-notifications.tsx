"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRegisterNotificationCount } from "@/components/workspace-actions";
import { api } from "@/features/kfid/api";
import { followUpNotifications, notificationToday, taskNotifications, type FollowUpSource, type NotificationSource, type TaskNotification } from "@/lib/workflow/task-notifications";

const kindLabel = { WORK_ORDER: "Arbetsorder", RISK_ASSESSMENT: "Riskbedömning", FORM: "Formulär", COMMISSIONING_CONTROL: "Kontroll före idrifttagning", ROUND: "Rond", FOLLOW_UP: "Arbetsorder slutförd" };

export type TaskNotificationFeed = {
  items: TaskNotification[] | null;
  today: string;
  scope: "team" | "mine";
  local: boolean;
  error: string;
  reload: () => void;
};

// One feed per mounted workspace drives both the menu count and the Notiser view.
// Cloud reads the server-filtered route; Local computes from the open .hwf without network calls.
export function useTaskNotificationFeed({ localSources, localFollowUps, enabled, resetKey }: { localSources?: NotificationSource[] | null; localFollowUps?: FollowUpSource[]; enabled: boolean; resetKey?: string }): TaskNotificationFeed {
  const local = Boolean(localSources);
  const [result, setResult] = useState<{ items: TaskNotification[]; today: string; scope: "team" | "mine"; key?: string } | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [today, setToday] = useState(notificationToday);
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | undefined;
    const load = () => {
      setToday(notificationToday());
      if (local) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      void api<{ items: TaskNotification[]; today: string; scope: "team" | "mine" }>("/api/task-notifications", { signal, cache: "no-store" })
        .then((data) => { if (!signal.aborted) { setResult({ ...data, key: resetKey }); setError(""); } })
        .catch((cause) => { if (!signal.aborted) { setResult(null); setError((cause as Error).message); } });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => { controller?.abort(); window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [enabled, local, refresh, resetKey]);
  const localItems = useMemo(() => localSources ? [...followUpNotifications(localFollowUps ?? []), ...taskNotifications(localSources, today)] : null, [localSources, localFollowUps, today]);
  const cloud = result && result.key === resetKey ? result : null;
  const items = !enabled ? null : localItems ?? cloud?.items ?? null;
  useRegisterNotificationCount(!enabled ? undefined : items ? items.length : null);
  return {
    items,
    today: local ? today : cloud?.today ?? today,
    // The Local file owner is the local administrator of the open file.
    scope: local ? "team" : cloud?.scope ?? "mine",
    local,
    error: enabled && !local ? error : "",
    reload: () => setRefresh((value) => value + 1),
  };
}

export function TaskNotifications({ feed }: { feed: TaskNotificationFeed }) {
  const [visibleCount, setVisibleCount] = useState(20);
  const { items, today, scope, local, error, reload } = feed;
  const audience = local ? "i den öppna filen" : scope === "team" ? "för hela teamet i din organisation" : "som är dina";
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="page-title flex items-center gap-2"><Bell className="size-6" aria-hidden="true" />Notiser</h1>
        <p className="page-description mt-2">Aktuella påminnelser för uppgifter och ronder {audience}.</p></div>
      <Button variant="outline" onClick={reload}>Uppdatera notiser</Button>
    </div>
    <p className="text-sm text-muted-foreground">Snart förfallande visas från 7 kalenderdagar före sista datum, inklusive idag, enligt svensk tid. Behöver åtgärdas följer uppgiftens status eller kontrollens obligatoriska punkter. När en arbetsorder från en avvikelse slutförs påminns den som äger protokollet i 7 dagar, eller tills protokollet sparats igen. Slutförda uppgifter och arkiverade projekt undantas.{!local && scope === "mine" ? " Egna uppgifter är de där du är ansvarig, eller som du skapat när ingen ansvarig är vald." : ""}</p>
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : !items ? <p role="status">Hämtar notiser…</p> : <>
      <p role="status" className="text-sm text-muted-foreground">{items.length ? `${items.length} ${items.length === 1 ? "uppgift" : "uppgifter"} med aktuella notiser` : "Inga aktuella notiser."}</p>
      <ul className="space-y-3" aria-label="Aktuella notiser">
        {items.slice(0, visibleCount).map((item) => <li key={item.id} data-testid="task-notification" className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{kindLabel[item.kind]}</span>
            {item.deadline && <span className="rounded-md bg-amber-100 px-2 py-1 text-amber-950 dark:bg-amber-950 dark:text-amber-100">{item.kind === "ROUND" ? item.deadline === "OVERDUE" ? "Missad eller ej klar" : "Ska göras idag" : item.deadline === "OVERDUE" ? "Förfallen" : item.dueDate === today ? "Förfaller idag" : "Snart förfallande"}</span>}
            {item.kind === "FOLLOW_UP" ? <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">Följ upp</span>
              : item.needsAction && <span className="rounded-md bg-muted px-2 py-1">Behöver åtgärdas</span>}
          </div>
          <Link href={item.href} className="mt-2 block break-words text-sm font-semibold text-primary underline-offset-4 hover:underline">{item.title}</Link>
          {item.detail && <p className="mt-1 text-sm text-muted-foreground" data-testid="task-notification-detail">{item.detail}</p>}
          {item.dueDate && <p className="mt-2 text-xs text-muted-foreground">{item.kind === "ROUND" ? "Tillfälle" : item.kind === "FOLLOW_UP" ? "Slutförd" : "Klart senast"} <time dateTime={item.dueDate}>{item.dueDate}</time></p>}
          {item.kind === "COMMISSIONING_CONTROL" && <p className="mt-2 text-xs text-muted-foreground">Obligatoriska punkter återstår inför färdigställande.</p>}
        </li>)}
      </ul>
      {items.length > visibleCount && <Button variant="outline" onClick={() => setVisibleCount((count) => count + 20)}>Visa fler notiser</Button>}
    </>}
  </section>;
}
