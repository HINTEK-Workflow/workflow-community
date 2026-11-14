import "server-only";
import { prisma } from "@/lib/db";
import { centralFieldInfo, centralSecret, saveCentralSecret, type CentralActor } from "@/lib/secrets/central-store";
import { azureInputSchema, azureKeyHintOf, azureProblem, effectiveAzureSettings, storedAzureSchema, usedDeployments, validAzureEndpoint, validAzureKey, normalizeAzureEndpoint, validDeployment, AZURE_ENDPOINT_HINT, AZURE_ROUTE_MODELS, type AzurePreset, type AzureSettings, type StoredAzure } from "@/lib/ai/azure-settings";
import { INSTANCE_DEFAULTS } from "@/lib/instance-defaults";
import { storedProviderSchema } from "@/lib/ai/provider-settings";

// The key is a central key (lib/secrets/central-store.ts, 2026-10-25); aiProvider.azure keeps everything else.
/** The installation's own suggestion (Workflow: its Foundry deployment, 2026-10-24); shown as unsaved values, never used until saved. */
const preset: AzurePreset | null = INSTANCE_DEFAULTS.azurePreset;
let cached: { at: number; value: AzureSettings } | null = null;
const CACHE_MS = 15_000;

async function readRow() {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { aiProvider: true } });
  return storedProviderSchema.parse(row?.aiProvider ?? {});
}
const azureOf = (row: ReturnType<typeof storedProviderSchema.parse>) => storedAzureSchema.parse(row.azure ?? {});
const openKey = () => centralSecret("azure.apiKey");

export async function azureSettings(): Promise<AzureSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const stored = azureOf(await readRow());
  const value = effectiveAzureSettings(stored, await openKey());
  cached = { at: Date.now(), value };
  return value;
}

/** What the owner sees: never the key, only its last four characters. */
export async function azureSettingsView() {
  const [row, key, info] = await Promise.all([readRow(), openKey(), centralFieldInfo("azure.apiKey")]);
  const stored = azureOf(row);
  const settings = effectiveAzureSettings(stored, key);
  // Never saved: the installation's suggestion fills the form (address and deployment names); nothing applies until it is saved.
  const suggested = !stored.updatedAt && preset ? preset : null;
  return {
    enabled: settings.requested, endpoint: settings.endpoint || suggested?.endpoint || "",
    deployments: suggested ? Object.fromEntries(AZURE_ROUTE_MODELS.map((model) => [model, suggested.deployment])) as AzureSettings["deployments"] : settings.deployments,
    euConfirmed: settings.euConfirmed, dpaApproved: settings.dpaApproved, models: settings.models, preset,
    hasKey: Boolean(settings.apiKey), keyHint: info.storage ? stored.keyHint ?? "…" : null, keyUnreadable: info.unreadable,
    storage: info.storage,
    problem: azureProblem(settings), updatedAt: stored.updatedAt ?? null, updatedBy: stored.updatedBy ?? null,
  };
}

export async function saveAzureSettings(raw: unknown, actor: CentralActor) {
  const input = azureInputSchema.parse(raw);
  const row = await readRow();
  const current = azureOf(row);
  const endpoint = normalizeAzureEndpoint(input.endpoint);
  if (endpoint && !validAzureEndpoint(endpoint)) throw new Error(AZURE_ENDPOINT_HINT);
  if (input.apiKey && !validAzureKey(input.apiKey)) throw new Error("Azure-nyckeln ser fel ut.");
  for (const model of AZURE_ROUTE_MODELS) if (!validDeployment(input.deployments[model])) throw new Error("Ett driftsättningsnamn ser fel ut (bokstäver, siffror, punkt, understreck och bindestreck).");
  // One card per deployment the routes use; a card for a deployment no route uses any more is dropped.
  const used = usedDeployments(input);
  const models = input.models ? input.models.filter((model, index, all) => used.includes(model.deployment) && all.findIndex((other) => other.deployment === model.deployment) === index) : current.models;
  for (const model of models) if (model.euVerified && !model.euSource.trim()) throw new Error("Ange källan för att EU-behandlingen är verifierad för " + model.deployment + ".");
  // The key first (in the key vault too, where the installation has one): when that fails nothing of the save is kept.
  if (input.apiKey) await saveCentralSecret("azure.apiKey", input.apiKey.trim(), actor);
  const next: StoredAzure = {
    enabled: input.enabled, endpoint, deployments: input.deployments, euConfirmed: input.euConfirmed, dpaApproved: input.dpaApproved, models,
    apiKeyCipher: input.apiKey ? undefined : current.apiKeyCipher,
    keyHint: input.apiKey ? azureKeyHintOf(input.apiKey) : current.keyHint,
    updatedAt: new Date().toISOString(), updatedBy: actor.label,
  };
  const merged = { ...row, azure: next };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { aiProvider: merged }, create: { id: "global", aiProvider: merged } });
  cached = null;
  return { keyChanged: Boolean(input.apiKey) };
}

export async function clearAzureKey(actor: CentralActor) {
  await saveCentralSecret("azure.apiKey", null, actor);
  const row = await readRow();
  const current = azureOf(row);
  const merged = { ...row, azure: { ...current, apiKeyCipher: undefined, keyHint: undefined, updatedAt: new Date().toISOString(), updatedBy: actor.label } };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { aiProvider: merged }, create: { id: "global", aiProvider: merged } });
  cached = null;
}

/** Whether the EU provider may be used right now (all parts in place). */
export async function azureEuProblem() {
  return azureProblem(await azureSettings());
}
