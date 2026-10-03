import "server-only";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptExternalKey, encryptExternalKey } from "@/lib/integrations/keys";
import { effectiveOpenAiSettings, keyHintOf, providerInputSchema, storedProviderSchema, validOpenAiKey, type OpenAiSettings, type StoredProvider } from "@/lib/ai/provider-settings";

// The key is sealed with the same secret as the companies' stored keys and the SMTP password.
const secret = () => env.INTEGRATION_KEYS_SECRET ?? env.AUTH_SECRET;

// Read on every AI call; a short cache keeps that off the database, and a save clears it.
let cached: { at: number; value: OpenAiSettings } | null = null;
const CACHE_MS = 15_000;

async function readStored(): Promise<StoredProvider> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { aiProvider: true } });
  return storedProviderSchema.parse(row?.aiProvider ?? {});
}

function openKey(stored: StoredProvider) {
  if (!stored.apiKeyCipher) return "";
  try { return decryptExternalKey(stored.apiKeyCipher, secret()); } catch { return ""; }
}

export async function openAiSettings(): Promise<OpenAiSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const stored = await readStored();
  const value = effectiveOpenAiSettings(stored, env, openKey(stored));
  cached = { at: Date.now(), value };
  return value;
}

/** What the superadmin sees: never the key, only its last four characters and where it comes from. */
export async function providerSettingsView() {
  const stored = await readStored();
  const settings = effectiveOpenAiSettings(stored, env, openKey(stored));
  return {
    enabled: settings.requested, dpaApproved: settings.dpaApproved, evalApproved: settings.evalApproved,
    region: settings.region, euControlsApproved: settings.euControlsApproved,
    source: settings.source, keySource: settings.keySource,
    keyHint: settings.keySource === "app" ? stored.keyHint ?? "sk-…" : settings.keySource === "server" ? "i serverns .env" : null,
    keyUnreadable: Boolean(stored.apiKeyCipher) && !openKey(stored),
    updatedAt: stored.updatedAt ?? null, updatedBy: stored.updatedBy ?? null,
  };
}

export async function saveProviderSettings(raw: unknown, actor: string) {
  const input = providerInputSchema.parse(raw);
  const current = await readStored();
  if (input.apiKey && !validOpenAiKey(input.apiKey)) throw new Error("Nyckeln ser inte ut som en OpenAI-nyckel (den börjar med sk-).");
  const next: StoredProvider = {
    apiKeyCipher: input.apiKey ? encryptExternalKey(input.apiKey.trim(), secret()) : current.apiKeyCipher,
    keyHint: input.apiKey ? keyHintOf(input.apiKey) : current.keyHint,
    enabled: input.enabled, dpaApproved: input.dpaApproved, evalApproved: input.evalApproved,
    region: input.region, euControlsApproved: input.euControlsApproved,
    updatedAt: new Date().toISOString(), updatedBy: actor.slice(0, 200),
  };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { aiProvider: next }, create: { id: "global", aiProvider: next } });
  cached = null;
  return { keyChanged: Boolean(input.apiKey) };
}

export async function clearProviderKey(actor: string) {
  const current = await readStored();
  const next: StoredProvider = { ...current, apiKeyCipher: undefined, keyHint: undefined, updatedAt: new Date().toISOString(), updatedBy: actor.slice(0, 200) };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { aiProvider: next }, create: { id: "global", aiProvider: next } });
  cached = null;
}
