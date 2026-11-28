import "server-only";
import { randomBytes } from "node:crypto";
import OpenAI from "openai";
import { prisma } from "@/lib/db";
import {
  COMPANY_KEY_NAME, COMPANY_KEY_PAUSE, COMPANY_KEY_PROVIDER_LABEL, companyKeyChoiceOf, companyKeyFailure, companyKeyProblem, parseCompanyKey,
  validCompanyKeyValue, companyKeyValueHint, validCompanyModel, COMPANY_KEY_MODEL_LABEL,
  type CompanyKeyChoice, type CompanyKeyInput, type CompanyKeyProvider, type CompanyKeySettings,
} from "@/lib/ai/company-key";
import { normalizeAzureEndpoint, validAzureEndpoint, AZURE_ENDPOINT_HINT } from "@/lib/ai/azure-settings";
import { OPENAI_GLOBAL_BASE_URL } from "@/lib/ai/openai-provider";
import { makeResponsesProvider } from "@/lib/ai/openai-structured";
import { makeWorkflowAssistantProvider } from "@/lib/ai/openai-workflow-assistant";
import { getAiSharingPolicy, type AiSharingPolicy } from "@/lib/ai/sharing-policy";
import type { StructuredProviderAdapter } from "@/lib/ai/structured-provider";
import type { AssistantProviderAdapter } from "@/lib/ai/workflow-assistant";
import { externalHint } from "@/lib/integrations/keys";
import { openCompanyKey, sealCompanyKey } from "@/lib/integrations/company-keys";

/**
 * Företagets egen AI-nyckel on the server (2026-11-27; the rules: lib/ai/company-key.ts). The key is read and opened only
 * here, on the server, in the company's own run, with the company's own data key – never in the client and never for another
 * company. When the provider refuses the key or the model, the company's AI is paused with the reason until the admin acts; nothing
 * ever falls back to Workflow's key.
 */

/** The company's newest active key of the provider, if any (sealed; opened only when a call is made). */
export async function companyKeyRow(organizationId: string, provider: CompanyKeyProvider) {
  return prisma.integrationKey.findFirst({
    where: { organizationId, kind: "EXTERNAL", provider, revokedAt: null, encryptedValue: { not: null } },
    orderBy: { createdAt: "desc" }, select: { id: true, encryptedValue: true, displayHint: true, createdAt: true, updatedAt: true },
  });
}

/**
 * The company's choice when its own key is on, or null when it is off (Workflow AI, the default). On means the company's provider or
 * a paused AI with a reason – never Workflow's provider.
 */
export async function companyKeyChoice(organizationId: string, policy?: AiSharingPolicy): Promise<CompanyKeyChoice | null> {
  const current = policy ?? await getAiSharingPolicy(organizationId);
  const settings = parseCompanyKey(current.ownKey);
  if (!settings.on) return null;
  const row = await companyKeyRow(organizationId, settings.provider);
  return companyKeyChoiceOf({ settings, keyStored: Boolean(row), requireEu: current.requireEu });
}

/** Whether the company has switched its own key on (whatever state the key is in). */
export async function companyKeyOn(organizationId: string) {
  return parseCompanyKey((await getAiSharingPolicy(organizationId)).ownKey).on;
}

async function writeSettings(organizationId: string, change: (current: CompanyKeySettings) => CompanyKeySettings) {
  const current = await getAiSharingPolicy(organizationId);
  const aiPolicy = { ...current, ownKey: change(parseCompanyKey(current.ownKey)) };
  await prisma.workspaceSettings.upsert({ where: { organizationId }, create: { organizationId, aiPolicy }, update: { aiPolicy } });
  return aiPolicy.ownKey;
}

/**
 * The provider refused the key or the model: AI is paused for the company with the reason (logged once per new reason). The switch
 * stays on, so with billing the company keeps the price with its own AI key (ee/billing/own-key-price.ts) until the admin turns it off.
 */
