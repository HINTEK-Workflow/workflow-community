import {
  ClipboardCheck,
  ClipboardList,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export type WorkflowTaskTypeId =
  | "COMMISSIONING_CONTROL"
  | "WORK_ORDER"
  | "RISK_ASSESSMENT";

export type WorkflowTaskTypeDefinition = {
  id: WorkflowTaskTypeId;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  available: boolean;
};

export const WORKFLOW_TASK_TYPES: readonly WorkflowTaskTypeDefinition[] = [
  {
    id: "COMMISSIONING_CONTROL",
    label: "Kontroll före idrifttagning",
    shortLabel: "Kontroll före idrifttagning",
    description:
      "Dokumentera kontrollpunkter, mätningar och bilder samt skapa protokoll och export.",
    icon: ClipboardCheck,
    available: true,
  },
  {
    id: "WORK_ORDER",
    label: "Arbetsorder",
    shortLabel: "Arbetsorder",
    description:
      "Planera ett uppdrag med kund, anläggning, arbetsbeskrivning och ansvarig.",
    icon: ClipboardList,
    available: true,
  },
  {
    id: "RISK_ASSESSMENT",
    label: "Riskbedömning",
    shortLabel: "Riskbedömning",
    description:
      "Identifiera risker, dokumentera skyddsåtgärder och godkänn före arbetets start.",
    icon: ShieldCheck,
    available: true,
  },
] as const;

export const COMMISSIONING_CONTROL = WORKFLOW_TASK_TYPES[0];

export function workflowTaskType(id: WorkflowTaskTypeId) {
  return WORKFLOW_TASK_TYPES.find((item) => item.id === id);
}
