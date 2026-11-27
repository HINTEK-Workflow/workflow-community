import { z } from "zod";
import { prisma } from "@/lib/db";
import { AI_PROFILE_IDS } from "@/lib/ai/azure-settings";

/**
 * Vad Workflow AI får göra (2026-10-09: "Vad AI får göra är en admin-inställning, men ju mer den kan desto
 * bättre"): one switch per capability, on from the start for new and existing companies (a policy saved before the
 * switches existed has none and gets them all on). The server checks each switch at every call; the person's own
 * permissions, the sharing choices and the credits still apply on top.
 */
export const AI_ABILITIES = ["chatProposals", "moreToolCalls", "teamOverview", "riskTogether"] as const;
export type AiAbility = (typeof AI_ABILITIES)[number];
export const allAiAbilities = (): Record<AiAbility, boolean> => ({ chatProposals: true, moreToolCalls: true, teamOverview: true, riskTogether: true });
const abilitiesSchema = z.object({
  /** Förslag från chatten: create/change work orders, material rows, time, planning and quotes – always as a proposal. */
  chatProposals: z.boolean().default(true),
  /** Up to 5 tool calls instead of 3 when the question is a work request. */
  moreToolCalls: z.boolean().default(true),
  /** Lagöversikt (list_team_work) in the chat, API v1 and MCP – only what the person may read in Workflow's lists. */
  teamOverview: z.boolean().default(true),
  /** Riskbedömning tillsammans: hazards and measures for the extended one; never answers the simplified one's questions. */
  riskTogether: z.boolean().default(true),
});

export const aiSharingPolicySchema = z.object({
  enabled: z.boolean().default(false),
  shareChatContent: z.boolean().default(false),
  shareCustomers: z.boolean().default(false),
  shareControls: z.boolean().default(false),
  shareDocuments: z.boolean().default(false),
  shareConversationHistory: z.boolean().default(false),
  // The person own tasks, work orders and projects in numbers and short rows, names as aliases (2026-10-01).
  shareWork: z.boolean().default(false),
  // Dagsammanställningen (2026-10-02): the one thing Workflow AI does while nobody uses the app – a short digest of the
  // day, written at night. Off until the company's admin chooses it.
  dailyDigest: z.boolean().default(false),
  // Maskinanalys (0.19.0): the company lets Workflow AI word an explanation of a machine suggestion (code, counts and the machine's own short text, source as alias). Off until chosen.
  shareMachines: z.boolean().default(false),
  // EU (2026-10-19): all AI for this company is processed in the EU only, or not at all.
  requireEu: z.boolean().default(false),
  // AI-profil (2026-10-24): the profile the company's admin chose among those Workflow released. In Cloud a company that switches
  // AI on without having chosen a profile gets EU (2026-11-21, F4); the admin may switch to Standard.
  profile: z.enum(AI_PROFILE_IDS).catch("standard").default("standard"),
  /** The admin has chosen a profile themselves (then F4's default never changes it). Set by the server. */
  profileChosen: z.boolean().default(false),
  // Tillåt egna AI-appar (MCP) (2026-11-21, F6): the company's own AI (ChatGPT, Claude, Copilot …) may connect over MCP. Off in
  // Cloud until the admin turns it on; Community keeps MCP on. Changed only under Inställningar → API och MCP (mcp-access.ts).
  mcpAllowed: z.boolean().optional(),
  // Fortsätt med krediter när veckans kvot är slut (2026-11-21): the admin's choice; off from the start.
  continueOnCredits: z.boolean().default(false),
  // The company's own weekly quota in kr (the superadmin's, under Kundföretag); none = the installation's. Kept by the admin's saves.
  weeklyQuotaKr: z.number().int().min(0).max(10_000).optional(),
  allowedModules: z.array(z.enum(["KFID"])).max(1).default([]),
  abilities: abilitiesSchema.default(allAiAbilities),
});

export type AiSharingPolicy = z.infer<typeof aiSharingPolicySchema>;

export const disabledAiSharingPolicy: AiSharingPolicy = {
  enabled: false,
  shareChatContent: false,
  shareCustomers: false,
  shareControls: false,
  shareDocuments: false,
  shareConversationHistory: false,
  shareWork: false,
  dailyDigest: false,
  shareMachines: false,
  requireEu: false,
  profile: "standard",
  profileChosen: false,
  continueOnCredits: false,
  allowedModules: [],
  abilities: allAiAbilities(),
};

/** Whether the company's admin lets Workflow AI do this (on unless switched off). */
export function aiMay(policy: { abilities?: Partial<Record<AiAbility, boolean>> } | null | undefined, ability: AiAbility) {
  return policy?.abilities?.[ability] !== false;
}

export function parseAiSharingPolicy(value: unknown): AiSharingPolicy {
  const parsed = aiSharingPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : disabledAiSharingPolicy;
}

export async function getAiSharingPolicy(organizationId: string) {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { organizationId },
    select: { aiPolicy: true },
  });
  return parseAiSharingPolicy(settings?.aiPolicy);
}

/**
 * Uppgifter och projekt (2026-10-01: "från början var Workflow bara kontroll före idrifttagning"): one choice
 * for every kind of task – work orders, risk assessments, controls and protocols – and projects. A policy saved before
 * that choice existed shares them when it shared the controls.
 */
export function sharesWork(policy: AiSharingPolicy) {
  return policy.shareWork || (policy.shareControls && policy.allowedModules.includes("KFID"));
}

/** Whether a search hit of this kind may be sent to the AI model as a source: each choice governs its own kind. */
export function sourceAllowed(policy: AiSharingPolicy, resourceType: string) {
  if (resourceType === "CUSTOMER") return policy.shareCustomers;
  if (resourceType === "DOCUMENT") return policy.shareDocuments;
  if (resourceType === "PROJECT" || resourceType === "TASK" || resourceType === "CONTROL" || resourceType === "NOTIFICATION") return sharesWork(policy);
  return resourceType === "VIEW";
}
