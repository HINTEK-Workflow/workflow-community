"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { STAFF_REGISTER_ACTIVATION_DENIED, STAFF_REGISTER_HELP, STAFF_REGISTER_IN_WORKFLOW_HELP, STAFF_REGISTER_SCOPE_HINT, STAFF_REGISTER_SITE_ID_MAX, STAFF_REGISTER_TEXT_MAX, type StaffRegister } from "@/lib/workflow/staff-register";

const noSubscribe = () => () => {};

/**
 * Personalliggare, steg 0 (2026-10-08): a compact, folded section in the project form. Only when
 * "Personalliggare krävs" is ticked do the other fields show. Opens by itself when the project already requires it.
 * Steg 1 (2026-10-09): in Cloud the company chooses where the register is kept – in the system on site, or in
 * Workflow (check-in on the project page, Kontrollvy and export). Local files and the demo keep only steg 0.
 */
export function StaffRegisterFields({ value, onChange, cloud = false, canActivate = true }: { value: StaffRegister; onChange: (next: StaffRegister) => void; cloud?: boolean; canActivate?: boolean }) {
  // Fixed after the first render, so ticking the box off never folds the section under the person's finger.
  const [startsOpen] = useState(value.required);
  // Read after hydration, so the server's render and the browser's first render agree.
  const demo = useSyncExternalStore(noSubscribe, () => Boolean((window as typeof window & { __workflowDemo?: boolean }).__workflowDemo), () => false);
  const offerWorkflow = cloud && !demo;
  const inWorkflow = offerWorkflow && value.inWorkflow;
  // Only the project's responsible member or an admin switches Workflow's register on or off (2026-10-09 evening).
  const locked = offerWorkflow && !canActivate;
  const field = (key: "siteId" | "builder" | "system", label: string, max: number, placeholder?: string) => (
    <label className="block space-y-2 text-xs font-medium text-muted-foreground">{label}
      <Input value={value[key]} maxLength={max} placeholder={placeholder} data-testid={`project-staff-register-${key}`}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })} />
    </label>
  );
  const where = (keep: boolean, label: string) => (
    <label className="flex min-h-10 items-center gap-2 text-sm">
      <input type="radio" name="project-staff-register-where" className="size-4 accent-primary" disabled={locked} checked={inWorkflow === keep} data-testid={`project-staff-register-where-${keep ? "workflow" : "site"}`}
        onChange={() => onChange({ ...value, inWorkflow: keep })} />{label}
    </label>
  );
  return (
    <details className="field-group group rounded-xl border" open={startsOpen || undefined} data-testid="project-staff-register">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
        Personalliggare{value.required ? inWorkflow ? " · förs i Workflow" : " · krävs" : ""}
      </summary>
      <div className="space-y-4 border-t px-4 py-4">
        <label className="flex items-start gap-3 text-sm" htmlFor="project-staff-register-required">
          <Checkbox id="project-staff-register-required" data-testid="project-staff-register-required" disabled={locked && inWorkflow} checked={value.required}
            onCheckedChange={(checked) => onChange({ ...value, required: checked === true })} />
          <span><span className="font-medium">Personalliggare krävs</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{STAFF_REGISTER_HELP}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground" data-testid="project-staff-register-scope">{STAFF_REGISTER_SCOPE_HINT}</span></span>
        </label>
        {value.required && offerWorkflow ? <fieldset className="space-y-1">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Var förs personalliggaren?</legend>
          {where(false, "I systemet på plats")}
          {where(true, "I Workflow")}
          {inWorkflow ? <p className="text-xs leading-5 text-muted-foreground">{STAFF_REGISTER_IN_WORKFLOW_HELP}</p> : null}
          {locked ? <p className="text-xs leading-5 text-muted-foreground" data-testid="project-staff-register-locked">{STAFF_REGISTER_ACTIVATION_DENIED}</p> : null}
        </fieldset> : null}
        {value.required ? <div className="grid gap-4 sm:grid-cols-2">
          {field("siteId", "Byggarbetsplatsens id-nummer", STAFF_REGISTER_SITE_ID_MAX, "Från byggherren")}
          {field("builder", "Byggherre", STAFF_REGISTER_TEXT_MAX)}
          {inWorkflow ? null : <div className="sm:col-span-2">{field("system", "System på plats", STAFF_REGISTER_TEXT_MAX, "Till exempel huvudentreprenörens system")}</div>}
        </div> : null}
      </div>
    </details>
  );
}
