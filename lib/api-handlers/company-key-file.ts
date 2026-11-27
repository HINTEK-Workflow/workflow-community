import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isHintekOrganization } from "@/lib/branding";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { ApiError, ReauthRequired } from "@/lib/kfid/errors";
import { requireCloudWriteAccess, type Context } from "@/lib/kfid/server";
import { describeIssue, type IssueLike } from "@/lib/tools/issue-text";
import { recordSecurityEvent } from "@/lib/security/security-log";
import { hitRateLimit, type RateRule } from "@/lib/security/rate-limit";
import { swedishDayKey } from "@/lib/swedish-time";
import { companyKeySource, companyIdentity } from "@/lib/secrets/company-key-source";
import { companyEntriesFromItems, companyKeyFile, companyKeyFileName, companyMatch, parseKeyFile, previewStates, ROTATE_ADVICE, type CompanyKeyEntry, type ParsedKeyFile } from "@/lib/secrets/company-key-file";
import { importCompanyKeys } from "@/lib/secrets/company-key-import";
import { newExportPassphrase, openPasswordFile, PASSWORD_FILE_MAX_BYTES, PasswordFileError, passwordFileText, sealPasswordFile } from "@/lib/secrets/password-file-crypto";
import type { KeyFileExportAnswer, KeyImportPreview, KeyImportResult } from "@/lib/secrets/key-import-view";

/**
 * Exportera och läs in företagets nycklar (2026-11-26: "kunden kan bara så klart exportera sina nycklar"; the way back so a
 * company is quickly up again after a break-in). In the open core: the company's data is the company's own, in Cloud and in
 * Community alike.
 *
 * Who: the company's own administrator (OWNER or ADMIN – the same people who add and replace the keys under Kopplingar), signed
 * in, in the active company. Never an ordinary employee, never through an API or MCP key, and never a superadmin acting in a
 * customer's company (a superadmin never sees a customer's keys; there is no audited consent for keys). The route
 * (lib/api-handlers/integration-keys.ts) has already checked Origin, the session, the membership, the role and Cloud storage;
 * context() the test-account rule and a paused company. Then here: a confirmation with password, code or passkey within the
 * last two minutes, every time, and a ceiling of tries an hour.
 *
 * Only the active company's own keys are read, and a file is only ever read into the active company: the file names its
 * company (id and organisation number) and a file of another company is refused unless the admin confirms it in so many words.
 * The file is always encrypted with a new passphrase that is shown once; it travels only in the body of the one POST answer,
 * no-store, never in a header, an address or a cookie, and it is never stored, logged or audited. The read-in is stateless: the
 * file and the passphrase come again with the read-in itself, so no decrypted key is ever kept between two requests. The
 * history and the security log hold who, when and how many – never a value.
 */
export const COMPANY_KEYS_REAUTH_SECONDS = 2 * 60;
export const COMPANY_KEYS_REAUTH_TEXT = "Filen innehåller företagets nycklar. Bekräfta med lösenord, kod eller passkey varje gång.";
const RATE: RateRule = { name: "company-key-file", limit: 30, windowSeconds: 60 * 60 };
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" };
const GROUP = "Företagets kopplingar";

const fileInput = { file: z.string().min(2).max(PASSWORD_FILE_MAX_BYTES), passphrase: z.string().min(1, "Skriv in lösenfrasen.").max(200) };
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("export_company_keys") }).strict(),
  z.object({ action: z.literal("preview_company_keys_import"), ...fileInput }).strict(),
  z.object({ action: z.literal("import_company_keys"), ...fileInput, entries: z.array(z.string().max(200)).min(1, "Välj minst en nyckel.").max(300), confirmOtherCompany: z.boolean().optional() }).strict(),
]);
const ACTIONS = new Set<string>(commandSchema.options.map((option) => option.shape.action.value));

type Ctx = Pick<Context, "user" | "organization" | "organizationId" | "integration" | "admin" | "auth">;

/** Why this person may not handle the company's key file here, or null. */
export function companyKeyFileRefusal(ctx: Pick<Ctx, "user" | "organization" | "integration" | "admin">): string | null {
  if (ctx.integration) return "Företagets nycklar kan inte exporteras eller läsas in med en API- eller MCP-nyckel.";
  if (!ctx.admin) return "Bara företagets administratör kan exportera eller läsa in företagets nycklar.";
  if (ctx.user.role === "SUPERADMIN" && !isHintekOrganization(ctx.organization)) return "En systemadministratör hanterar aldrig ett kundföretags nycklar. Företagets egen administratör gör det.";
  return null;
}

async function requireAllowed(ctx: Ctx) {
  const refusal = companyKeyFileRefusal(ctx);
  if (refusal) throw new ApiError(403, refusal);
  try {
    await requireFreshAuth(ctx.user.id, ctx.auth, COMPANY_KEYS_REAUTH_SECONDS);
  } catch (error) {
    if (error instanceof ReauthRequired && ctx.auth) throw new ReauthRequired(COMPANY_KEYS_REAUTH_TEXT);
    throw error;
  }
  const hit = await hitRateLimit(RATE, `${ctx.organizationId}:${ctx.user.id}`);
  if (!hit.allowed) throw new ApiError(429, "Många försök den senaste timmen. Vänta en stund.");
}

/** Opens a key file read in here: the encryption first, then the content's schema. Never says more than it must. */
export async function openKeyFile(text: string, passphrase: string): Promise<ParsedKeyFile> {
  let plain: string;
  try {
    plain = await openPasswordFile(text, passphrase);
  } catch (error) {
    if (error instanceof PasswordFileError) throw new ApiError(400, error.message);
    throw error;
  }
  const parsed = parseKeyFile(plain);
  if (!parsed?.workflow) throw new ApiError(400, "Filen är inte en nyckelexport från Workflow.");
  return parsed;
}

