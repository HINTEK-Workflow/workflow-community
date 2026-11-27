import { z } from "zod";

/**
 * Publicera uppdrag via API utan godkännande (2026-11-25), pure: the company's rule and the decision for one assignment.
 * OFF by default. When it is off, stopped, the key is not named, the key lacks posts:autopublish, the call is not an API or MCP key
 * (never an agent), the channel is not allowed or a cap is reached, the item waits for Godkänn in Schemalagt as always.
 */
export const AUTO_CHANNELS = ["linkedin", "facebook", "instagram"] as const;
export type AutoChannel = (typeof AUTO_CHANNELS)[number];
export const AUTOPUBLISH_SCOPE = "posts:autopublish";
export const CAP_MAX = { day: 5, week: 20 } as const;

export const capsSchema = z.partialRecord(z.enum(AUTO_CHANNELS), z.object({ day: z.number().int().min(0).max(CAP_MAX.day), week: z.number().int().min(0).max(CAP_MAX.week) }));
export type Caps = z.infer<typeof capsSchema>;

export type AutoPublishRule = { enabled: boolean; channels: string[]; keyIds: string[]; caps: Caps; stoppedAt: string | null; updatedAt: string | null };
export const OFF_RULE: AutoPublishRule = { enabled: false, channels: [], keyIds: [], caps: {}, stoppedAt: null, updatedAt: null };

export function ruleOf(row: { enabled: boolean; channels: string[]; keyIds: string[]; caps: unknown; stoppedAt: Date | null; updatedAt: Date } | null): AutoPublishRule {
  if (!row) return OFF_RULE;
  const caps = capsSchema.safeParse(row.caps);
  return {
    enabled: row.enabled, channels: row.channels.filter((channel) => (AUTO_CHANNELS as readonly string[]).includes(channel)), keyIds: row.keyIds,
    caps: caps.success ? caps.data : {}, stoppedAt: row.stoppedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(),
  };
}

export type AutoDecision = { auto: true } | { auto: false; reason: string };

/** Whether this assignment may be approved automatically. `counts` are the channel's automatic approvals today and this week. */
export function autoPublishDecision(input: {
  rule: AutoPublishRule; requested: boolean; principal: { kind: string; keyId: string; scopes: string[] } | null; platform: string; counts: { day: number; week: number };
}): AutoDecision {
  const { rule, principal } = input;
  if (!input.requested) return { auto: false, reason: "Väntar på godkännande i Schemalagt." };
  if (!rule.enabled) return { auto: false, reason: "Publicera uppdrag via API utan godkännande är avstängt. Väntar på godkännande." };
  if (rule.stoppedAt) return { auto: false, reason: "Automatiskt godkännande är stoppat. Väntar på godkännande." };
  if (!principal || (principal.kind !== "API" && principal.kind !== "MCP")) return { auto: false, reason: "Bara en API-nyckel kan få automatiskt godkännande. Väntar på godkännande." };
  if (!principal.scopes.includes(AUTOPUBLISH_SCOPE)) return { auto: false, reason: "Nyckeln saknar behörigheten att publicera utan godkännande. Väntar på godkännande." };
  if (!rule.keyIds.includes(principal.keyId)) return { auto: false, reason: "Nyckeln är inte vald för automatiskt godkännande. Väntar på godkännande." };
  if (!rule.channels.includes(input.platform)) return { auto: false, reason: "Kanalen är inte vald för automatiskt godkännande. Väntar på godkännande." };
  const cap = rule.caps[input.platform as AutoChannel] ?? { day: 0, week: 0 };
  if (input.counts.day >= cap.day) return { auto: false, reason: `Dagens tak för automatiskt godkännande (${cap.day}) är nått. Väntar på godkännande.` };
  if (input.counts.week >= cap.week) return { auto: false, reason: `Veckans tak för automatiskt godkännande (${cap.week}) är nått. Väntar på godkännande.` };
  return { auto: true };
}

/** The input of Spara for the rule (the posts route). */
export const autoPublishInputSchema = z.object({
  enabled: z.boolean(),
  channels: z.array(z.enum(AUTO_CHANNELS)).max(3),
  keyIds: z.array(z.string().min(1).max(100)).max(25),
  caps: capsSchema,
});
export type AutoPublishInput = z.infer<typeof autoPublishInputSchema>;

/** The recommended time as a Date for Schemalagt, or why it cannot be used (past, too far ahead, unreadable). */
export function assignmentTime(value: string | undefined, now = Date.now()): { at: Date } | { reason: string } {
  if (!value) return { reason: "Uppdraget saknar tid, så det schemalades inte. Schemalägg det själv." };
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return { reason: "Uppdragets tid gick inte att läsa, så det schemalades inte." };
  if (at.getTime() < now + 10 * 60_000) return { reason: "Uppdragets tid har passerat eller ligger för nära, så det schemalades inte." };
  if (at.getTime() > now + 60 * 86_400_000) return { reason: "Uppdragets tid ligger mer än 60 dagar fram, så det schemalades inte." };
  return { at };
}
