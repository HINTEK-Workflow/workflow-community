import { applySelfInspectionAction } from "@/lib/self-inspection/document";
import { levelsView, type RiskSubject } from "@/lib/self-inspection/levels";
import { cardHistory, documentLevels, selfInspectionView, type Person, type SelfInspectionDocument } from "@/lib/self-inspection/model";
import type { PlanningScope } from "@/lib/self-inspection/planning-scope";
import { workContext } from "@/lib/self-inspection/work";
import { documentOrders, orderForRow as findOrderForRow, storedOrderFacts, withDeviationOrders, type DeviationRow, type StoredOrder } from "@/lib/self-inspection/deviation-link";
import type { KitIdentity } from "@/lib/workflow/report-kit";
import { browserDeviationExporter } from "./deviation-export-menu";
import { downloadSelfInspectionPdfInBrowser, type SelfInspectionBackend } from "./self-inspection-page";
import type { SelfInspectionWorkBackend } from "./work";

/**
 * Egenkontroll in Local (2026-10-06): the programme lives in the open .hwf file with the same document and rules
 * as Cloud. The file's owner is its administrator; other people are named in the file, since Local has no member list.
 */
export function localSelfInspectionBackend(input: { doc: SelfInspectionDocument; save: (next: SelfInspectionDocument) => Promise<void>; me: Person; company: string;
  /** The company's colours, logo and sender for the PDFs drawn in the browser (PDF review 2026-11-03, finding 1); absent = the name alone. */
  identity?: () => Promise<KitIdentity>;
  /** Avvikelse ↔ arbetsorder (2026-10-10): the file's tasks (the log's work orders) and "Skapa arbetsorder", which saves the order and the link in one change. */
  tasks?: readonly StoredOrder[]; createWorkOrder?: (deviationId: string) => Promise<{ doc: SelfInspectionDocument; tasks: readonly StoredOrder[] }> }): SelfInspectionBackend {
  const people = [input.me];
  const viewOf = async (doc: SelfInspectionDocument, tasks = input.tasks ?? []) => withDeviationOrders(await selfInspectionView(doc, { me: input.me, admin: true, company: input.company, people, activePeople: people,
    // The file's owner is its administrator and counts as level 3; the people named in the file are checked.
    levels: documentLevels(doc, new Map(), input.me.id) }), documentOrders(doc, tasks), { read: true, create: Boolean(input.createWorkOrder) });
  const orderForRow = (row: DeviationRow) => storedOrderFacts(findOrderForRow(input.tasks ?? [], row), () => input.me);
  return {
    namedPeople: true,
    storageNote: "Programmet sparas i den öppna Workflow-filen.",
    load: () => viewOf(input.doc),
    act: async (action) => {
      const next = await applySelfInspectionAction(input.doc, action, { ...input.me, admin: true }, { people, namedPeople: true, orderForRow });
      await input.save(next);
      return viewOf(next);
    },
    ...(input.createWorkOrder ? { createWorkOrder: async (deviationId: string) => { const next = await input.createWorkOrder!(deviationId); return viewOf(next.doc, next.tasks); } } : {}),
    pdf: (version, company) => downloadSelfInspectionPdfInBrowser(version, input.identity ?? (company || input.company)),
    // Exportera på Avvikelser: drawn in the browser with the same identity as the programme's PDF.
    deviationExporter: (company) => browserDeviationExporter(company, undefined, input.identity),
    // Kompetenskort v2: the history kept in the file (the owner is its administrator).
    history: async (personId) => cardHistory(input.doc, personId, { id: input.me.id, admin: true }),
  };
}

/**
 * What the file knows about the project or task: its customer's special requirements (the customer card's field), the
 * scope its project's planning protocol selects (2026-10-07), and the task type a risk class comes from (a stored task, or
 * the form or kind a new one starts from).
 */
export type LocalWorkTarget = { projectId: string | null; customerRequirements: string; planning: PlanningScope | null; subject?: (RiskSubject & { name?: string }) | null };

/** The same programme for a project or task in the open file (etapp 2–3); `targetOf` reads the work's customer, planning and task type from the file. */
export function localSelfInspectionWork(input: { doc: SelfInspectionDocument; save: (next: SelfInspectionDocument) => Promise<void>; me: Person;
  /** The file's tasks: an entry logged from a row that has a work order starts linked to it (2026-10-10). */
  tasks?: readonly StoredOrder[];
  targetOf: (target: { projectId?: string | null; taskId?: string | null; formId?: string | null; kind?: string | null }) => LocalWorkTarget }): SelfInspectionWorkBackend {
  return {
    context: async (target) => {
      const found = input.targetOf(target);
      return workContext(input.doc, { taskId: target.taskId ?? null, projectId: target.projectId ?? found.projectId, customerRequirements: found.customerRequirements, planning: found.planning,
        me: input.me, owner: true, admin: true, subject: found.subject ?? null });
    },
    levels: async () => levelsView(documentLevels(input.doc, new Map(), input.me.id), input.me.id, input.doc.riskClasses ?? {}),
    act: async (action) => {
      await input.save(await applySelfInspectionAction(input.doc, action, { ...input.me, admin: true }, { people: [input.me], namedPeople: true,
        orderForRow: (row) => storedOrderFacts(findOrderForRow(input.tasks ?? [], row), () => input.me) }));
    },
  };
}
