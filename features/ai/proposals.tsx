"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, LoaderCircle, ShieldPlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/features/kfid/ui";
import { useAdvisorAutofill } from "@/features/workflow/flow-guide";
import { announce } from "@/lib/workflow/toast";
import { taskDeviations } from "@/lib/ai/proposals";
import { proposalOutcome, proposalRequest, useAiAvailable, type Proposal } from "@/features/ai/proposal-client";

/**
 * Workflow AI's proposals on a page (plan 2026-10-01, fas 2). Each button asks the writer agent for a proposal made
 * from material the server's rules prepared, shows it for the person to read and change, and carries it out with the
 * ordinary tool only when the person confirms. What was created or filled in can be undone from the toast. The
 * buttons are shown only where the company's AI is on.
 */
const problem = (issue: unknown, fallback: string) => (issue instanceof Error ? issue.message : fallback);
const undoAction = (id: string, done: string, after?: () => void) => ({ label: "Ångra", run: () => {
  void proposalRequest({ action: "undo", id }).then(() => { announce(done); after?.(); }).catch((issue) => announce(problem(issue, "Det gick inte att ångra."), true));
} });

// ---------- A work order from a task's deviations ----------
type WorkOrderDraft = { title: string; description?: string; dueDate?: string };

export function WorkOrderProposal({ taskId, task, disabled }: { taskId: string; task: Record<string, unknown>; disabled?: boolean }) {
  const available = useAiAvailable();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [proposal, setProposal] = useState<Proposal<WorkOrderDraft> | null>(null);
  const [draft, setDraft] = useState({ title: "", description: "", dueDate: "" });
  // The help follows what matters right now: the button is there when the task has deviations to act on (the same
  // rules as the server's), and stays while its own dialog is open.
  if (!available || (!open && !taskDeviations(task).length)) return null;
  async function ask() {
    setOpen(true); setBusy(true); setReason(""); setProposal(null);
    try {
      const answer = await proposalRequest<WorkOrderDraft>({ action: "create", kind: "WORK_ORDER", sourceTaskId: taskId });
      if (!answer.proposal) { setReason(answer.reason || "Workflow AI kunde inte göra ett förslag nu."); return; }
      setProposal(answer.proposal);
      setDraft({ title: answer.proposal.payload.title, description: answer.proposal.payload.description ?? "", dueDate: answer.proposal.payload.dueDate ?? "" });
    } catch (issue) { setReason(problem(issue, "Workflow AI kunde inte göra ett förslag nu.")); } finally { setBusy(false); }
  }
  async function create() {
    if (!proposal) return;
    setBusy(true); setReason("");
    try {
      const answer = await proposalRequest<WorkOrderDraft>({ action: "apply", id: proposal.id, edits: draft });
      const url = String(answer.proposal?.result?.url ?? "");
      setOpen(false); setProposal(null);
      announce("Arbetsordern är skapad.", false, [...(url ? [{ label: "Öppna", run: () => router.push(url) }] : []), undoAction(proposal.id, "Arbetsordern togs bort.")]);
    } catch (issue) { setReason(problem(issue, "Arbetsordern kunde inte skapas.")); } finally { setBusy(false); }
  }
  const close = (next: boolean) => {
    if (busy) return;
    if (!next && proposal) { void proposalOutcome("dismiss", proposal.id); setProposal(null); }
    setOpen(next);
  };
  return <>
    <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => void ask()} title="Workflow AI föreslår en arbetsorder utifrån den sparade uppgiftens avvikelser. Inget skapas förrän du bekräftar. Kostar krediter." data-testid="work-order-ai">
      <Sparkles />Föreslå arbetsorder
    </Button>
    <Modal open={open} onOpenChange={close} title="Förslag på arbetsorder" className="max-w-xl">
      <div className="space-y-4" data-testid="work-order-proposal">
        {busy && !proposal ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Workflow AI läser avvikelserna och skriver ett förslag …</p> : null}
        {proposal ? <>
          <p className="text-sm leading-6 text-muted-foreground">Förslaget bygger på den sparade uppgiftens avvikelser. Ändra det som inte stämmer. Arbetsordern skapas i samma projekt och länkas till uppgiften.</p>
          <label className="field-stack text-xs font-medium text-muted-foreground">Rubrik<Input value={draft.title} maxLength={200} onChange={(event) => setDraft({ ...draft, title: event.target.value })} data-testid="work-order-proposal-title" /></label>
          <label className="field-stack text-xs font-medium text-muted-foreground">Vad som ska göras<textarea className="form-textarea min-h-40" value={draft.description} maxLength={5000} onChange={(event) => setDraft({ ...draft, description: event.target.value })} data-testid="work-order-proposal-description" /></label>
          <label className="field-stack text-xs font-medium text-muted-foreground sm:max-w-56">Klart senast (valfritt)<Input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
        </> : null}
        {reason ? <p role="alert" className="text-sm leading-6">{reason}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => close(false)}>{proposal ? "Avfärda" : "Stäng"}</Button>
          {proposal ? <Button type="button" disabled={busy || !draft.title.trim()} onClick={() => void create()} data-testid="work-order-proposal-create">{busy ? <LoaderCircle className="animate-spin" /> : null}Skapa arbetsorder</Button> : null}
        </div>
      </div>
    </Modal>
  </>;
}

