import { z } from "zod";
import { prisma } from "@/lib/db";

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
  allowedModules: z.array(z.enum(["KFID"])).max(1).default([]),
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
  allowedModules: [],
};

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
