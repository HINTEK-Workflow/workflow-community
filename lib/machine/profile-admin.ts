import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { describeIssue, type IssueLike } from "@/lib/tools/issue-text";
import { MAX_BODY_BYTES } from "@/lib/machine/intake";
import { EXAMPLE_PROFILE, EXAMPLE_PROFILE_NAME, IDEMPOTENCY_TEXT, idempotencyCase, interpretRaw, profileDefinitionSchema, profileFile, profileFileSchema, RAW_ERROR_TEXT, RAW_SAMPLE_HOURS, type ProfileDefinition } from "@/lib/machine/raw-profile";

/**
 * Integrationsmotorn E4: the admin's format profiles, the source's profile and "fånga prov". The caller
 * (lib/api-handlers/machine-sources.ts) has checked the session, the admin, Cloud and, for a change, the Origin; every read
 * and write here is bound to the caller's company as well. Raw samples are customer data: only for the admin, 24 hours,
 * never sent to AI.
 */
export const MAX_PROFILES = 50;
const id = z.string().min(1).max(64);
const name = z.string().trim().min(1, "Skriv profilens namn.").max(80, "Namnet får vara högst 80 tecken.");
export const profileCommands = [
  z.object({ action: z.literal("save_profile"), id: id.optional(), name, definition: z.unknown() }),
  z.object({ action: z.literal("delete_profile"), id }),
  z.object({ action: z.literal("import_profile"), file: z.unknown() }),
  z.object({ action: z.literal("preview_profile"), definition: z.unknown(), sample: z.string().max(MAX_BODY_BYTES, "Provet är för stort (högst 64 kB).") }),
  z.object({ action: z.literal("set_profile"), id, profileId: id.nullable() }),
  z.object({ action: z.literal("set_capture"), id, on: z.boolean() }),
  z.object({ action: z.literal("delete_samples"), id }),
] as const;
type Command = z.infer<(typeof profileCommands)[number]>;
export const isProfileCommand = (input: { action: string }): input is Command => profileCommands.some((schema) => schema.shape.action.value === input.action);

function definitionOf(value: unknown): ProfileDefinition {
  const parsed = profileDefinitionSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, `Profilen är inte giltig: ${describeIssue(parsed.error.issues[0] as IssueLike)}`);
  return parsed.data;
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function listProfiles(organizationId: string) {
  const [profiles, used] = await Promise.all([
    prisma.machineFormatProfile.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: MAX_PROFILES, select: { id: true, name: true, version: true, definition: true, updatedAt: true } }),
    prisma.machineSource.groupBy({ by: ["profileId"], where: { organizationId, profileId: { not: null } }, _count: { _all: true } }),
  ]);
  const count = new Map(used.map((row) => [row.profileId, row._count._all]));
  return {
    profiles: profiles.map((profile) => {
      const parsed = profileDefinitionSchema.safeParse(profile.definition);
      return { ...profile, sources: count.get(profile.id) ?? 0, valid: parsed.success, idempotency: parsed.success ? IDEMPOTENCY_TEXT[idempotencyCase(parsed.data)] : "" };
    }),
    example: { name: EXAMPLE_PROFILE_NAME, definition: EXAMPLE_PROFILE },
    limit: MAX_PROFILES,
  };
}

export async function exportProfile(organizationId: string, profileId: string) {
  const profile = await prisma.machineFormatProfile.findFirst({ where: { id: profileId, organizationId }, select: { name: true, definition: true } });
  if (!profile) throw new ApiError(404, "Profilen finns inte.");
  return profileFile(profile.name, definitionOf(profile.definition));
}

/** The samples caught for a source in the last 24 hours (older ones are removed here as well as every night). */
export async function listSamples(organizationId: string, sourceId: string, now = new Date()) {
  const source = await prisma.machineSource.findFirst({ where: { id: sourceId, organizationId }, select: { id: true, captureUntil: true } });
  if (!source) throw new ApiError(404, "Källan finns inte.");
  await prisma.machineRawSample.deleteMany({ where: { sourceId, organizationId, receivedAt: { lt: new Date(now.getTime() - RAW_SAMPLE_HOURS * 3_600_000) } } });
  const samples = await prisma.machineRawSample.findMany({ where: { sourceId, organizationId }, orderBy: { receivedAt: "desc" }, take: 20, select: { id: true, receivedAt: true, body: true } });
  return { captureUntil: source.captureUntil && source.captureUntil > now ? source.captureUntil : null, samples };
}

