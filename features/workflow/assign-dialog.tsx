"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { DialogActions, Modal } from "@/features/kfid/ui";
import { assignChoice, type AssignMember } from "@/lib/workflow/assign-work-order";

/**
 * Tilldela (2026-11-07): a machine alarm's work order is made by the system and often has nobody responsible. Someone who may
 * edit work orders picks the responsible person here, and – where the order can be booked – more people, who are then booked in
 * Planering (the time is chosen there). The responsible person is saved through the work order's own save, so the server checks
 * session, company, rights, level and Origin as always, writes the history and tells the person ("Tilldelad dig").
 */
export function AssignButton({ disabledReason, onClick, href, testId = "task-assign" }: { disabledReason?: string | null; testId?: string } & ({ onClick: () => void; href?: never } | { href: string; onClick?: never })) {
  const reasonId = useId();
  // Grey with its reason in visible text for someone who may only read (no dead button, no hidden one, no link to a refusal).
  return <span className="inline-flex max-w-full flex-col items-start gap-1">
    {href && !disabledReason ? <Button asChild variant="outline" size="sm"><Link href={href} data-testid={testId}><UserPlus aria-hidden="true" />Tilldela</Link></Button>
      : <Button type="button" variant="outline" size="sm" disabledReason={disabledReason} aria-describedby={disabledReason ? reasonId : undefined} onClick={onClick} data-testid={testId}><UserPlus aria-hidden="true" />Tilldela</Button>}
    <DisabledReason id={reasonId} reason={disabledReason} className="max-w-xs" />
  </span>;
}

export function AssignWorkOrderDialog({ open, onOpenChange, members, currentId, note, canBookMore, busy, error, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The people who may be chosen (those who may read the job; the server refuses anyone else). */
  members: AssignMember[];
  /** Who is responsible now. */
  currentId: string | null;
  /** A short word after a name (" – når inte krävd nivå"). */
  note?: (member: AssignMember) => string;
  /** More people can be booked on the order (Planering is on and the person may book it). */
  canBookMore: boolean;
  busy: boolean;
  error?: string;
  /** Saves the responsible person; `more` are the people to book besides. Resolves true when it is done. */
  onConfirm: (responsibleId: string, more: string[]) => Promise<boolean>;
}) {
  const [chosen, setChosen] = useState(currentId ?? "");
  const [more, setMore] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const close = (value: boolean) => { if (!value) { setChosen(currentId ?? ""); setMore([]); setTouched(false); } onOpenChange(value); };
  const choice = assignChoice({ responsibleId: chosen, more, memberIds: members.map((member) => member.id), canBookMore });
  const issue = touched && !choice.responsibleId ? "Välj vem som ska ansvara." : "";
  const toggle = (id: string) => setMore((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const submit = async () => {
    setTouched(true);
    if (!choice.responsibleId) return;
    if (await onConfirm(choice.responsibleId, choice.more)) close(false);
  };
  const others = members.filter((member) => member.id !== chosen);
  return <Modal open={open} onOpenChange={close} title="Tilldela arbetsordern" size="compact">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }} data-testid="task-assign-dialog">
      <p className="text-sm text-muted-foreground">Den du väljer blir ansvarig och får en notis.</p>
      <label className="block space-y-2 text-xs font-medium text-muted-foreground">Ansvarig
        <select id="task-assign-responsible" className="form-select" value={chosen} aria-invalid={Boolean(issue)} aria-describedby={issue ? "task-assign-issue" : undefined}
          onChange={(event) => { const id = event.target.value; setChosen(id); setMore((current) => current.filter((item) => item !== id)); }} data-testid="task-assign-responsible">
          <option value="" disabled>Välj person</option>
          {members.map((member) => <option key={member.id} value={member.id}>{member.name}{note?.(member) ?? ""}</option>)}
        </select>
      </label>
      {issue ? <p id="task-assign-issue" className="text-xs text-destructive">{issue}</p> : null}
      {canBookMore && others.length ? <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Fler personer</p>
        <div className="divide-y rounded-lg border" data-testid="task-assign-more">{others.map((member) => <label key={member.id} className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm">
          <input type="checkbox" className="size-5 shrink-0 accent-[var(--primary)]" checked={more.includes(member.id)} onChange={() => toggle(member.id)} />{member.name}</label>)}</div>
        <p className="text-xs text-muted-foreground">Fler personer bokas i Planering, där du väljer tiden.</p>
      </div> : null}
      {error ? <p role="alert" className="text-sm text-destructive" data-testid="task-assign-error">{error}</p> : null}
      <DialogActions cancel={{ onClick: () => close(false) }} primary={{ label: choice.more.length ? "Tilldela och boka" : "Tilldela", type: "submit", busy, busyLabel: "Sparar…", testId: "task-assign-confirm" }} />
    </form>
  </Modal>;
}
