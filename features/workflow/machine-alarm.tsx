"use client";

import { useState, type ReactNode } from "react";
import { ClipboardList, Cog, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { cn } from "@/lib/utils";
import { announce } from "@/lib/workflow/toast";

/**
 * Maskinlarm (S4): "Jag tar den" on the bell's notice and on the automatic work order itself. The server decides (the first
 * one gets Ansvarig, the second a friendly message); nothing here is permission. Never changes the order's status.
 */

type ClaimAnswer = { ok: boolean; taken?: boolean; message?: string };

/** The button and its state: busy while it works, the answer told as a toast. `done` runs after a successful or lost claim, so the caller reads again. */
export function ClaimAlarmButton({ taskId, done, testId = "machine-alarm-claim", variant = "default" }: { taskId: string; done: () => void; testId?: string; variant?: "default" | "outline" }) {
  const [busy, setBusy] = useState(false);
  async function claim() {
    setBusy(true);
    try {
      const answer = await api<ClaimAnswer>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "claim_machine_alarm", id: taskId }) });
      announce(answer.ok ? "Du är ansvarig för arbetsordern." : answer.message || "Någon annan tar ordern.");
      done();
    } catch (error) {
      announce((error as Error).message, true);
      done();
    } finally { setBusy(false); }
  }
  return <Button type="button" variant={variant} size="sm" disabled={busy} onClick={() => void claim()} data-testid={testId}><UserCheck aria-hidden="true" />Jag tar den</Button>;
}

/**
 * Integrationsmotorn E6 (2026-10-24): "Skapa avvikelse" – an entry in Egenkontroll's deviation log linked to the order
 * both ways. Offered while the order has no entry the reader can see; the server decides who may and refuses a second one.
 */
export function CreateAlarmDeviationButton({ taskId, done }: { taskId: string; done: () => void }) {
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const answer = await api<{ number: number }>("/api/self-inspection", { method: "POST", body: JSON.stringify({ action: "create_deviation_from_alarm", taskId }) });
      announce(`Avvikelse ${answer.number} är förd i avvikelseloggen och kopplad till ordern.`);
      done();
    } catch (error) { announce((error as Error).message, true); done(); } finally { setBusy(false); }
  }
  return <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void create()} data-testid="machine-alarm-order-deviation"><ClipboardList aria-hidden="true" />Skapa avvikelse</Button>;
}

/**
 * The mark on an automatic work order: where it came from, and the button while nobody is responsible. `assign`: Tilldela (2026-11-07), beside Jag tar den.
 * `fault`: the order came from the operator page's fault report (kundresan 2026-11-07, H1), with the same box as a machine alarm's.
 */
export function AutomaticOrderNotice({ canClaim, taskId, onClaimed, canCreateDeviation = false, onDeviation, assign, fault = false }: { canClaim: boolean; taskId: string; onClaimed: () => void; canCreateDeviation?: boolean; onDeviation?: () => void; assign?: ReactNode; fault?: boolean }) {
  return <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3", indicatorBadge("info"))} role="status" data-testid="machine-alarm-order">
    <div className="min-w-0 space-y-0.5">
      <p className="flex items-center gap-2 text-sm font-semibold"><Cog aria-hidden="true" className="size-4 shrink-0" />{fault ? "Automatisk arbetsorder från en felanmälan" : "Automatisk arbetsorder från ett maskinlarm"}</p>
      <p className="text-xs">{canClaim ? `Ingen är ansvarig än. Tryck Jag tar den när du tar ordern${assign ? ", eller Tilldela" : ""}.` : "Skapad av systemet. Den stängs aldrig av sig själv."}</p>
    </div>
    {canClaim || canCreateDeviation || assign ? <div className="flex flex-wrap gap-2">
      {canClaim ? <ClaimAlarmButton taskId={taskId} done={onClaimed} testId="machine-alarm-order-claim" variant="outline" /> : null}
      {assign}
      {canCreateDeviation ? <CreateAlarmDeviationButton taskId={taskId} done={onDeviation ?? onClaimed} /> : null}
    </div> : null}
  </div>;
}
