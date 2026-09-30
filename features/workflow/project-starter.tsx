"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, Plus, ShieldAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { KFID_FORM_ID, RISK_FORM_ID } from "@/lib/workflow/builtin-originals";

type PublishedForm = { id: string; name: string; baseId?: string | null; allowInProject?: boolean };

/**
 * Flödesvåg 2 (2026-09-30): a new project without tasks suggests its first tasks in the usual order of work –
 * a risk assessment before the work starts, the work order for the work itself and the commissioning control before
 * the installation is taken into use. Rule-based; each suggestion opens the ordinary editor with the project (and its
 * customer) filled in and nothing is created until the person saves. The risk assessment and the control exist as
 * published forms (HINTEK's original, or the company's own version, which wins), so they are only offered when
 * published and allowed in projects; the person's create permissions decide the rest.
 */
export function ProjectStarter({ projectId, customerId, canCreate }: {
  projectId: string;
  customerId?: string | null;
  canCreate: { workOrder: boolean; risk: boolean; control: boolean };
}) {
  const [forms, setForms] = useState<PublishedForm[] | null>(null);
  useEffect(() => {
    if (!canCreate.risk && !canCreate.control) return;
    let active = true;
    api<{ forms: PublishedForm[] }>("/api/forms").then((result) => { if (active) setForms(result.forms); }).catch(() => { if (active) setForms([]); });
    return () => { active = false; };
  }, [canCreate.risk, canCreate.control]);
  const context = `&projectId=${encodeURIComponent(projectId)}${customerId ? `&customerId=${encodeURIComponent(customerId)}` : ""}`;
  // The company's own version of an original takes its place, as on the Ny uppgift cards.
  const formFor = (originalId: string) => (forms ?? []).filter((form) => (form.baseId ?? form.id) === originalId && form.allowInProject !== false)
    .sort((a, b) => Number(Boolean(b.baseId)) - Number(Boolean(a.baseId)))[0];
  const risk = canCreate.risk ? formFor(RISK_FORM_ID) : undefined;
  const control = canCreate.control ? formFor(KFID_FORM_ID) : undefined;
  const formHref = (form: PublishedForm) => `/?view=workflow_task&taskType=FORM&formId=${encodeURIComponent(form.id)}${context}`;
  const steps = [
    risk ? { key: "risk", icon: ShieldAlert, title: risk.name, text: "Innan arbetet börjar", href: formHref(risk) } : null,
    canCreate.workOrder ? { key: "work-order", icon: Wrench, title: "Arbetsorder", text: "Själva arbetet", href: `/?view=workflow_task&taskType=WORK_ORDER${context}` } : null,
    control ? { key: "control", icon: ClipboardCheck, title: control.name, text: "Innan anläggningen tas i drift", href: formHref(control) } : null,
  ].filter((step) => step !== null);
  return <Panel title="Kom igång med projektet" description="Projektet har inga uppgifter ännu. Förslag i den vanliga arbetsordningen – inget skapas förrän du sparar." className="project-starter">
    <ol className="grid gap-3 sm:grid-cols-3" data-testid="project-starter">
      {steps.map((step, index) => <li key={step.key}>
        <Link href={step.href} data-testid={`project-starter-${step.key}`} className="group flex h-full items-start gap-3 rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:bg-secondary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><step.icon className="size-5" /></span>
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">{index + 1}. {step.text}</span>
            <span className="mt-1 block text-sm font-semibold group-hover:text-primary">{step.title}</span>
          </span>
        </Link>
      </li>)}
    </ol>
    <div className="mt-3 flex justify-end">
      <Button asChild variant="outline"><Link href={`/?view=new_task${context}`}><Plus />Alla uppgiftstyper</Link></Button>
    </div>
  </Panel>;
}
