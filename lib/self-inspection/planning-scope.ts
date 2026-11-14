import { formDocumentSchema, formLeafBlocks, formOptionalSections, formSectionActive, formValuesSchema, type FormDocument, type FormValues } from "../workflow/form-document";
import { PLANNING_SCOPE_KEY, PLANNING_SCOPE_POINTS } from "../workflow/builtin-planning-form";

/**
 * The scope of the inspection from the planning (2026-10-07): a protocol of "Planering och kravbestämning" says under
 * "Kontroller som ska göras" which checks the work needs, and a new Kontroll före idrifttagning in the same project
 * starts with those moments switched on. Only a suggestion – the technician changes the moments as usual, and a control
 * that already exists is never touched. Pure, so Cloud, Local and the demo answer alike; nothing in either form changes.
 */
export type PlanningProtocol = { id: string; title: string; updatedAt: string; document: unknown; values: unknown };
/** The planning protocol the suggestion comes from and the moments (section ids of the control) it selects. */
export type PlanningScope = { taskId: string; title: string; sections: string[] };

const same = (a: string, b: string) => a.trim().toLocaleLowerCase("sv") === b.trim().toLocaleLowerCase("sv");

/** The moments one planning protocol selects: its ticked points, in the order of the points. A form that is not the planning form selects none. */
export function planningProtocolSections(protocol: Pick<PlanningProtocol, "document" | "values">): string[] {
  const document = formDocumentSchema.safeParse(protocol.document);
  const values = formValuesSchema.safeParse(protocol.values);
  if (!document.success || !values.success) return [];
  const checklist = formLeafBlocks(document.data).find((block) => block.type === "checklist" && block.key === PLANNING_SCOPE_KEY);
  if (!checklist || checklist.type !== "checklist") return [];
  const answers = values.data.checklists[PLANNING_SCOPE_KEY] ?? {};
  const sections: string[] = [];
  for (const item of checklist.items) {
    if (answers[item.id]?.state !== "OK") continue;
    // By the point's id (a company can reword it), otherwise by its text.
    const point = PLANNING_SCOPE_POINTS.find((candidate) => candidate.id === item.id) ?? PLANNING_SCOPE_POINTS.find((candidate) => same(candidate.text, item.text));
    if (point && !sections.includes(point.moment)) sections.push(point.moment);
  }
  return sections;
}

/** The suggestion from the project's planning protocols: the latest one that selects something. None when no protocol does. */
export function planningScope(protocols: readonly PlanningProtocol[]): PlanningScope | null {
  for (const protocol of [...protocols].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))) {
    const sections = planningProtocolSections(protocol);
    if (sections.length) return { taskId: protocol.id, title: protocol.title, sections };
  }
  return null;
}

/**
 * Whether a control still waits for its moments to be chosen: none is on. The suggestion is only used then, so a choice
 * the technician has made is never replaced.
 */
export function momentsNotChosen(document: FormDocument, values: Pick<FormValues, "sections">) {
  const moments = formOptionalSections(document);
  return moments.length > 0 && moments.every((section) => !formSectionActive(section, values));
}

/** The control's answers with the suggested moments switched on; moments the form does not have are ignored. */
export function applyPlanningMoments<T extends Pick<FormValues, "sections">>(document: FormDocument, values: T, sections: readonly string[]): T {
  const known = new Set(formOptionalSections(document).map((section) => section.id));
  const wanted = sections.filter((section) => known.has(section));
  if (!wanted.length) return values;
  const next = { ...values.sections };
  let changed = false;
  for (const section of wanted) if (next[section] !== true) { next[section] = true; changed = true; }
  return changed ? { ...values, sections: next } : values;
}

/** Whether the form has any of the moments a planning protocol can select (Kontroll före idrifttagning or a copy of it): only such a form asks for the scope. */
export function documentHasPlanningMoments(document: FormDocument) {
  const moments = new Set<string>(PLANNING_SCOPE_POINTS.map((point) => point.moment));
  return formOptionalSections(document).some((section) => moments.has(section.id));
}

/**
 * The note under the moments: what the planning says, and – while the moments on are exactly those – that they were
 * preselected from it. Empty when the form has none of the moments the planning selected.
 */
export function planningNote(document: FormDocument, values: Pick<FormValues, "sections">, scope: Pick<PlanningScope, "title" | "sections">) {
  const planned = formOptionalSections(document).filter((section) => scope.sections.includes(section.id));
  if (!planned.length) return "";
  const titles = planned.map((section) => section.title || "Avsnitt").join(", ");
  const name = scope.title || "Planering och kravbestämning";
  const on = formOptionalSections(document).filter((section) => formSectionActive(section, values)).map((section) => section.id);
  const unchanged = on.length === planned.length && planned.every((section) => on.includes(section.id));
  return unchanged ? `Förvalt från planeringen ”${name}”: ${titles}. Ändra efter behov.` : `Planeringen ”${name}” anger: ${titles}.`;
}
