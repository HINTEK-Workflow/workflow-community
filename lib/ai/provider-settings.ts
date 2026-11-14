import { z } from "zod";
import { storedAzureSchema } from "@/lib/ai/azure-settings";
import { storedOpenAiModelsSchema } from "@/lib/ai/openai-models";

// Workflow's own AI provider, set in the app (2026-10-03: "jag vill kunna sköta detta från Workflow"). Pure rules
// without Prisma: what is stored, and how it combines with the server's .env. Saved in the app wins over .env, like
// the e-mail settings; nothing saved means the .env values.

export const storedProviderSchema = z.object({
  apiKeyCipher: z.string().max(4000).optional(),
  keyHint: z.string().max(20).optional(),
  /** The bin was used: no key at all, not even one the server has from its environment (2026-10-07). */
  keyCleared: z.boolean().optional(),
  enabled: z.boolean().default(false),
  dpaApproved: z.boolean().default(false),
  evalApproved: z.boolean().default(false),
  /** Older saves may say EU: read so the row still parses, and ignored (2026-11-01: bara Azure räknas som EU). */
  region: z.enum(["GLOBAL", "EU"]).default("GLOBAL"),
  euControlsApproved: z.boolean().default(false),
  /** Azure OpenAI (EU), the second provider; kept in the same row, read and saved by lib/ai/azure-settings-server.ts. */
  azure: storedAzureSchema.optional(),
  /** OpenAI's price fields (2026-10-24), read and saved by lib/ai/provider-settings-server.ts; empty = the starting cards. */
  models: storedOpenAiModelsSchema.optional(),
  updatedAt: z.string().max(40).optional(),
  updatedBy: z.string().max(200).optional(),
}).catch({ enabled: false, dpaApproved: false, evalApproved: false, region: "GLOBAL", euControlsApproved: false });
export type StoredProvider = z.infer<typeof storedProviderSchema>;

export const providerInputSchema = z.object({
  enabled: z.boolean(),
  dpaApproved: z.boolean(),
  evalApproved: z.boolean(),
  /** Sent by a page opened before 2026-11-01; accepted and never used. */
  region: z.enum(["GLOBAL", "EU"]).optional(),
  euControlsApproved: z.boolean().optional(),
  /** A new key; empty keeps the saved one. */
  apiKey: z.string().trim().max(400).optional(),
}).strict();

export type EnvProvider = {
  OPENAI_PROVIDER_ENABLED: boolean; OPENAI_DPA_APPROVED: boolean; OPENAI_PROVIDER_EVAL_APPROVED: boolean; OPENAI_API_KEY?: string;
};

export type OpenAiSettings = {
  requested: boolean; dpaApproved: boolean; evalApproved: boolean;
  apiKey: string; source: "app" | "server"; keySource: "app" | "server" | "none";
};

/** The settings that apply now: what was saved in the app, otherwise the server's .env. */
export function effectiveOpenAiSettings(stored: StoredProvider, env: EnvProvider, storedKey: string): OpenAiSettings {
  const saved = Boolean(stored.updatedAt);
  // The server's own key is the server's: the bin in the app removes only a key saved in the app (2026-10-07).
  // `keyCleared` from v0.4.20 is ignored, so a key the server has is used again.
  const serverKey = env.OPENAI_API_KEY || "";
  const apiKey = storedKey || serverKey;
  const keySource = storedKey ? "app" : serverKey ? "server" : "none";
  return saved
    ? { requested: stored.enabled, dpaApproved: stored.dpaApproved, evalApproved: stored.evalApproved, apiKey, source: "app", keySource }
    : { requested: env.OPENAI_PROVIDER_ENABLED, dpaApproved: env.OPENAI_DPA_APPROVED, evalApproved: env.OPENAI_PROVIDER_EVAL_APPROVED, apiKey, source: "server", keySource };
}

/** Whether Workflow AI may call the provider, and the first thing that stops it. */
export function providerProblem(settings: OpenAiSettings): string | null {
  if (!settings.requested) return "AI är inte påslaget.";
  if (!settings.dpaApproved) return "OpenAI:s avtal (DPA) och rättslig grund är inte bekräftade.";
  if (!settings.evalApproved) return "Provsviten är inte godkänd.";
  if (!settings.apiKey) return "OpenAI-nyckel saknas.";
  return null;
}

export const validOpenAiKey = (value: string) => /^sk-[A-Za-z0-9_-]{20,}$/.test(value.trim());
export const keyHintOf = (value: string) => `sk-…${value.trim().slice(-4)}`;
