export const WORKFLOW_MODULE_IDS = [
  "kfid",
  "risk-assessment",
  "work-order",
  "periodic-control",
  "governing-documents",
  "self-inspection",
] as const;

export type WorkflowModuleId = (typeof WORKFLOW_MODULE_IDS)[number];
export type WorkflowModuleLifecycle = "ACTIVE" | "PLANNED";
export type WorkflowModuleAccess =
  | { kind: "INCLUDED" }
  | { kind: "NOT_CONFIGURED" };

export type WorkflowModule = {
  id: WorkflowModuleId;
  name: string;
  description: string;
  lifecycle: WorkflowModuleLifecycle;
  route: string | null;
  access: WorkflowModuleAccess;
  capabilities: readonly string[];
};

const definitions = [
  {
    id: "kfid",
    name: "KFID",
    description: "Kontroll före idrifttagning.",
    lifecycle: "ACTIVE",
    route: "/",
    access: { kind: "INCLUDED" },
    capabilities: ["customers", "controls", "attachments", "reports"],
  },
  {
    id: "risk-assessment",
    name: "Riskbedömning",
    description: "Riskbedömningar med spårbarhet, ansvar och uppföljning.",
    lifecycle: "ACTIVE",
    route: "/?view=new_task",
    access: { kind: "INCLUDED" },
    capabilities: ["projects", "customers", "facilities", "risk-register", "approval"],
  },
  {
    id: "work-order",
    name: "Arbetsorder",
    description: "Arbetsorder med ansvar, tidrapportering, utförande, signering och avslut.",
    lifecycle: "ACTIVE",
    route: "/?view=new_task",
    access: { kind: "INCLUDED" },
    capabilities: ["projects", "customers", "facilities", "time", "attachments", "reports"],
  },
  {
    id: "periodic-control",
    name: "Fortlöpande kontroll",
    description: "Planerad modul för återkommande kontrollarbete.",
    lifecycle: "PLANNED",
    route: null,
    access: { kind: "NOT_CONFIGURED" },
    capabilities: [],
  },
  {
    id: "governing-documents",
    name: "Styrdokument",
    description: "Planerad modul för styrande dokument och uppföljning.",
    lifecycle: "PLANNED",
    route: null,
    access: { kind: "NOT_CONFIGURED" },
    capabilities: [],
  },
  // Etapp 1 (2026-10-06): the company's programme, roles, deviation log, yearly review and versions.
  {
    id: "self-inspection",
    name: "Egenkontrollprogram",
    description: "Egenkontrollprogram för elinstallationsarbete med roller och nivåer, krävd nivå per uppgiftstyp, avvikelser, årlig översyn och versioner.",
    lifecycle: "ACTIVE",
    route: "/?view=self_inspection",
    access: { kind: "INCLUDED" },
    capabilities: ["program", "roles", "levels", "deviations", "review", "versions", "reports"],
  },
] as const satisfies readonly WorkflowModule[];

export const workflowModules: readonly WorkflowModule[] = definitions;

export function getWorkflowModule(id: string) {
  return workflowModules.find((module) => module.id === id) ?? null;
}

export function enabledWorkflowModules() {
  return workflowModules.filter(
    (module) =>
      module.lifecycle === "ACTIVE" &&
      module.route !== null &&
      module.access.kind === "INCLUDED",
  );
}
