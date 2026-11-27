import "server-only";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { centralFieldInfo, centralSecret, saveCentralSecret, type CentralActor } from "@/lib/secrets/central-store";
import { effectiveOpenAiSettings, keyHintOf, providerInputSchema, storedProviderSchema, validOpenAiKey, type OpenAiSettings, type StoredProvider } from "@/lib/ai/provider-settings";
import { OPENAI_ROUTE_MODELS, openAiCardWithoutEu, openAiCards } from "@/lib/ai/openai-models";
import type { AzureModelInfo } from "@/lib/ai/azure-settings";

// The key is a central key (lib/secrets/central-store.ts, 2026-10-25): sealed with the key ring, in serverlagring kept in
// its key vault where it has one; aiProvider keeps the choices, the hint and – until moved – the key sealed before that day.

// Read on every AI call; a short cache keeps that off the database, and a save clears it.
let cached: { at: number; value: OpenAiSettings } | null = null;
const CACHE_MS = 15_000;

async function readStored(): Promise<StoredProvider> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { aiProvider: true } });
  return storedProviderSchema.parse(row?.aiProvider ?? {});
}

const openKey = () => centralSecret("openai.apiKey");

export async function openAiSettings(): Promise<OpenAiSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const stored = await readStored();
  const value = effectiveOpenAiSettings(stored, env, await openKey());
  cached = { at: Date.now(), value };
  return value;
}

/** What the superadmin sees: never the key, only its last four characters and where it comes from. */
export async function providerSettingsView() {
  const [stored, key, info] = await Promise.all([readStored(), openKey(), centralFieldInfo("openai.apiKey")]);
  const settings = effectiveOpenAiSettings(stored, env, key);
  return {
    enabled: settings.requested, dpaApproved: settings.dpaApproved, evalApproved: settings.evalApproved,
    source: settings.source, keySource: settings.keySource,
    // Only the saved key's last characters are told; where a key is kept is never shown (secrets-fields-simple).
    keyHint: settings.keySource === "app" ? stored.keyHint ?? "sk-…" : null,
    keyUnreadable: info.unreadable,
    storage: info.storage,
    updatedAt: stored.updatedAt ?? null, updatedBy: stored.updatedBy ?? null,
  };
}

export async function saveProviderSettings(raw: unknown, actor: CentralActor) {
  const input = providerInputSchema.parse(raw);
  const current = await readStored();
  if (input.apiKey && !validOpenAiKey(input.apiKey)) throw new Error("Nyckeln ser inte ut som en OpenAI-nyckel (den börjar med sk-).");
  // The key first (in the key vault too, where the installation has one): when that fails nothing of the save is kept.
  if (input.apiKey) await saveCentralSecret("openai.apiKey", input.apiKey.trim(), actor);
  const next: StoredProvider = {
    apiKeyCipher: input.apiKey ? undefined : current.apiKeyCipher,
    keyHint: input.apiKey ? keyHintOf(input.apiKey) : current.keyHint,
    keyCleared: undefined,
    azure: current.azure,
    models: current.models,
    alarms: current.alarms,
    enabled: input.enabled, dpaApproved: input.dpaApproved, evalApproved: input.evalApproved,
    region: "GLOBAL", euControlsApproved: false,
    updatedAt: new Date().toISOString(), updatedBy: actor.label,
  };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { aiProvider: next }, create: { id: "global", aiProvider: next } });
  cached = null;
  return { keyChanged: Boolean(input.apiKey) };
}

/**
 * Av/på för Workflow AI från nyckelkortet (2026-10-17): only the "AI is on" choice changes. Everything else that applies now
 * (the confirmations) is kept – also when it so far came from the server's settings file – and the key is untouched.
 */
export async function setProviderEnabled(on: boolean, actor: string) {
  const current = await readStored();
  const effective = effectiveOpenAiSettings(current, env, await openKey());
  const next: StoredProvider = {
    ...current, keyCleared: undefined, enabled: on,
    dpaApproved: effective.dpaApproved, evalApproved: effective.evalApproved, region: "GLOBAL", euControlsApproved: false,
    updatedAt: new Date().toISOString(), updatedBy: actor.slice(0, 200),
  };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { aiProvider: next }, create: { id: "global", aiProvider: next } });
  cached = null;
}

let cachedCards: { at: number; value: AzureModelInfo[] } | null = null;

/** OpenAI's price cards that apply now: the saved ones, otherwise the starting values from the code. */
export async function openAiModelCards(): Promise<AzureModelInfo[]> {
  if (cachedCards && Date.now() - cachedCards.at < CACHE_MS) return cachedCards.value;
  const value = openAiCards((await readStored()).models);
  cachedCards = { at: Date.now(), value };
  return value;
}

/** Saves OpenAI's price cards (one per route model; anything else is dropped). The prices are the product owner's, with source and date. */
export async function saveOpenAiModelCards(cards: AzureModelInfo[]) {
  const current = await readStored();
  // Never an EU mark on OpenAI, also when a page or a call sends one (2026-11-01).
  const models = OPENAI_ROUTE_MODELS.flatMap((model) => cards.filter((card) => card.deployment === model).slice(0, 1)).map(openAiCardWithoutEu);
  const next: StoredProvider = { ...current, models, updatedAt: current.updatedAt, updatedBy: current.updatedBy };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { aiProvider: next }, create: { id: "global", aiProvider: next } });
  cachedCards = null;
  return openAiCards(models);
}

export async function clearProviderKey(actor: CentralActor) {
  // The bin removes the key saved in the app – at once, also in the key vault – while a key the server has from its
  // environment stays the server's (2026-10-07).
  await saveCentralSecret("openai.apiKey", null, actor);
  const current = await readStored();
  const next: StoredProvider = { ...current, apiKeyCipher: undefined, keyHint: undefined, keyCleared: undefined, updatedAt: new Date().toISOString(), updatedBy: actor.label };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { aiProvider: next }, create: { id: "global", aiProvider: next } });
  cached = null;
}