// ---------- Protective measures for a risk assessment's risks ----------
type Measure = { riskId: string; hazard: string; measure: string };

export function RiskMeasuresAssist({ title, taskId, risks, onApply, disabled }: { title: string; taskId?: string; risks: { id: string; hazard: string; likelihood: number; consequence: number }[]; onApply: (measures: { riskId: string; measure: string }[]) => () => void; disabled?: boolean }) {
  const available = useAiAvailable();
  const autofill = useAdvisorAutofill();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [proposal, setProposal] = useState<Proposal<{ measures: Measure[] }> | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  if (!available || (!open && !busy && !risks.length)) return null;
  const accept = (item: Proposal<{ measures: Measure[] }>, ids: string[]) => {
    const picked = item.payload.measures.filter((measure) => ids.includes(measure.riskId));
    const undo = onApply(picked.map(({ riskId, measure }) => ({ riskId, measure })));
    void proposalOutcome("apply", item.id);
    announce(`${picked.length} ${picked.length === 1 ? "skyddsåtgärd är ifylld" : "skyddsåtgärder är ifyllda"}. Granska dem och bedöm den kvarvarande risken.`, false, [{ label: "Ångra", run: () => { undo(); void proposalOutcome("undo", item.id); } }]);
  };
  async function ask() {
    setBusy(true); setReason(""); setProposal(null);
    if (!autofill) setOpen(true);
    try {
      const answer = await proposalRequest<{ measures: Measure[] }>({ action: "create", kind: "RISK_MEASURES", title, risks, ...(taskId ? { sourceTaskId: taskId } : {}) });
      if (!answer.proposal) { if (autofill) announce(answer.reason || "Workflow AI kunde inte göra ett förslag nu.", true); else setReason(answer.reason || "Workflow AI kunde inte göra ett förslag nu."); return; }
      const ids = answer.proposal.payload.measures.map((measure) => measure.riskId);
      // The fields are empty by definition, so with the person's own choice the measures go straight in.
      if (autofill) accept(answer.proposal, ids);
      else { setProposal(answer.proposal); setChosen(ids); }
    } catch (issue) { if (autofill) announce(problem(issue, "Workflow AI kunde inte göra ett förslag nu."), true); else setReason(problem(issue, "Workflow AI kunde inte göra ett förslag nu.")); } finally { setBusy(false); }
  }
  const close = (next: boolean) => {
    if (busy) return;
    if (!next && proposal) { void proposalOutcome("dismiss", proposal.id); setProposal(null); }
    setOpen(next);
  };
  return <>
    <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => void ask()} title="Workflow AI föreslår en skyddsåtgärd för varje risk som saknar en. Du väljer vilka som används och bedömer själv den kvarvarande risken. Kostar krediter." data-testid="risk-measures-ai">
      {busy ? <LoaderCircle className="animate-spin" /> : <ShieldPlus />}Föreslå åtgärder
    </Button>
    <Modal open={open} onOpenChange={close} title="Förslag på skyddsåtgärder" className="max-w-2xl">
      <div className="space-y-4" data-testid="risk-measures-proposal">
        {busy && !proposal ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Workflow AI läser riskerna och föreslår åtgärder …</p> : null}
        {proposal ? <>
          <p className="text-sm leading-6 text-muted-foreground">Välj de åtgärder som passar. De läggs i riskernas tomma fält och kan ändras där. Den kvarvarande risken bedömer du själv.</p>
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">{proposal.payload.measures.map((item) => <li key={item.riskId}>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={chosen.includes(item.riskId)} onChange={(event) => setChosen(event.target.checked ? [...chosen, item.riskId] : chosen.filter((id) => id !== item.riskId))} />
              <span className="min-w-0"><span className="block text-xs text-muted-foreground">{item.hazard}</span><span className="mt-1 block leading-6">{item.measure}</span></span>
            </label>
          </li>)}</ul>
        </> : null}
        {reason ? <p role="alert" className="text-sm leading-6">{reason}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => close(false)}>{proposal ? "Avfärda" : "Stäng"}</Button>
          {proposal ? <Button type="button" disabled={!chosen.length} onClick={() => { accept(proposal, chosen); setProposal(null); setOpen(false); }} data-testid="risk-measures-use">Använd valda</Button> : null}
        </div>
      </div>
    </Modal>
  </>;
}

