"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/features/kfid/ui";
import { announce } from "@/lib/workflow/toast";
import { formRiskKey, proposedRiskClass, RISK_CLASS_TEXTS, RISK_CLASSES, type RiskClass } from "@/lib/self-inspection/levels";
import { useRiskLevels } from "./work";

/**
 * Where an admin sets a task type's risk class outside Egenkontroll (2026-10-07): in the form builder's basic
 * details and from a card under Ny uppgift. The class applies at once, belongs to the company (not to the form's published
 * version) and, together with the people's levels, decides who may be assigned, start, fill in, complete and sign.
 * Every change goes through the same action as Egenkontroll → Krävd nivå, so the server checks the admin right.
 */
const OPTION_PROPOSAL = (proposal: RiskClass) => `Förslag från Workflow: nivå ${proposal}`;

/** The form builder's field: the form family's class; a new form has none until it is saved. */
export function RiskClassSetting({ formId, category }: { formId: string | null; category: string }) {
  const { levels, set } = useRiskLevels(true);
  const [busy, setBusy] = useState(false);
  if (!formId) return <p className="text-xs text-muted-foreground" data-testid="form-risk-class-unsaved">Spara utkastet först, så kan ni sätta formulärets krävda nivå.</p>;
  const key = formRiskKey(formId);
  const own = levels?.riskClasses[key];
  const proposal = proposedRiskClass({ kind: "FORM", formId, category });
  return <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Krävd nivå
    <select id="form-meta-riskClass" data-testid="form-risk-class" className="form-select" disabled={busy || !levels} value={RISK_CLASSES.includes(own as RiskClass) ? String(own) : ""}
      onChange={async (event) => {
        setBusy(true);
        try { await set(key, event.target.value ? Number(event.target.value) : null); announce(event.target.value ? "Krävd nivå är sparad." : "Krävd nivå återgick till Workflows förslag."); }
        catch (issue) { announce((issue as Error).message, true); } finally { setBusy(false); }
      }}>
      <option value="">{OPTION_PROPOSAL(proposal)}</option>
      {RISK_CLASSES.map((item) => <option key={item} value={item}>{RISK_CLASS_TEXTS[item]}</option>)}
    </select>
    <span className="text-[11px] font-normal">Gäller direkt. Bara den vars nivå når upp till den får arbeta i protokollet.</span>
  </label>;
}

/** From a card under Ny uppgift: choose the class for that task type. */
export function RiskClassDialog({ name, current, proposal, onSave, onClose }: { name: string; current: RiskClass | null; proposal: RiskClass; onSave: (value: RiskClass | null) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState<RiskClass | null>(current);
  const [busy, setBusy] = useState(false);
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={`Krävd nivå – ${name}`} size="compact">
    <div className="space-y-4" data-testid="risk-class-dialog">
      <p className="text-sm text-muted-foreground">Bara den vars nivå når upp till den krävda nivån får arbeta i uppgiften. Ändringen gäller direkt för hela företaget.</p>
      <div role="radiogroup" aria-label="Krävd nivå" className="grid gap-2">
        {[null, ...RISK_CLASSES].map((item) => <label key={item ?? "proposal"} className="flex items-center gap-2 text-sm">
          <input type="radio" name="risk-class" checked={value === item} onChange={() => setValue(item)} />
          {item === null ? OPTION_PROPOSAL(proposal) : RISK_CLASS_TEXTS[item]}
        </label>)}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Avbryt</Button>
        <Button disabled={busy || value === current} onClick={async () => { setBusy(true); try { await onSave(value); onClose(); } catch (issue) { announce((issue as Error).message, true); } finally { setBusy(false); } }}>Spara</Button>
      </div>
    </div>
  </Modal>;
}
