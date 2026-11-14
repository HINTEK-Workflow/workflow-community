"use client";

import { useState } from "react";
import { UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogActions, Modal } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";

/**
 * Ställföreträdare för bokningar (2026-10-09): on the project page, next to the responsible person. Others'
 * bookings are changed only by an admin, the project's responsible person or the stand-in named here; the responsible
 * person (or an admin) hands the right over, e.g. when sick, and takes it back. Shown to everyone who reads the project;
 * the buttons only to those the server lets hand over. The server decides and logs it in the project's history.
 */
export function PlanningDelegateRow({ project, members, canHandOver, onChanged }: {
  project: { id: string; responsibleUserId?: string | null; planningDelegateUserId?: string | null };
  members: { id: string; name: string }[];
  canHandOver: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const delegate = project.planningDelegateUserId ?? null;
  const delegateName = delegate ? members.find((member) => member.id === delegate)?.name ?? "En tidigare medlem" : "";
  const candidates = members.filter((member) => member.id !== project.responsibleUserId);
  if (!delegate && !canHandOver) return null;

  const save = async (userId: string | null) => {
    setBusy(true); setProblem("");
    try {
      await api("/api/projects", { method: "POST", body: JSON.stringify({ action: "planning_delegate", id: project.id, userId }) });
      setOpen(false);
      onChanged();
    } catch (issue) {
      setProblem(issue instanceof Error ? issue.message : "Det gick inte att spara.");
    } finally { setBusy(false); }
  };

  return <>
    <p data-testid="project-planning-delegate" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <UserCheck className="size-4" aria-hidden="true" />
      <span>{delegate ? <>Ställföreträdare för bokningar: {delegateName}</> : "Ingen ställföreträdare för bokningar"}</span>
      {canHandOver ? <span className="inline-flex gap-1">
        <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="project-planning-delegate-choose" onClick={() => { setChoice(delegate ?? ""); setProblem(""); setOpen(true); }}>{delegate ? "Byt" : "Lämna över"}</Button>
        {delegate ? <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="project-planning-delegate-revoke" onClick={() => void save(null)}>Ta tillbaka</Button> : null}
      </span> : null}
    </p>
    {problem && !open ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
    <Modal open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }} title="Lämna över bokningsrätten" size="compact">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (choice) void save(choice); }}>
        <p className="text-sm leading-6 text-muted-foreground">Ställföreträdaren får ändra andras bokningar i projektet, till exempel när projektansvarig är sjuk. Kan tas tillbaka när som helst.</p>
        <label className="field-stack text-xs font-medium text-muted-foreground">Ställföreträdare
          <select className="form-select" data-testid="project-planning-delegate-select" value={choice} onChange={(event) => setChoice(event.target.value)}>
            <option value="">Välj person</option>
            {candidates.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        <DialogActions cancel={{ onClick: () => setOpen(false) }} primary={{ label: "Lämna över", onClick: () => { if (choice) void save(choice); }, disabled: !choice || choice === delegate, busy, busyLabel: "Sparar…", testId: "project-planning-delegate-save" }} />
      </form>
    </Modal>
  </>;
}