// ---------- Planning for a project's unplanned tasks ----------
type PlannedDraft = { title: string; startsAt: string; endsAt: string; taskId?: string };
const dayText = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", weekday: "short", day: "numeric", month: "short" });
const timeText = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });

export function PlanningProposal({ projectId, disabled, onApplied }: { projectId: string; disabled?: boolean; onApplied?: () => void }) {
  const available = useAiAvailable();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [proposal, setProposal] = useState<Proposal<{ activities: PlannedDraft[]; note: string }> | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  if (!available) return null;
  async function ask() {
    setOpen(true); setBusy(true); setReason(""); setProposal(null);
    try {
      const answer = await proposalRequest<{ activities: PlannedDraft[]; note: string }>({ action: "create", kind: "PROJECT_PLANNING", projectId });
      if (!answer.proposal) { setReason(answer.reason || "Workflow AI kunde inte göra ett förslag nu."); return; }
      setProposal(answer.proposal);
      setChosen(answer.proposal.payload.activities.map((_, index) => index));
    } catch (issue) { setReason(problem(issue, "Workflow AI kunde inte göra ett förslag nu.")); } finally { setBusy(false); }
  }
  async function plan() {
    if (!proposal) return;
    setBusy(true); setReason("");
    try {
      await proposalRequest({ action: "apply", id: proposal.id, selected: chosen });
      setOpen(false); setProposal(null);
      onApplied?.();
      announce(`${chosen.length} ${chosen.length === 1 ? "aktivitet är planerad" : "aktiviteter är planerade"}. Ändra tid och ansvarig i planeringen.`, false, [undoAction(proposal.id, "Planeringen togs bort.", onApplied)]);
    } catch (issue) { setReason(problem(issue, "Planeringen kunde inte skapas.")); } finally { setBusy(false); }
  }
  const close = (next: boolean) => {
    if (busy) return;
    if (!next && proposal) { void proposalOutcome("dismiss", proposal.id); setProposal(null); }
    setOpen(next);
  };
  return <>
    <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => void ask()} title="Workflow AI föreslår när projektets oplanerade uppgifter kan göras. Inget planeras förrän du bekräftar. Kostar krediter." data-testid="planning-ai">
      <CalendarPlus />Föreslå planering
    </Button>
    <Modal open={open} onOpenChange={close} title="Förslag på planering" className="max-w-2xl">
      <div className="space-y-4" data-testid="planning-proposal">
        {busy && !proposal ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Workflow AI läser projektets oplanerade uppgifter …</p> : null}
        {proposal ? <>
          <p className="text-sm leading-6 text-muted-foreground">Välj det som ska planeras. Aktiviteterna skapas utan ansvarig, och planerad tid är aldrig rapporterad tid.{proposal.payload.note ? ` ${proposal.payload.note}` : ""}</p>
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">{proposal.payload.activities.map((item, index) => <li key={`${item.taskId}-${item.startsAt}`}>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={chosen.includes(index)} onChange={(event) => setChosen(event.target.checked ? [...chosen, index] : chosen.filter((value) => value !== index))} />
              <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{dayText.format(new Date(item.startsAt))} · {timeText.format(new Date(item.startsAt))}–{timeText.format(new Date(item.endsAt))}</span>
            </label>
          </li>)}</ul>
        </> : null}
        {reason ? <p role="alert" className="text-sm leading-6">{reason}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => close(false)}>{proposal ? "Avfärda" : "Stäng"}</Button>
          {proposal ? <Button type="button" disabled={busy || !chosen.length} onClick={() => void plan()} data-testid="planning-proposal-apply">{busy ? <LoaderCircle className="animate-spin" /> : null}Planera valda</Button> : null}
        </div>
      </div>
    </Modal>
  </>;
}