async function exportKeys(ctx: Ctx, headers: Headers) {
  const source = await companyKeySource(ctx.organizationId);
  const result = companyKeyFile(source.entries, { organizationId: source.company.id, organizationNumber: source.company.organizationNumber, company: source.company.name });
  if (!result.entries) throw new ApiError(409, source.unreadable ? "Företagets nycklar går inte att öppna. Lägg in dem igen under Kopplingar." : "Företaget har inga nycklar att exportera.");
  const passphrase = newExportPassphrase();
  const sealed = await sealPasswordFile(result.file, passphrase);
  await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "company_keys_export",
    detail: `Exporterade ${result.keys} nycklar (${result.entries} poster) till en lösenordsskyddad fil.${source.unreadable ? ` ${source.unreadable} gick inte att öppna och kom inte med.` : ""}` } });
  await recordSecurityEvent({ type: "company_keys_exported", actorId: ctx.user.id, userId: ctx.user.id, organizationId: ctx.organizationId, platform: false, detail: `${result.keys} nycklar`, headers });
  const answer: KeyFileExportAnswer = { ok: true, file: { name: companyKeyFileName(swedishDayKey(new Date())), text: passwordFileText(sealed) }, passphrase, entries: result.entries, keys: result.keys, unreadable: source.unreadable };
  return NextResponse.json(answer, { headers: NO_STORE });
}

/** The file's company against the active one; with the file's company part. */
async function fileCompany(ctx: Ctx, file: ParsedKeyFile) {
  const own = await companyIdentity(ctx.organizationId);
  const binding = file.workflow;
  return { own, view: binding ? { name: binding.company, organizationNumber: binding.organizationNumber, match: companyMatch(binding, own) } : null };
}

/** A file's company entries compared with the company's own now: names and states only. */
export async function companyPreview(organizationId: string, entries: CompanyKeyEntry[]) {
  const current = await companyKeySource(organizationId);
  return previewStates(entries, current.entries).map((entry) => ({ id: entry.id, label: entry.label, group: GROUP, state: entry.state }));
}

async function preview(ctx: Ctx, text: string, passphrase: string) {
  const file = await openKeyFile(text, passphrase);
  const { entries, skipped } = companyEntriesFromItems(file.items);
  if (!entries.length) throw new ApiError(400, "Filen innehåller inga av företagets nycklar.");
  const { view } = await fileCompany(ctx, file);
  const answer: KeyImportPreview = { ok: true, company: view, entries: await companyPreview(ctx.organizationId, entries), skipped };
  return NextResponse.json(answer, { headers: NO_STORE });
}

async function runImport(ctx: Ctx & Pick<Context, "organization">, text: string, passphrase: string, chosen: string[], confirmOtherCompany: boolean, headers: Headers) {
  await requireCloudWriteAccess(ctx as Context);
  const file = await openKeyFile(text, passphrase);
  const { entries, skipped } = companyEntriesFromItems(file.items);
  const { view } = await fileCompany(ctx, file);
  if (view?.match === "other" && !confirmOtherCompany)
    throw new ApiError(409, `Filen hör till ${view.name || "ett annat företag"}${view.organizationNumber ? ` (${view.organizationNumber})` : ""}, inte till det här företaget. Bekräfta att nycklarna ska läsas in här.`);
  const outcome = await importCompanyKeys({ userId: ctx.user.id, organizationId: ctx.organizationId }, entries, new Set(chosen));
  const all = [...skipped.filter((item) => chosen.includes(item.id)), ...outcome.skipped];
  if (outcome.imported.length) {
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "company_keys_import",
      detail: `Läste in ${outcome.imported.length} nycklar från en fil${view?.match === "other" ? " från ett annat företag (bekräftat)" : ""}: ${outcome.imported.map((item) => item.label).join(", ")}.`.slice(0, 1000) } });
    await recordSecurityEvent({ type: "company_keys_imported", actorId: ctx.user.id, userId: ctx.user.id, organizationId: ctx.organizationId, platform: false, detail: `${outcome.imported.length} nycklar`, headers });
  }
  const answer: KeyImportResult = {
    ok: all.length === 0 && outcome.imported.length > 0,
    message: outcome.imported.length ? `${outcome.imported.length} ${outcome.imported.length === 1 ? "nyckel lästes" : "nycklar lästes"} in.${all.length ? ` ${all.length} lästes inte in.` : ""}` : "Ingen nyckel lästes in.",
    imported: outcome.imported, skipped: all, advice: ROTATE_ADVICE,
  };
  return NextResponse.json(answer, { headers: NO_STORE });
}

/** The route's hand-over: an answer for this file's actions, or null for every other action. */
export async function companyKeyFileCommand(raw: unknown, ctx: Context, headers: Headers): Promise<Response | null> {
  const action = (raw as { action?: unknown } | null)?.action;
  if (typeof action !== "string" || !ACTIONS.has(action)) return null;
  const parsed = commandSchema.safeParse(raw);
  // Never the received value in the answer: only the issue's own text (describeIssue never repeats an input).
  if (!parsed.success) throw new ApiError(400, describeIssue(parsed.error.issues[0] as IssueLike));
  const command = parsed.data;
  await requireAllowed(ctx);
  if (command.action === "export_company_keys") return exportKeys(ctx, headers);
  if (command.action === "preview_company_keys_import") return preview(ctx, command.file, command.passphrase);
  return runImport(ctx, command.file, command.passphrase, command.entries, command.confirmOtherCompany === true, headers);
}