export async function pauseCompanyKey(organizationId: string, reason: string) {
  const before = parseCompanyKey((await getAiSharingPolicy(organizationId)).ownKey);
  if (!before.on || before.pausedReason === reason) return;
  await writeSettings(organizationId, (current) => ({ ...current, pausedReason: reason.slice(0, 300), pausedAt: new Date().toISOString() }));
  await prisma.administrationEvent.create({ data: { actorId: "system:company-ai-key", organizationId, action: "company_ai_key_paused", detail: `Företagets egen AI-nyckel pausades: ${reason}`.slice(0, 500) } }).catch(() => undefined);
}

/** A client for the company's own provider. Replaced in the tests by a fake; never a network call there. */
export type CompanyKeyClientFactory = (input: { provider: CompanyKeyProvider; endpoint: string; apiKey: string }) => OpenAI;
const realClient: CompanyKeyClientFactory = ({ provider, endpoint, apiKey }) => new OpenAI({
  apiKey, baseURL: provider === "azure-openai" ? `${endpoint}/openai/v1/` : OPENAI_GLOBAL_BASE_URL, timeout: 45_000, maxRetries: 0,
});

async function openedKey(organizationId: string, provider: CompanyKeyProvider) {
  const row = await companyKeyRow(organizationId, provider);
  if (!row?.encryptedValue) throw new Error(`${COMPANY_KEY_PAUSE} saknas.`);
  return openCompanyKey(organizationId, row.id, row.encryptedValue);
}

/**
 * The structured and the assistant adapter on the company's own key: the same Responses adapter as Workflow AI, on the company's
 * address with its key and its one model for every task. A refusal of the key or the model pauses the company's AI; the error the
 * caller sees then starts with COMPANY_KEY_PAUSE, so the person reads why.
 */
export function companyKeyAdapters(organizationId: string, choice: Extract<CompanyKeyChoice, { use: "company" }>, makeClient: CompanyKeyClientFactory = realClient): { assistant: AssistantProviderAdapter; structured: StructuredProviderAdapter } {
  const inner = makeResponsesProvider({
    id: choice.provider === "azure-openai" ? "COMPANY_AZURE_OPENAI_RESPONSES" : "COMPANY_OPENAI_RESPONSES",
    getClient: async () => makeClient({ provider: choice.provider, endpoint: choice.endpoint, apiKey: await openedKey(organizationId, choice.provider) }),
    modelFor: () => choice.model,
    // Azure takes only what both providers know; at OpenAI the request is OpenAI's own (safety identifier, prompt cache).
    plain: choice.provider === "azure-openai",
  });
  const watched = async <T>(call: () => Promise<T>) => {
    try { return await call(); } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") throw error;
      const failure = companyKeyFailure(choice.provider, error, choice.model);
      if (failure.pause) await pauseCompanyKey(organizationId, failure.message).catch(() => undefined);
      throw Object.assign(new Error(`${COMPANY_KEY_PAUSE}: ${failure.message}`), { status: (error as { status?: number } | null)?.status, companyKey: true });
    }
  };
  const structured: StructuredProviderAdapter = {
    id: inner.id,
    generateStructured: (request) => watched(() => inner.generateStructured(request)),
    generateWithTools: (request) => watched(() => inner.generateWithTools(request)),
  };
  return { structured, assistant: makeWorkflowAssistantProvider(structured) };
}

/** The reason a failed call on the company's own key gives the person, or null for any other error. */
export const companyKeyErrorReason = (error: unknown) =>
  error instanceof Error && (error as { companyKey?: boolean }).companyKey ? error.message : null;

// ---------- the settings page ----------

export type CompanyKeyView = {
  on: boolean; provider: CompanyKeyProvider; endpoint: string; model: string;
  euAttested: boolean; euAttestedAt: string | null; euAttestedBy: string | null;
  key: { hint: string; savedAt: string } | null;
  /** Why AI is paused right now with the key on, or null. */
  problem: string | null;
  pausedReason: string | null; updatedAt: string | null; updatedBy: string | null;
  requireEu: boolean;
};