/** Runs one command; returns the answer and the line for the company's history (null when nothing changed). */
export async function runProfileCommand(organizationId: string, actorId: string, input: Command, now = new Date()): Promise<{ answer: Record<string, unknown>; audit: string | null }> {
  if (input.action === "preview_profile") {
    // "Så här tolkas provet": nothing is saved.
    const definition = definitionOf(input.definition);
    let body: unknown;
    try { body = JSON.parse(input.sample); } catch { throw new ApiError(400, RAW_ERROR_TEXT.invalid_json); }
    const read = interpretRaw(body, definition, now);
    if (!read.ok) throw new ApiError(400, RAW_ERROR_TEXT[read.error]);
    return { answer: { ...read, readings: read.readings.map((reading) => ({ ...reading, at: reading.at.toISOString() })), idempotency: IDEMPOTENCY_TEXT[idempotencyCase(definition)] }, audit: null };
  }
  if (input.action === "save_profile" || input.action === "import_profile") {
    const file = input.action === "import_profile" ? profileFileSchema.safeParse(input.file) : null;
    if (file && !file.success) throw new ApiError(400, "Filen är ingen formatprofil från Workflow.");
    const profileName = input.action === "save_profile" ? input.name : file!.data!.name;
    const definition = definitionOf(input.action === "save_profile" ? input.definition : file!.data!.definition);
    if (input.action === "save_profile" && input.id) {
      const current = await prisma.machineFormatProfile.findFirst({ where: { id: input.id, organizationId }, select: { id: true } });
      if (!current) throw new ApiError(404, "Profilen finns inte.");
      await prisma.machineFormatProfile.updateMany({ where: { id: current.id, organizationId }, data: { name: profileName, definition: json(definition), version: { increment: 1 } } });
      return { answer: { id: current.id }, audit: `Ändrade formatprofilen ”${profileName}”.` };
    }
    if (await prisma.machineFormatProfile.count({ where: { organizationId } }) >= MAX_PROFILES) throw new ApiError(409, `Företaget har redan ${MAX_PROFILES} formatprofiler. Ta bort en först.`);
    const created = await prisma.machineFormatProfile.create({ data: { organizationId, name: profileName, definition: json(definition), createdById: actorId }, select: { id: true } });
    return { answer: { id: created.id }, audit: `${input.action === "import_profile" ? "Importerade" : "Skapade"} formatprofilen ”${profileName}”.` };
  }
  if (input.action === "delete_profile") {
    const profile = await prisma.machineFormatProfile.findFirst({ where: { id: input.id, organizationId }, select: { id: true, name: true } });
    if (!profile) throw new ApiError(404, "Profilen finns inte.");
    const using = await prisma.machineSource.count({ where: { organizationId, profileId: profile.id } });
    if (using) throw new ApiError(409, `Profilen används av ${using} ${using === 1 ? "källa" : "källor"}. Välj en annan profil för dem först.`);
    await prisma.machineFormatProfile.deleteMany({ where: { id: profile.id, organizationId } });
    return { answer: { ok: true }, audit: `Tog bort formatprofilen ”${profile.name}”.` };
  }
  const source = await prisma.machineSource.findFirst({ where: { id: input.id, organizationId }, select: { id: true, name: true } });
  if (!source) throw new ApiError(404, "Källan finns inte.");
  if (input.action === "set_profile") {
    const profile = input.profileId ? await prisma.machineFormatProfile.findFirst({ where: { id: input.profileId, organizationId }, select: { id: true, name: true } }) : null;
    if (input.profileId && !profile) throw new ApiError(404, "Profilen finns inte.");
    await prisma.machineSource.updateMany({ where: { id: source.id, organizationId }, data: { profileId: profile?.id ?? null } });
    return { answer: { ok: true }, audit: profile ? `Maskinkällan ”${source.name}” läser rådata med formatprofilen ”${profile.name}”.` : `Maskinkällan ”${source.name}” har ingen formatprofil.` };
  }
  if (input.action === "set_capture") {
    const until = input.on ? new Date(now.getTime() + RAW_SAMPLE_HOURS * 3_600_000) : null;
    await prisma.machineSource.updateMany({ where: { id: source.id, organizationId }, data: { captureUntil: until } });
    return { answer: { captureUntil: until }, audit: input.on ? `Slog på Fånga prov för maskinkällan ”${source.name}” i 24 timmar.` : `Slog av Fånga prov för maskinkällan ”${source.name}”.` };
  }
  const { count } = await prisma.machineRawSample.deleteMany({ where: { sourceId: source.id, organizationId } });
  return { answer: { removed: count }, audit: `Tog bort ${count} prov för maskinkällan ”${source.name}”.` };
}
