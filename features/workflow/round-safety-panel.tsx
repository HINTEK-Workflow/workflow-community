"use client";

import Link from "next/link";
import { CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/features/kfid/ui";
import { formatSwedish } from "@/lib/swedish-time";
import { emptyRoundSafety, ROUND_SAFETY_ANSWER_LABELS, ROUND_SAFETY_ANSWERS, ROUND_SAFETY_QUESTIONS, type RoundSafety, type RoundSafetyAnswer, type RoundSafetyRisk, type RoundSafetyState } from "@/lib/workflow/round-safety";
import { RISK_STEP_TARGET } from "./risk-step-panel";
import { cn } from "@/lib/utils";

export const ROUND_SAFETY_TARGET = "task-round-safety";

/**
 * Säkerhetsavstämning inför rondtillfället (2026-10-27, punkt 4) on the occurrence's protocol: three questions with
 * big Ja/Nej answers and Klart, checked against the work order's risk assessment. When something has changed it leads to the
 * work order to update the risk assessment there (the full risk assessment is made and kept in the work order, punkt 2).
 * The rule is lib/workflow/round-safety.ts; the server stamps who and when and refuses Starta tid, ifyllnad and Färdigställ until done.
 */
export function RoundSafetyPanel({ state, check, risk, workOrder, disabled, busy, onChange }: {
  state: RoundSafetyState;
  check: RoundSafety | null;
  /** The work order's risk assessment as read now (its title is empty when the person may not read work orders). */
  risk: RoundSafetyRisk | null;
  workOrder: { id: string; title: string } | null;
  disabled: boolean;
  busy: boolean;
  onChange: (check: RoundSafety) => void;
}) {
  if (!state.applies) return null;
  const current = check ?? emptyRoundSafety();
  const answer = (id: string, value: RoundSafetyAnswer) => onChange({ ...current, answers: { ...current.answers, [id]: value }, confirmedAt: null, confirmedBy: "" });
  const orderHref = workOrder ? `/?view=workflow_task&taskId=${encodeURIComponent(workOrder.id)}&taskType=WORK_ORDER#${RISK_STEP_TARGET}` : null;
  const orderTitle = risk?.title || workOrder?.title || "arbetsordern";
  const confirmBlocked = state.unanswered.length ? "Svara på alla tre frågorna." : "";
  return <div data-testid="round-safety" data-state={state.done ? "done" : "open"}>
    <Panel icon={ShieldCheck} title="Säkerhetsavstämning" description={`Före rondtillfället, mot riskbedömningen i ${orderTitle === "arbetsordern" ? "arbetsordern" : `”${orderTitle}”`}.`}>
      <div id={ROUND_SAFETY_TARGET} data-flow-target={ROUND_SAFETY_TARGET} className="space-y-3">
        {/* Förenkling 0.77.0: the step came unexpectedly, so it says why first. */}
        {state.done ? null : <p className="text-sm text-muted-foreground" data-testid="round-safety-why">Riskbedömningen gjordes för hela arbetsordern. Före varje rondtillfälle stämmer du av att den fortfarande gäller: svara på tre frågor och välj Klart, sedan går protokollet att fylla i.</p>}
        {state.done ? <p className="inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300" data-testid="round-safety-done"><CheckCircle2 className="size-4" aria-hidden="true" />
          {state.changed ? "Riskbedömningen är uppdaterad efter avstämningen." : "Förutsättningarna gäller."}{current.confirmedBy ? ` ${current.confirmedBy}` : ""}{current.confirmedAt ? ` ${formatSwedish(current.confirmedAt, { dateStyle: "short", timeStyle: "short" })}` : ""}</p> : null}
        <div className="grid gap-3" role="group" aria-label="Säkerhetsavstämning">
          {ROUND_SAFETY_QUESTIONS.map((question) => <div key={question.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid={`round-safety-${question.id}`}>
            <span className="text-sm">{question.text}</span>
            <span className="grid shrink-0 grid-cols-2 gap-2">{ROUND_SAFETY_ANSWERS.map((value) => {
              const chosen = current.answers[question.id] === value;
              const safe = value === question.safe;
              return <button key={value} type="button" aria-pressed={chosen} disabled={disabled || busy} onClick={() => answer(question.id, value)} data-testid={`round-safety-${question.id}-${value}`}
                className={cn("min-h-11 min-w-20 rounded-lg border bg-card px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                  chosen && (safe ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-red-600 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"))}>
                {ROUND_SAFETY_ANSWER_LABELS[value]}
              </button>;
            })}</span>
          </div>)}
        </div>
        {state.done ? null : <p role="note" className="notice flex items-start gap-2 text-sm" data-testid="round-safety-hint"><ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{state.hint}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {!current.confirmedAt && !disabled ? <Button type="button" disabled={busy} disabledReason={confirmBlocked} onClick={() => onChange({ ...current, confirmedAt: new Date().toISOString() })} data-testid="round-safety-confirm"><CheckCircle2 />Klart</Button> : null}
          {state.changed && orderHref && !state.done ? <Button asChild variant="outline"><Link href={orderHref} data-testid="round-safety-update-risk"><ShieldAlert />Uppdatera riskbedömningen i arbetsordern</Link></Button> : null}
          {!state.changed && orderHref ? <Link href={orderHref} className="text-xs font-medium text-primary hover:underline" data-testid="round-safety-risk-link">Visa arbetsorderns riskbedömning</Link> : null}
        </div>
      </div>
    </Panel>
  </div>;
}
