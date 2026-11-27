"use client";

import { useState } from "react";
import { Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { indicatorBadge } from "./indicator-tone";
import { Input } from "@/components/ui/input";
import { Panel } from "@/features/kfid/ui";
import { fromSwedishDateTimeInputKeeping, NONEXISTENT_TIME_ERROR, toSwedishDateTimeInput } from "@/lib/swedish-time";
import {
  CRITICALITIES, CRITICALITY_TEXTS, emptyMaintenance, formatDowntime, MARKING_MAX_LENGTH, MAINTENANCE_CAUSE_LABELS, MAINTENANCE_CAUSES, MAINTENANCE_PRIORITIES, MAINTENANCE_PRIORITY_LABELS, MAINTENANCE_TYPE_HINTS,
  MAINTENANCE_TYPE_LABELS, MAINTENANCE_TYPES, maintenanceDowntimeMinutes, maintenanceTimeIssue, type MaintenanceFacts,
} from "@/lib/workflow/maintenance";

/**
 * The maintenance facts of a maintenance item (2026-10-06; since 2026-10-30 on the item, no longer on the work
 * order): type, priority, criticality, marking, fault, cause, reported time and downtime. Nothing is required (B7); the
 * action is the work order's Utfört arbete. Used by the item's page (features/maintenance/maintenance-item-editor.tsx).
 */
export function MaintenanceFields({ value, onChange, disabled = false }: { value: MaintenanceFacts | undefined; onChange: (value: MaintenanceFacts) => void; disabled?: boolean }) {
  const current = value ?? emptyMaintenance();
  const set = (patch: Partial<MaintenanceFacts>) => onChange({ ...current, ...patch });
  // A clock time that does not exist (the March night) is refused with a sentence under the field; the saved value stays.
  const [invalid, setInvalid] = useState<Partial<Record<"reportedAt" | "stoppedAt" | "restoredAt", string>>>({});
  const downtime = maintenanceDowntimeMinutes(current);
  const issue = maintenanceTimeIssue(current);
  const field = "block space-y-2 text-xs font-medium text-muted-foreground";
  const time = (key: "reportedAt" | "stoppedAt" | "restoredAt", label: string, id: string) => <label className={field} htmlFor={id}>{label}
    <span className="flex gap-2">
      <Input id={id} type="datetime-local" className="min-w-0 flex-1" disabled={disabled} value={current[key] ? toSwedishDateTimeInput(current[key]!) : ""}
        aria-invalid={invalid[key] ? true : undefined} aria-describedby={invalid[key] ? `${id}-problem` : undefined}
        onChange={(event) => {
          const text = event.target.value;
          // The saved instant is kept while the field shows it (the repeated October hour); a time that never happens is refused (2026-10-21).
          const parsed = text ? fromSwedishDateTimeInputKeeping(text, current[key]) : null;
          if (text && !parsed) { setInvalid((state) => ({ ...state, [key]: NONEXISTENT_TIME_ERROR })); return; }
          setInvalid((state) => ({ ...state, [key]: undefined }));
          set({ [key]: parsed ? parsed.toISOString() : null });
        }} />
      {!current[key] && !disabled ? <Button type="button" variant="outline" onClick={() => set({ [key]: new Date().toISOString() })}>Nu</Button> : null}
    </span>
    {invalid[key] ? <span id={`${id}-problem`} role="alert" className="block font-normal text-destructive">{invalid[key]}</span> : null}
  </label>;
  // The priority shows in the heading (Akut in red).
  return <Panel title="Underhåll" description="Här fyller du i typ av underhåll, prioritet, kritikalitet, fel och stillestånd. Åtgärden skriver du under Utfört arbete på arbetsordern."
    actions={current.priority ? <Badge variant="outline" data-testid="task-maintenance-priority-badge" className={cn(indicatorBadge(current.priority === "URGENT" ? "danger" : current.priority === "HIGH" ? "warning" : "neutral"), current.priority === "URGENT" && "font-semibold")}>{MAINTENANCE_PRIORITY_LABELS[current.priority]}</Badge> : null}
    icon={Wrench}>
    <div className="grid gap-4 sm:grid-cols-2" data-testid="task-maintenance">
      <label className={field}>Typ av underhåll<select className="form-select" id="task-maintenance-type" disabled={disabled} value={current.type} onChange={(event) => set({ type: event.target.value as MaintenanceFacts["type"] })}>
        <option value="">Inte angiven</option>
        {MAINTENANCE_TYPES.map((type) => <option key={type} value={type}>{MAINTENANCE_TYPE_LABELS[type]} – {MAINTENANCE_TYPE_HINTS[type].toLowerCase()}</option>)}
      </select></label>
      <label className={field}>Prioritet<select className="form-select" id="task-maintenance-priority" disabled={disabled} value={current.priority} onChange={(event) => set({ priority: event.target.value as MaintenanceFacts["priority"] })}>
        <option value="">Inte angiven</option>
        {MAINTENANCE_PRIORITIES.map((priority) => <option key={priority} value={priority}>{MAINTENANCE_PRIORITY_LABELS[priority]}</option>)}
      </select></label>
      <label className={field}>Kritikalitet<select className="form-select" id="task-maintenance-criticality" disabled={disabled} value={current.criticality} onChange={(event) => set({ criticality: event.target.value as MaintenanceFacts["criticality"] })}>
        <option value="">Inte angiven</option>
        {CRITICALITIES.map((level) => <option key={level} value={level}>{level} – {CRITICALITY_TEXTS[level]}</option>)}
      </select></label>
      <label className={field}>Märkning<Input id="task-maintenance-marking" maxLength={MARKING_MAX_LENGTH} disabled={disabled} value={current.marking} onChange={(event) => set({ marking: event.target.value })} placeholder="Till exempel E12" /></label>
      <label className={`${field} sm:col-span-2`}>Fel eller symptom<textarea aria-label="Fel eller symptom" id="task-maintenance-fault" className="form-textarea" maxLength={2000} disabled={disabled} value={current.fault} onChange={(event) => set({ fault: event.target.value })} placeholder="Vad märktes, och när?" /></label>
      <label className={field}>Orsak<select className="form-select" id="task-maintenance-cause" disabled={disabled} value={current.cause} onChange={(event) => set({ cause: event.target.value as MaintenanceFacts["cause"] })}>
        <option value="">Inte angiven</option>
        {MAINTENANCE_CAUSES.map((cause) => <option key={cause} value={cause}>{MAINTENANCE_CAUSE_LABELS[cause]}</option>)}
      </select></label>
      <label className={field}>{current.cause === "OTHER" ? "Annan orsak" : "Om orsaken"}<Input id="task-maintenance-cause-note" maxLength={500} disabled={disabled} value={current.causeNote} onChange={(event) => set({ causeNote: event.target.value })} placeholder={current.cause === "OTHER" ? "Beskriv orsaken" : "Valfritt"} /></label>
      {time("reportedAt", "Felanmält", "task-maintenance-reported")}
      <div className="hidden sm:block" aria-hidden="true" />
      {time("stoppedAt", "Ur drift", "task-maintenance-stopped")}
      {time("restoredAt", "Åter i drift", "task-maintenance-restored")}
    </div>
    <p className={issue ? "mt-3 text-xs text-destructive" : "mt-3 text-xs text-muted-foreground"} role={issue ? "alert" : undefined} data-testid="task-maintenance-downtime">
      {issue || (downtime !== null ? `Stilleståndstid: ${formatDowntime(downtime)}` : "Stilleståndstiden räknas när både Ur drift och Åter i drift är ifyllda. Alla tider är svensk tid.")}
    </p>
  </Panel>;
}
