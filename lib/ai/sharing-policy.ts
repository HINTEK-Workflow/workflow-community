import { z } from "zod";
import { prisma } from "@/lib/db";

export const aiSharingPolicySchema = z.object({
  enabled: z.boolean().default(false),
  shareChatContent: z.boolean().default(false),
  shareCustomers: z.boolean().default(false),
  shareControls: z.boolean().default(false),
  shareDocuments: z.boolean().default(false),
  shareConversationHistory: z.boolean().default(false),
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