export async function companyKeyView(organizationId: string): Promise<CompanyKeyView> {
  const policy = await getAiSharingPolicy(organizationId);
  const settings = parseCompanyKey(policy.ownKey);
  const row = await companyKeyRow(organizationId, settings.provider);
  return {
    on: settings.on, provider: settings.provider, endpoint: settings.endpoint, model: settings.model,
    euAttested: settings.euAttested, euAttestedAt: settings.euAttestedAt ?? null, euAttestedBy: settings.euAttestedBy ?? null,
    key: row ? { hint: row.displayHint, savedAt: row.updatedAt.toISOString() } : null,
    problem: settings.on ? companyKeyProblem({ settings, keyStored: Boolean(row), requireEu: policy.requireEu }) : null,
    pausedReason: settings.pausedReason ?? null, updatedAt: settings.updatedAt ?? null, updatedBy: settings.updatedBy ?? null,
    requireEu: policy.requireEu,
  };
}

export class CompanyKeyError extends Error {}

/**
 * Saves the admin's choices (the caller has checked the session, the company, the admin role and Origin, and a fresh sign-in when a
 * key is pasted): the switch, the provider, the address, the model, the EU statement and the key – sealed with the company's own
 * data key, replacing the provider's earlier key. Every change is in the company's history, never a key's value.
 */
export async function saveCompanyKey(organizationId: string, actor: { userId: string; label: string }, input: Extract<CompanyKeyInput, { action: "save" }>) {
  const endpoint = input.provider === "azure-openai" ? normalizeAzureEndpoint(input.endpoint) : "";
  if (input.provider === "azure-openai" && endpoint && !validAzureEndpoint(endpoint)) throw new CompanyKeyError(AZURE_ENDPOINT_HINT);
  if (input.model && !validCompanyModel(input.provider, input.model)) throw new CompanyKeyError(`${COMPANY_KEY_MODEL_LABEL[input.provider]} ser fel ut (bokstäver, siffror, punkt, understreck och bindestreck).`);
  const apiKey = input.apiKey?.trim() ?? "";
  if (apiKey && !validCompanyKeyValue(input.provider, apiKey)) throw new CompanyKeyError(`Nyckeln ser fel ut. ${companyKeyValueHint(input.provider)}`);
  const policy = await getAiSharingPolicy(organizationId);
  const before = parseCompanyKey(policy.ownKey);
  // EU-kravet (2026-11-27, 6b punkt 3): with Uppgifterna måste behandlas inom EU on, the switch goes on only for the company's
  // own Azure resource with the admin's statement; an OpenAI key is refused with the reason. (Turned on later, the run pauses instead.)
  if (input.on && policy.requireEu && input.provider === "openai")
    throw new CompanyKeyError("Företaget kräver behandling inom EU, så en OpenAI-nyckel är spärrad. Välj företagets egen Azure-resurs i EU, eller stäng av egen AI-nyckel.");
  if (input.on && policy.requireEu && !input.euAttested)
    throw new CompanyKeyError("Företaget kräver behandling inom EU. Bocka i att företagets Azure-resurs ligger i EU innan du sparar.");
  const now = new Date().toISOString();
  const lines: string[] = [];
  await prisma.$transaction(async (tx) => {
    if (apiKey || input.removeKey) {
      const old = await tx.integrationKey.findMany({ where: { organizationId, kind: "EXTERNAL", provider: input.provider, revokedAt: null }, select: { id: true } });
      if (old.length) await tx.integrationKey.updateMany({ where: { id: { in: old.map((row) => row.id) } }, data: { revokedAt: new Date(), revokedById: actor.userId, encryptedValue: null } });
      if (old.length && !apiKey) lines.push(`tog bort nyckeln för ${COMPANY_KEY_PROVIDER_LABEL[input.provider]}`);
    }
    if (apiKey) {
      const id = randomBytes(12).toString("hex");
      await tx.integrationKey.create({ data: { id, organizationId, kind: "EXTERNAL", name: COMPANY_KEY_NAME, provider: input.provider, displayHint: externalHint(apiKey), encryptedValue: await sealCompanyKey(organizationId, id, apiKey, tx), createdById: actor.userId } });
      lines.push(`lade in en ny nyckel för ${COMPANY_KEY_PROVIDER_LABEL[input.provider]}`);
    }
  });
  if (input.on !== before.on) lines.unshift(input.on ? "slog på Använd företagets egen AI-nyckel" : "stängde av Använd företagets egen AI-nyckel (Workflow AI används igen)");
  if (input.provider !== before.provider) lines.push(`valde ${COMPANY_KEY_PROVIDER_LABEL[input.provider]}`);
  if (endpoint !== before.endpoint && input.provider === "azure-openai") lines.push("ändrade adressen till Azure-resursen");
  if (input.model !== before.model) lines.push(`${COMPANY_KEY_MODEL_LABEL[input.provider].toLowerCase()} ${input.model || "(tom)"}`);
  const attested = input.provider === "azure-openai" && input.euAttested;
  if (attested !== before.euAttested) lines.push(attested ? "intygade att företagets Azure-resurs ligger i EU" : "tog bort intyget om att Azure-resursen ligger i EU");
  // A new key, model or address is a new try: a pause from the old one goes.
  const fresh = Boolean(apiKey) || input.model !== before.model || endpoint !== before.endpoint || input.provider !== before.provider;
  await writeSettings(organizationId, (current) => ({
    ...current, on: input.on, provider: input.provider, endpoint, model: input.model,
    euAttested: attested, euAttestedAt: attested ? (before.euAttested ? current.euAttestedAt : now) : undefined, euAttestedBy: attested ? (before.euAttested ? current.euAttestedBy : actor.label) : undefined,
    ...(fresh ? { pausedReason: undefined, pausedAt: undefined } : {}),
    updatedAt: now, updatedBy: actor.label,
  }));
  if (lines.length) await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId, action: "company_ai_key", detail: `Egen AI-nyckel: ${lines.join(", ")}.`.slice(0, 1000) } });
  return companyKeyView(organizationId);
}

