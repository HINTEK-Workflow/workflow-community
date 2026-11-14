"use client";

import { useState } from "react";
import { OctagonAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChoiceCard } from "@/components/ui/choice-card";
import { DialogActions, Modal } from "@/features/kfid/ui";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { formatSwedish } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { OBSTACLE_OTHER_MIN, OBSTACLE_REASON_LABELS, OBSTACLE_REASONS, OBSTACLE_TEXT_MAX, obstacleText, type Obstacle, type ObstacleInput, type ObstacleReason } from "@/lib/workflow/obstacles";

/**
 * Rapportera hinder (2026-10-11, plan 1M): the small dialog that says what a job waits for – material, the customer,
 * a shutdown or something else, with a few words – and the notice a job with an obstacle shows with "Lös hindret". Shared
 * by every kind of job. The server (or the demo and Local file) decides; nothing here is permission.
 */
const REASON_HINTS: Record<ObstacleReason, string> = {
  MATERIAL: "Något som behövs för arbetet har inte kommit.",
  CUSTOMER: "Ett besked, en nyckel eller tillträde från kunden saknas.",
  SHUTDOWN: "Anläggningen måste först ställas av.",
  OTHER: "Något annat hindrar. Skriv vad.",
};

export function ObstacleDialog({ open, onOpenChange, docWord, busy, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  /** "Arbetsordern", "Protokollet" or "Riskbedömningen". */
  docWord: string; busy: boolean; onConfirm: (input: ObstacleInput) => Promise<boolean>;
}) {
  // Displays 2 and 3: a two-line text field, so the box keeps within the popup ceiling (Popupstorlek, 2026-10-13).
  const native = useNativeMode();
  const [reason, setReason] = useState<ObstacleReason>("MATERIAL");
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const issue = touched && reason === "OTHER" && text.trim().length < OBSTACLE_OTHER_MIN ? "Skriv med några ord vad det är som hindrar." : "";
  const close = (value: boolean) => { if (!value) { setReason("MATERIAL"); setText(""); setTouched(false); } onOpenChange(value); };
  const submit = async () => {
    setTouched(true);
    if (reason === "OTHER" && text.trim().length < OBSTACLE_OTHER_MIN) return;
    if (await onConfirm({ reason, text: text.trim() })) close(false);
  };
  return <Modal open={open} onOpenChange={close} title="Rapportera hinder" size="compact">
    <form className={native ? "space-y-4" : "space-y-3"} onSubmit={(event) => { event.preventDefault(); void submit(); }} data-testid="obstacle-dialog">
      <p className="text-sm text-muted-foreground">{docWord} markeras som hindrad, och de som ansvarar för jobbet och projektet får en notis. Du löser hindret med ett tryck när det är ur vägen.</p>
      <fieldset className="grid gap-2" aria-label="Orsak">
        {OBSTACLE_REASONS.map((value) => <ChoiceCard key={value} name="obstacle-reason" value={value} checked={reason === value} onChange={() => setReason(value)} title={OBSTACLE_REASON_LABELS[value]} description={REASON_HINTS[value]} />)}
      </fieldset>
      <label className="block space-y-2 text-xs font-medium text-muted-foreground">{reason === "OTHER" ? "Vad hindrar?" : "Några ord (valfritt)"}
        <textarea id="obstacle-text" className={cn("form-textarea", !native && "min-h-16")} rows={native ? undefined : 2} maxLength={OBSTACLE_TEXT_MAX} value={text} aria-invalid={Boolean(issue)} aria-describedby={issue ? "obstacle-text-issue" : undefined}
          placeholder={reason === "MATERIAL" ? "Till exempel: kablarna är beställda, väntas torsdag" : undefined} onChange={(event) => setText(event.target.value)} onBlur={() => setTouched(true)} />
      </label>
      {issue ? <p id="obstacle-text-issue" className="text-xs text-destructive">{issue}</p> : null}
      <DialogActions cancel={{ onClick: () => close(false) }} primary={{ label: "Rapportera hinder", type: "submit", busy, busyLabel: "Sparar…", testId: "obstacle-confirm" }} />
    </form>
  </Modal>;
}

/** The notice on a job with an obstacle: what it waits for, since when, and Lös hindret for those who may edit it. */
export function ObstacleNotice({ obstacle, canResolve, busy, onResolve, slim = false }: { obstacle: Obstacle; canResolve: boolean; busy: boolean; onResolve: () => void;
  /** One narrow line without the button (the screens of a job at level 1; Lös hindret is on the job's menu, 2026-10-12). */
  slim?: boolean }) {
  if (slim) return <p className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium", indicatorBadge("warning"))} role="status" data-testid="task-obstacle"><OctagonAlert aria-hidden="true" className="size-3.5 shrink-0" /><span className="min-w-0 truncate">Hinder: {obstacleText(obstacle)}</span></p>;
  return <div className={cn("flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3", indicatorBadge("warning"))} role="status" data-testid="task-obstacle">
    <div className="min-w-0 space-y-0.5">
      <p className="flex items-center gap-2 text-sm font-semibold"><OctagonAlert aria-hidden="true" className="size-4 shrink-0" />Hinder: {obstacleText(obstacle)}</p>
      {obstacle.since ? <p className="text-xs">Rapporterat {formatSwedish(obstacle.since, { dateStyle: "medium" })}</p> : null}
    </div>
    {canResolve ? <Button type="button" variant="outline" disabled={busy} onClick={onResolve} data-testid="task-obstacle-resolve"><ShieldCheck />Lös hindret</Button> : null}
  </div>;
}

/** The small mark in lists and on the Tidplan's rows: "Hinder" with the reason as its title. */
export function ObstacleChip({ obstacle, className }: { obstacle: Pick<Obstacle, "reason" | "text">; className?: string }) {
  return <span title={obstacleText(obstacle)} data-testid="obstacle-chip" className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-semibold leading-4", indicatorBadge("warning"), className)}>
    <OctagonAlert aria-hidden="true" className="size-3 shrink-0" /><span className="truncate">{OBSTACLE_REASON_LABELS[obstacle.reason as ObstacleReason] ?? "Hinder"}</span>
  </span>;
}
