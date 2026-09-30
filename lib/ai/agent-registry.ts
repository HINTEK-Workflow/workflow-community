import { z } from "zod";
import type { WorkflowModuleId } from "@/lib/modules";

export const WORKFLOW_AGENT_IDS = [
  "workflow-assistant",
  "kfid-control-review",
] as const;
export type WorkflowAgentId = (typeof WORKFLOW_AGENT_IDS)[number];

const toolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
  description: z.string().min(10).max(500),
  effect: z.enum(["READ", "PROPOSE", "MUTATE"]),
  strict: z.literal(true),
  parameters: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()),
    additionalProperties: z.literal(false),
  }),
});

const agentSchema = z.object({
  id: z.enum(WORKFLOW_AGENT_IDS),
  moduleId: z.custom<WorkflowModuleId>().nullable(),
  name: z.string().min(1),
  purpose: z.string().min(20),
  lifecycle: z.enum(["DESIGN_ONLY", "ENABLED"]),
  dataPolicy: z.object({
    allowed: z.array(z.string()).min(1),
    prohibited: z.array(z.string()).min(1),
  }),
  limits: z.object({
    maxToolCalls: z.number().int().positive().max(10),
    maxOutputTokens: z.number().int().positive().max(10_000),
    requiresPositiveCredits: z.boolean(),
  }),
  tools: z.array(toolSchema).max(10),
});

export type WorkflowAgentDefinition = z.infer<typeof agentSchema>;

const definitions: readonly WorkflowAgentDefinition[] = [
  agentSchema.parse({
    id: "workflow-assistant",
    moduleId: null,
    name: "HINTEK AI",
    purpose:
      "Besvara personliga Workflow-frågor och söka i tenantverifierad information utan att ändra verksamhetsdata.",
    lifecycle: "ENABLED",
    dataPolicy: {
      allowed: [
        "användarens personliga Workflow-konversation",
        "minimerade tenantverifierade sökresultat",
      ],
      prohibited: [
        "andra organisationers data",
        "autentiseringsuppgifter eller hemligheter",
        "direkt mutation av verksamhetsdata",
        "bilageinnehåll innan separat uttryckligt stöd byggts",
      ],
    },
    limits: {
      maxToolCalls: 1,
      maxOutputTokens: 3_000,
      requiresPositiveCredits: true,
    },
    tools: [
      {
        name: "search_workflow",
        description:
          "Sök endast bland minimerade kunder och KFID-kontroller som den aktuella serververifierade användaren får läsa.",
        effect: "READ",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", minLength: 2, maxLength: 200 },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    ],
  }),
  agentSchema.parse({
    id: "kfid-control-review",
    moduleId: "kfid",
    name: "KFID kontrollgranskare",
    purpose:
      "Granska en redan sparad KFID-kontroll och föreslå tydliga kontrollpunkter utan att ändra arbetsytan.",
    lifecycle: "DESIGN_ONLY",
    dataPolicy: {
      allowed: [
        "aktuell kontrolls tekniska formulärdata",
        "aktuell kontrolls valideringsresultat",
        "antal bilagor utan filinnehåll",
      ],
      prohibited: [
        "andra organisationers data",
        "autentiseringsuppgifter eller hemligheter",
        "bilageinnehåll innan separat uttryckligt stöd byggts",
      ],
    },
    limits: {
      maxToolCalls: 2,
      maxOutputTokens: 2_000,
      requiresPositiveCredits: true,
    },
    tools: [
      {
        name: "read_current_control",
        description:
          "Läs endast den kontroll som servern redan har tenant- och medlemskapsverifierat för den aktuella körningen.",
        effect: "READ",
        strict: true,
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ],
  }),
];

export const workflowAgents = definitions;

export function getWorkflowAgent(id: string) {
  return workflowAgents.find((definition) => definition.id === id) ?? null;
}

export function executableWorkflowAgents() {
  return workflowAgents.filter((definition) => definition.lifecycle === "ENABLED");
}

export function assertAgentToolAllowed(
  agent: WorkflowAgentDefinition,
  toolName: string,
) {
  const tool = agent.tools.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error("AI-verktyget är inte tillåtet för den här agenten.");
  if (tool.effect === "MUTATE")
    throw new Error("Muterande AI-verktyg kräver ett separat bekräftelseflöde.");
  return tool;
}
