export const WORKFLOW_MODULE_IDS = [
  "kfid",
  "risk-assessment",
  "work-order",
  "self-inspection",
] as const;

export type WorkflowModuleId = (typeof WORKFLOW_MODULE_IDS)[number];

export type WorkflowModule = {
  id: WorkflowModuleId;
  name: string;
  description: string;
  route: string;
  capabilities: readonly string[];
};

// Only modules that exist (2026-11-20): the planned "Fortlöpande kontroll" and "Styrdokument" placeholders, which nothing
// read, are gone; a new module is added here when it is built.
const definitions = [
  {
    id: "kfid",
    name: "KFID",
    description: "Kontroll före idrifttagning.",
    route: "/",
    capabilities: ["customers", "controls", "attachments", "reports"],
  },
  {
    id: "risk-assessment",
    name: "Riskbedömning",
    description: "Riskbedömningar med spårbarhet, ansvar och uppföljning.",
    route: "/?view=new_task",
    capabilities: ["projects", "customers", "facilities", "risk-register", "approval"],
  },
  {
    id: "work-order",
    name: "Arbetsorder",
    description: "Arbetsorder med ansvar, tidrapportering, utförande, signering och avslut.",
    route: "/?view=new_task",
    capabilities: ["projects", "customers", "facilities", "time", "attachments", "reports"],
  },
  // Etapp 1 (2026-10-06): the company's programme, roles, deviation log, yearly review and versions.
  {
    id: "self-inspection",
    name: "Egenkontrollprogram",
    description: "Egenkontrollprogram för elinstallationsarbete med roller och nivåer, krävd nivå per uppgiftstyp, avvikelser, årlig översyn och versioner.",
    route: "/?view=self_inspection",
    capabilities: ["program", "roles", "levels", "deviations", "review", "versions", "reports"],
  },
] as const satisfies readonly WorkflowModule[];

export const workflowModules: readonly WorkflowModule[] = definitions;

export function getWorkflowModule(id: string) {
  return workflowModules.find((module) => module.id === id) ?? null;
}

export function enabledWorkflowModules() {
  return workflowModules;
}