/**
 * Kontrollera: a real, small call to the company's provider with synthetic text (no company data) – the same call shape as every
 * run. OK clears a pause; a refusal pauses. Recorded in the company's history, never the key or the provider's text.
 */
export async function checkCompanyKey(organizationId: string, actor: { userId: string }, makeClient: CompanyKeyClientFactory = realClient): Promise<{ ok: boolean; message: string }> {
  const policy = await getAiSharingPolicy(organizationId);
  const settings = parseCompanyKey(policy.ownKey);
  const row = await companyKeyRow(organizationId, settings.provider);
  // The check tries the key itself, so an earlier pause does not stop it.
  const problem = companyKeyProblem({ settings: { ...settings, pausedReason: undefined }, keyStored: Boolean(row), requireEu: false });
  let result: { ok: boolean; message: string };
  if (problem) result = { ok: false, message: problem };
  else {
    try {
      const apiKey = await openedKey(organizationId, settings.provider);
      const endpoint = normalizeAzureEndpoint(settings.endpoint);
      await makeClient({ provider: settings.provider, endpoint, apiKey }).responses.create({ model: settings.model.trim(), reasoning: { effort: "low" }, input: "Svara bara: OK", max_output_tokens: 16, store: false });
      result = { ok: true, message: `${COMPANY_KEY_PROVIDER_LABEL[settings.provider]} godtar nyckeln och ${COMPANY_KEY_MODEL_LABEL[settings.provider].toLowerCase()}en ${settings.model.trim()}.` };
      if (settings.pausedReason) await writeSettings(organizationId, (current) => ({ ...current, pausedReason: undefined, pausedAt: undefined }));
    } catch (error) {
      const failure = companyKeyFailure(settings.provider, error, settings.model);
      if (failure.pause) await pauseCompanyKey(organizationId, failure.message);
      result = { ok: false, message: failure.message };
    }
  }
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId, action: "company_ai_key_check", detail: `${result.ok ? "OK" : "Fel"}: Kontrollera egen AI-nyckel — ${result.message}`.slice(0, 1000) } });
  return result;
}
