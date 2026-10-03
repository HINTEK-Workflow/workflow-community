import { z } from "zod";
import type { WorkflowModuleId } from "@/lib/modules";
import { ASSISTANT_MAX_TOOL_CALLS, ASSISTANT_READ_TOOLS, strictToolParameters } from "@/lib/ai/assistant-tools";
import { TOOL_CATALOG } from "@/lib/tools/catalog";

export const WORKFLOW_AGENT_IDS = [
  "workflow-assistant",
  "kfid-control-review",
  "document-import",
  "workflow-writer",
  "daily-digest",
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
    name: "Workflow AI",
    purpose:
      "Besvara personliga Workflow-frågor och läsa tenantverifierad information med läsverktyg i flera steg, utan att ändra verksamhetsdata.",
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
      maxToolCalls: ASSISTANT_MAX_TOOL_CALLS,
      // Every turn of an answer with tools has its own output; the sum is what the run reserves.
      maxOutputTokens: 5_000,
      requiresPositiveCredits: true,
    },
    // The read tools of the shared tool layer (the same as the API and MCP), run in the person's own session.
    tools: ASSISTANT_READ_TOOLS.map((name) => ({
      name,
      description: TOOL_CATALOG[name].description,
      effect: "READ",
      strict: true,
      parameters: strictToolParameters(name),
    })),
  }),
  agentSchema.parse({
    id: "kfid-control-review",
    moduleId: "kfid",
    name: "Granskare",
    purpose:
      "Granska ett redan sparat protokoll eller en kontroll och peka på det som bör kontrolleras, utan att ändra något och utan att fatta säkerhetsbeslut.",
    lifecycle: "ENABLED",
    dataPolicy: {
      allowed: [
        "det aktuella protokollets eller kontrollens tekniska värden",
        "reglernas eget valideringsresultat",
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
    // The server reads the protocol in the person's own session and sends the technical values; the reviewer has no
    // tools and cannot read or change anything itself (fas 3, 2026-10-02).
    tools: [],
  }),
  // The Import page (2026-10-01): the AI only classifies an uploaded file and maps its columns or lines to
  // Workflow's fields; the person confirms, and the ordinary tools create the data.
  agentSchema.parse({
    id: "document-import",
    moduleId: null,
    name: "Importanalys",
    purpose:
      "Avgöra vad en uppladdad fil innehåller och hur dess kolumner eller rader ska bli kunder, projekt, arbetsordrar, planering eller kontrollpunkter – utan att ändra något.",
    lifecycle: "ENABLED",
    dataPolicy: {
      allowed: [
        "den uppladdade filens rubriker, ett urval rader eller ett textutdrag",
        "regelmotorns egen bedömning av filen",
      ],
      prohibited: [
        "andra organisationers data",
        "autentiseringsuppgifter eller hemligheter",
        "direkt mutation av verksamhetsdata",
        "filer som företaget inte tillåtit att dela",
      ],
    },
    limits: {
      maxToolCalls: 1,
      maxOutputTokens: 4_000,
      requiresPositiveCredits: true,
    },
    tools: [],
  }),
  // Skribenten (fas 2): writes a text or a proposal from material the server prepared. It has no tools at all: it
  // cannot read anything on its own and cannot change anything. What it writes is checked against a schema and, for a
  // proposal, against the input schema of the ordinary tool that carries it out once the person has confirmed.
  agentSchema.parse({
    id: "workflow-writer",
    moduleId: null,
    name: "Skribent",
    purpose:
      "Skriva sammanfattningar, utkast och förslag utifrån ett underlag som servern har tagit fram – utan att läsa eller ändra något själv.",
    lifecycle: "ENABLED",
    dataPolicy: {
      allowed: [
        "det underlag servern skickar för just den uppgiften eller det projektet, med namn som alias",
      ],
      prohibited: [
        "andra organisationers data",
        "autentiseringsuppgifter eller hemligheter",
        "direkt mutation av verksamhetsdata",
        "säkerhetstekniska avgöranden",
      ],
    },
    limits: {
      maxToolCalls: 1,
      maxOutputTokens: 1_500,
      requiresPositiveCredits: true,
    },
    tools: [],
  }),
  // Dagsammanställningen (fas 4): the rules count the day's events; this agent only writes the short text.
  agentSchema.parse({
    id: "daily-digest",
    moduleId: null,
    name: "Dagsammanställning",
    purpose:
      "Skriva en kort, saklig sammanställning av dagens arbete utifrån siffror och rader som reglerna har räknat fram.",
    lifecycle: "ENABLED",
    dataPolicy: {
      allowed: [
        "dagens antal och korta rader per projekt och uppgiftstyp, med namn som alias",
      ],
      prohibited: [
        "andra organisationers data",
        "autentiseringsuppgifter eller hemligheter",
        "direkt mutation av verksamhetsdata",
        "personers namn eller prestationer",
      ],
    },
    limits: {
      maxToolCalls: 1,
      maxOutputTokens: 800,
      requiresPositiveCredits: true,
    },
    tools: [],
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
