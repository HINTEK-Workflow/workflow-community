"use client";

import { useDetailLevel, useNativeMode } from "./use-detail-level";

/**
 * Uppdraget (proposal 2026-10-08, step 1): what the fitter must always see, above a task page's panels – the job's
 * description, the place, the temporary place (Tillfällig plats, 2026-10-08), the reported fault and the customer's
 * special requirements. On levels 1–2, where the panels start folded, all of it; on level 3 (and a computer), where
 * Grunduppgifter and Underhåll are open, only the customer's requirements, which otherwise sit in a folded panel. In the app
 * (a phone, also with Visa mer, A2) always all of it: the job is never left out with the content level. Shown
 * only what is filled in; nothing here can be edited.
 */
export function TaskBrief({ description, place, tempPlace, fault, requirements }: { description?: string; place?: string; tempPlace?: string; fault?: string; requirements?: string }) {
  const level = useDetailLevel();
  const native = useNativeMode();
  const all: { label: string; value?: string; testId: string }[] = [
    ...(level < 3 || native ? [
      { label: "Beskrivning", value: description, testId: "task-brief-description" },
      { label: "Plats", value: place, testId: "task-brief-place" },
      { label: "Tillfällig plats", value: tempPlace, testId: "task-brief-temp-place" },
      { label: "Fel eller symptom", value: fault, testId: "task-brief-fault" },
    ] : []),
    { label: "Kundens särskilda krav", value: requirements, testId: "self-inspection-customer-requirements" },
  ];
  const rows = all.filter((row) => row.value?.trim());
  if (!rows.length) return null;
  return <section aria-labelledby="task-brief-heading" data-testid="task-brief" className="app-bleed rounded-xl border bg-card px-5 py-4 shadow-xs">
    <h2 id="task-brief-heading" className="section-title">Uppdraget</h2>
    <dl className="mt-3 grid gap-3 text-sm">
      {rows.map(({ label, value, testId }) => <div key={label} data-testid={testId}>
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 whitespace-pre-line">{value}</dd>
      </div>)}
    </dl>
  </section>;
}
