import { normalizeControl, type ControlData } from "@/lib/kfid/model";
import {
  assertAgentToolAllowed,
  getWorkflowAgent,
  type WorkflowAgentDefinition,
} from "@/lib/ai/agent-registry";

export type PreparedAgentRun = {
  agent: WorkflowAgentDefinition;
  organizationId: string;
  controlId: string;
  input: {
    control: Pick<ControlData, "active" | "iso" | "cont" | "volt" | "rcd" | "vis"> & {
      meta: Pick<ControlData["meta"], "date" | "instr" | "sn" | "cal" | "autoOn">;
    };
    validation: unknown;
    attachmentCount: number;
  };
};

export function prepareAgentRun(input: {
  agentId: string;
  organizationId: string;
  resourceOrganizationId: string;
  controlId: string;
  creditBalance: number;
  control: unknown;
  validation: unknown;
  attachmentCount: number;
}): PreparedAgentRun {
  const agent = getWorkflowAgent(input.agentId);
  if (!agent) throw new Error("AI-agenten finns inte.");
  if (agent.id !== "kfid-control-review")
    throw new Error("Endast KFID-kontrollgranskaren får förbereda en kontrollkörning.");
  if (input.organizationId !== input.resourceOrganizationId)
    throw new Error("Kontrollen tillhör inte den aktiva organisationen.");
  if (agent.limits.requiresPositiveCredits && input.creditBalance <= 0)
    throw new Error("Positivt kreditsaldo krävs för AI-körningen.");
  if (!Number.isInteger(input.attachmentCount) || input.attachmentCount < 0)
    throw new Error("Bilageantalet är ogiltigt.");

  const control = normalizeControl(input.control);
  return {
    agent,
    organizationId: input.organizationId,
    controlId: input.controlId,
    input: {
      control: {
        active: control.active,
        iso: control.iso,
        cont: control.cont,
        volt: control.volt,
        rcd: control.rcd,
        vis: control.vis,
        meta: {
          date: control.meta.date,
          instr: control.meta.instr,
          sn: control.meta.sn,
          cal: control.meta.cal,
          autoOn: control.meta.autoOn,
        },
      },
      validation: input.validation,
      attachmentCount: input.attachmentCount,
    },
  };
}

export function validateAgentToolCalls(
  run: PreparedAgentRun,
  calls: readonly { name: string }[],
) {
  if (calls.length > run.agent.limits.maxToolCalls)
    throw new Error("AI-agenten begärde fler verktygsanrop än tillåtet.");
  return calls.map((call) => assertAgentToolAllowed(run.agent, call.name));
}

export function agentAuditSummary(
  run: PreparedAgentRun,
  status: "PREPARED" | "REJECTED" | "COMPLETED",
  toolNames: readonly string[] = [],
) {
  return {
    agentId: run.agent.id,
    moduleId: run.agent.moduleId,
    organizationId: run.organizationId,
    controlId: run.controlId,
    status,
    toolNames: [...toolNames],
    attachmentCount: run.input.attachmentCount,
  };
}
