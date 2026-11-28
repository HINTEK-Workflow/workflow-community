import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireModule } from "@/lib/kfid/server";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { recordSecurityEvent } from "@/lib/security/security-log";
import { describeIssue, type IssueLike } from "@/lib/tools/issue-text";
import { newSourceToken, SOURCE_KEY_EXPIRY_DAYS } from "@/lib/machine/keys";
import { storeBatch } from "@/lib/machine/store";
import { ALARM_MODES } from "@/lib/machine/alarm-rules";
import { makeOrder } from "@/lib/machine/alarm-orders";
import { clearAlarmNotices } from "@/lib/machine/alarm-notice-store";
import { analyseSource, decideSuggestion } from "@/lib/machine/analysis-store";
import { explainSuggestion } from "@/lib/machine/analysis-server";
import { partLabels } from "@/lib/maintenance/part-labels";
import { markSimulatorRunner } from "@/lib/machine/alarm-notice-store";
import { SIMULATOR_SOURCE_NAME } from "@/lib/machine/simulator/generate-connection";
import { listSignals, scopeLabels, updateSignal, updateSignalCommand } from "@/lib/machine/signal-admin";
import { isRuleCommand, ruleCommands, runRuleCommand } from "@/lib/machine/rule-admin";
import { MACHINE_CONFIRM_WINDOW_SECONDS } from "@/lib/auth/session-rules";
import { alarmCommands, isAlarmCommand, listAlarmResponsibility, runAlarmCommand } from "@/lib/machine/alarm-responsibility-admin";
import { exportProfile, isProfileCommand, listProfiles, listSamples, profileCommands, runProfileCommand } from "@/lib/machine/profile-admin";

export const dynamic = "force-dynamic";

/**
 * Maskiner (S2): the company admin creates the sources that may send events and their keys. A key is shown once and stored
 * as a hash; it can be replaced (the old one stops at once) and revoked. The page reads the sources and their latest events.
 */
const MAX_SOURCES = 25;
const noStore = { "Cache-Control": "private, no-store" } as const;
const name = z.string().trim().min(1, "Skriv källans namn.").max(80, "Namnet får vara högst 80 tecken.");
const expiry = z.union([z.literal(0), z.literal(SOURCE_KEY_EXPIRY_DAYS[0]), z.literal(SOURCE_KEY_EXPIRY_DAYS[1]), z.literal(SOURCE_KEY_EXPIRY_DAYS[2])]).default(365);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name, expiresInDays: expiry }),
  z.object({ action: z.literal("rotate"), id: z.string().min(1).max(64), expiresInDays: expiry }),
  z.object({ action: z.literal("revoke"), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal("rename"), id: z.string().min(1).max(64), name }),
  z.object({ action: z.literal("remove"), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal("test_event"), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal("set_alarm"), id: z.string().min(1).max(64), alarmMode: z.enum(ALARM_MODES), cooldownMinutes: z.number().int().min(1, "Minst 1 minut.").max(1440, "Högst 1 440 minuter.") }),
  // Integrationsmotorn E1, since Underhåll (2026-10-30) a part in the machine tree: the source's default machine part, or none.
  z.object({ action: z.literal("set_part"), id: z.string().min(1).max(64), partId: z.string().min(1).max(100).nullable() }),
  // K2.5 (2026-11-28): the machine parts the source's key may write events for; an empty list is no limit.
  z.object({ action: z.literal("set_allowed_parts"), id: z.string().min(1).max(64), partIds: z.array(z.string().min(1).max(100)).max(200) }),
  // Integrationsmotorn E2: a signal's name, unit, status (Upptäckt/Aktiv/Ignorerad), machine part and dead band.
  updateSignalCommand,
  // E4: format profiles, the source's profile and Fånga prov.
  ...profileCommands,
  // E3: rules on a signal.
  ...ruleCommands,
  // E6: Larmansvar – when alarm notices go out, minutes per step, and the responsible person and deputy per object.
  ...alarmCommands,
  z.object({ action: z.literal("approve_order"), orderId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("dismiss_order"), orderId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("dismiss_suggestion"), suggestionId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("acknowledge_suggestion"), suggestionId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("explain_suggestion"), suggestionId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("analyse_now") }),
]);

/**
 * The changes that need the confirmation within 15 minutes: they decide what can become a work order (E3), or who is told
 * of an alarm and when (E6).
 */
const CONFIRMED_ACTIONS = new Set(["save_profile", "import_profile", "delete_profile", "set_profile", "create_rule", "update_rule", "delete_rule", "set_alarm_settings", "set_alarm_contacts"]);

async function admin() {
  const ctx = await context();
  requireAdmin(ctx);
  if (ctx.organization.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Maskinintag kräver serverlagring. Local-företag har sina data i den egna filen.");
  return ctx;
}

const statusOf = (source: { secretHash: string | null; keyRevokedAt: Date | null; keyExpiresAt: Date | null; isActive: boolean }, now = new Date()) =>
  source.keyRevokedAt || !source.secretHash ? "revoked" : source.keyExpiresAt && source.keyExpiresAt <= now ? "expired" : !source.isActive ? "inactive" : "active";

export async function GET(request: Request) {
  try {
    const ctx = await admin();
    const url = new URL(request.url);
    const sourceId = url.searchParams.get("sourceId");
    // E2: the source's signal page.
    // E4: the company's format profiles, one profile as a file, and a source's caught samples.
    // E6: Larmansvar.
    if (url.searchParams.get("alarms") === "1") return NextResponse.json(await listAlarmResponsibility(ctx.organizationId), { headers: noStore });
    if (url.searchParams.get("profiles") === "1") return NextResponse.json(await listProfiles(ctx.organizationId), { headers: noStore });
    const profileId = url.searchParams.get("profileId");
    if (profileId && url.searchParams.get("export") === "1") return NextResponse.json(await exportProfile(ctx.organizationId, profileId), { headers: { ...noStore, "Content-Disposition": "attachment; filename=\"formatprofil.json\"" } });
    if (sourceId && url.searchParams.get("samples") === "1") return NextResponse.json(await listSamples(ctx.organizationId, sourceId), { headers: noStore });
    if (sourceId && url.searchParams.get("signals") === "1") return NextResponse.json(await listSignals(ctx.organizationId, sourceId), { headers: noStore });
    if (sourceId) {
      const source = await prisma.machineSource.findFirst({ where: { id: sourceId, organizationId: ctx.organizationId }, select: { id: true } });
      if (!source) throw new ApiError(404, "Källan finns inte.");
      const events = await prisma.machineEvent.findMany({
        where: { organizationId: ctx.organizationId, sourceId }, orderBy: { occurredAt: "desc" }, take: 50,
        select: { id: true, eventId: true, occurredAt: true, receivedAt: true, type: true, code: true, severity: true, state: true, text: true, basis: true, values: true },
      });
      return NextResponse.json({ events }, { headers: noStore });
    }
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [sources, recent, signalRows] = await Promise.all([
      prisma.machineSource.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: "asc" } }),
      prisma.machineEvent.groupBy({ by: ["sourceId"], where: { organizationId: ctx.organizationId, receivedAt: { gte: since } }, _count: { _all: true } }),
      prisma.machineSignal.groupBy({ by: ["sourceId", "status"], where: { organizationId: ctx.organizationId }, _count: { _all: true } }),
    ]);
    const counts = new Map(recent.map((row) => [row.sourceId, row._count._all]));
    const signalCount = (sourceId: string, status?: string) => signalRows.filter((row) => row.sourceId === sourceId && (!status || row.status === status)).reduce((sum, row) => sum + row._count._all, 0);
    const partById = await partLabels(ctx.organizationId, sources.flatMap((source) => [source.machinePartId, ...source.allowedMachinePartIds]));
    // Opening the page refreshes the analysis (at most once an hour per source); with Underhåll off the page only reads.
    if (organizationModuleOn(ctx.organization, "upkeep")) for (const source of sources) { try { await analyseSource(source); } catch { /* the page still opens */ } }
    const suggestions = await prisma.machineSuggestion.findMany({ where: { organizationId: ctx.organizationId, status: "open" }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, sourceId: true, scopeKey: true, kind: true, title: true, basis: true, explanation: true, createdAt: true } });
    const labels = await scopeLabels(ctx.organizationId, suggestions.map((row) => row.scopeKey));
    const waiting = await prisma.machineAlarmOrder.findMany({ where: { organizationId: ctx.organizationId, status: "pending" }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true, sourceId: true, code: true, severity: true, text: true, createdAt: true } });
    const names = new Map(sources.map((source) => [source.id, source.name]));
    return NextResponse.json({
      suggestions: suggestions.map((row) => ({ ...row, sourceName: names.get(row.sourceId) ?? "", scopeLabel: labels.get(row.scopeKey) ?? "" })),
      waiting: waiting.map((row) => ({ ...row, sourceName: names.get(row.sourceId) ?? "" })),
      sources: sources.map((source) => ({
        alarmMode: source.alarmMode, cooldownMinutes: source.cooldownMinutes, part: source.machinePartId ? partById.get(source.machinePartId) ?? null : null,
        // K2.5: the machines the key may write for (empty = all).
        allowedParts: source.allowedMachinePartIds.flatMap((id) => { const label = partById.get(id); return label ? [label] : []; }),
        id: source.id, name: source.name, displayHint: source.displayHint, status: statusOf(source), keyIssuedAt: source.keyIssuedAt, keyExpiresAt: source.keyExpiresAt,
        lastUsedAt: source.lastUsedAt, lastEventAt: source.lastEventAt, events24h: counts.get(source.id) ?? 0,
        profileId: source.profileId, captureUntil: source.captureUntil && source.captureUntil > new Date() ? source.captureUntil : null,
        signals: { total: signalCount(source.id), discovered: signalCount(source.id, "discovered"), active: signalCount(source.id, "active"), ignoredOverCap: source.ignoredSignals },
      })),
      limit: MAX_SOURCES, expiryChoices: SOURCE_KEY_EXPIRY_DAYS,
    }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await admin();
    requireModule(ctx, "upkeep");
    const parsed = command.safeParse(await body(request));
    if (!parsed.success) throw new ApiError(400, describeIssue(parsed.error.issues[0] as IssueLike));
    const input = parsed.data;
    const audit = (detail: string) => prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "machine_source", detail } });
    const security = () => recordSecurityEvent({ type: "api_key_created", actorId: ctx.user.id, organizationId: ctx.organizationId, platform: false, detail: "Maskinkälla", headers: request.headers });
    const expiresAt = (days: number) => (days ? new Date(Date.now() + days * 86_400_000) : null);

    if (input.action === "create") {
      // Like a new API key: a password or code within ten minutes before a key is issued.
      await requireFreshAuth(ctx.user.id, ctx.auth);
      if (await prisma.machineSource.count({ where: { organizationId: ctx.organizationId } }) >= MAX_SOURCES) throw new ApiError(409, `Företaget har redan ${MAX_SOURCES} källor. Ta bort en först.`);
      const id = randomBytes(12).toString("hex");
      const issued = newSourceToken(id);
      await prisma.$transaction([
        prisma.machineSource.create({ data: { id, organizationId: ctx.organizationId, name: input.name, secretHash: issued.secretHash, displayHint: issued.displayHint, keyExpiresAt: expiresAt(input.expiresInDays), createdById: ctx.user.id } }),
        audit(`Skapade maskinkällan ”${input.name}”.`),
      ]);
      await security();
      if (input.name === SIMULATOR_SOURCE_NAME) await markSimulatorRunner({ organizationId: ctx.organizationId, sourceId: id, userId: ctx.user.id });
      // The only time the key leaves the server.
      return NextResponse.json({ id, token: issued.token, displayHint: issued.displayHint }, { headers: noStore });
    }

    if (input.action === "dismiss_suggestion" || input.action === "acknowledge_suggestion") {
      const done = await decideSuggestion(ctx.organizationId, input.suggestionId, input.action === "dismiss_suggestion" ? "dismiss" : "acknowledge", ctx.user.id);
      if (!done) throw new ApiError(409, "Förslaget är redan hanterat.");
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    if (input.action === "explain_suggestion") {
      const result = await explainSuggestion(ctx.organizationId, input.suggestionId, ctx.user.id);
      if (!result.ok) throw new ApiError(409, result.reason);
      return NextResponse.json({ explanation: result.explanation }, { headers: noStore });
    }
    if (input.action === "analyse_now") {
      const all = await prisma.machineSource.findMany({ where: { organizationId: ctx.organizationId } });
      let made = 0;
      for (const source of all) made += await analyseSource(source, new Date(), true);
      return NextResponse.json({ made }, { headers: noStore });
    }
    // 2026-10-24 ("Ja, bekräfta innan ändring"): a format profile or a rule that can make work orders is changed only
    // after a sign-in or a confirmation (password or code) within the last 15 minutes; the page asks and tries again.
    if (CONFIRMED_ACTIONS.has(input.action)) await requireFreshAuth(ctx.user.id, ctx.auth, MACHINE_CONFIRM_WINDOW_SECONDS);
    if (isAlarmCommand(input)) {
      const result = await runAlarmCommand(ctx.organizationId, ctx.user.id, input);
      await audit(result.audit);
      return NextResponse.json(result.answer, { headers: noStore });
    }
    if (isRuleCommand(input)) {
      const result = await runRuleCommand(ctx.organizationId, ctx.user.id, input);
      await audit(result.audit);
      return NextResponse.json(result.answer, { headers: noStore });
    }
    if (isProfileCommand(input)) {
      const result = await runProfileCommand(ctx.organizationId, ctx.user.id, input);
      if (result.audit) await audit(result.audit);
      return NextResponse.json(result.answer, { headers: noStore });
    }
    if (input.action === "update_signal") {
      const line = await updateSignal(ctx.organizationId, input);
      await audit(line);
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    if (input.action === "approve_order" || input.action === "dismiss_order") {
      const row = await prisma.machineAlarmOrder.findFirst({ where: { id: input.orderId, organizationId: ctx.organizationId, status: "pending" }, include: { source: { select: { name: true } } } });
      if (!row) throw new ApiError(409, "Förslaget är redan hanterat.");
      const now = new Date();
      if (input.action === "dismiss_order") {
        await prisma.machineAlarmOrder.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "dismissed", decidedAt: now, decidedById: ctx.user.id } });
        await clearAlarmNotices({ organizationId: ctx.organizationId, ref: `p-${row.id}` });
        return NextResponse.json({ ok: true }, { headers: noStore });
      }
      const event = await prisma.machineEvent.findFirst({ where: { id: row.eventRef, organizationId: ctx.organizationId }, select: { occurredAt: true } });
      let taskId: string;
      try {
        taskId = await makeOrder(row.id, ctx.organizationId, row.source.name, { code: row.code, severity: row.severity, text: row.text, occurredAt: event?.occurredAt ?? row.createdAt }, now, ctx.user.id);
      } catch (error) {
        if (error instanceof Error && error.message === "already_handled") throw new ApiError(409, "Förslaget är redan hanterat.");
        throw error;
      }
      await audit(`Godkände larmförslag från ”${row.source.name}” och skapade en arbetsorder.`);
      return NextResponse.json({ ok: true, taskId }, { headers: noStore });
    }
    const source = await prisma.machineSource.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
    if (!source) throw new ApiError(404, "Källan finns inte.");
    if (input.action === "set_part") {
      // The part must be one of the company's machine parts; the database's trigger holds the same border.
      const part = input.partId ? await prisma.machinePart.findFirst({ where: { id: input.partId, organizationId: ctx.organizationId, isActive: true }, select: { id: true, name: true } }) : null;
      if (input.partId && !part) throw new ApiError(404, "Maskindelen finns inte eller är pausad.");
      await prisma.$transaction([
        prisma.machineSource.update({ where: { id: source.id }, data: { machinePartId: part?.id ?? null } }),
        audit(part ? `Kopplade maskinkällan ”${source.name}” till maskindelen ”${part.name}”.` : `Tog bort maskindelen från maskinkällan ”${source.name}”.`),
      ]);
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    if (input.action === "set_allowed_parts") {
      // Every chosen part must be one of the company's own; a limit is a key change, so it asks for a fresh confirmation.
      await requireFreshAuth(ctx.user.id, ctx.auth, MACHINE_CONFIRM_WINDOW_SECONDS);
      const wanted = [...new Set(input.partIds)];
      const parts = wanted.length ? await prisma.machinePart.findMany({ where: { id: { in: wanted }, organizationId: ctx.organizationId }, select: { id: true, name: true } }) : [];
      if (parts.length !== wanted.length) throw new ApiError(404, "En av maskindelarna finns inte i företaget.");
      await prisma.$transaction([
        prisma.machineSource.update({ where: { id: source.id }, data: { allowedMachinePartIds: parts.map((part) => part.id) } }),
        audit(parts.length ? `Begränsade nyckeln för maskinkällan ”${source.name}” till ${parts.length === 1 ? "maskindelen" : "maskindelarna"} ${parts.map((part) => `”${part.name}”`).join(", ")}.` : `Tog bort begränsningen av nyckeln för maskinkällan ”${source.name}”. Den får skriva för alla maskiner igen.`),
      ]);
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    if (input.action === "set_alarm") {
      await prisma.$transaction([
        prisma.machineSource.update({ where: { id: source.id }, data: { alarmMode: input.alarmMode, cooldownMinutes: input.cooldownMinutes } }),
        audit(`Ändrade larm till arbetsorder för maskinkällan ”${source.name}” till ${input.alarmMode}.`),
      ]);
      return NextResponse.json({ ok: true }, { headers: noStore });
    }

    if (input.action === "rotate") {
      await requireFreshAuth(ctx.user.id, ctx.auth);
      const issued = newSourceToken(source.id);
      await prisma.$transaction([
        prisma.machineSource.update({ where: { id: source.id }, data: { secretHash: issued.secretHash, displayHint: issued.displayHint, keyIssuedAt: new Date(), keyExpiresAt: expiresAt(input.expiresInDays), keyRevokedAt: null } }),
        audit(`Bytte nyckeln för maskinkällan ”${source.name}”. Den gamla nyckeln gäller inte längre.`),
      ]);
      await security();
      if (source.name === SIMULATOR_SOURCE_NAME) await markSimulatorRunner({ organizationId: ctx.organizationId, sourceId: source.id, userId: ctx.user.id });
      return NextResponse.json({ id: source.id, token: issued.token, displayHint: issued.displayHint }, { headers: noStore });
    }
    if (input.action === "revoke") {
      await prisma.$transaction([
        prisma.machineSource.update({ where: { id: source.id }, data: { keyRevokedAt: new Date() } }),
        audit(`Återkallade nyckeln för maskinkällan ”${source.name}”.`),
      ]);
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    if (input.action === "rename") {
      await prisma.$transaction([
        prisma.machineSource.update({ where: { id: source.id }, data: { name: input.name } }),
        audit(`Bytte namn på maskinkällan ”${source.name}” till ”${input.name}”.`),
      ]);
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    if (input.action === "remove") {
      // Its events go with it (they belong to the source). The history says what was removed, never what the events held.
      await prisma.$transaction([
        prisma.machineSource.delete({ where: { id: source.id } }),
        audit(`Tog bort maskinkällan ”${source.name}” och dess händelser.`),
      ]);
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    // test_event: one harmless event through the same path as a real one, so "senast hörd" and the list can be tried.
    const now = new Date();
    const [result] = await storeBatch({ sourceId: source.id, organizationId: ctx.organizationId }, [{
      index: 0, kind: "valid",
      event: { eventId: `test-${now.getTime()}`, occurredAt: now, type: "state", code: "TEST", severity: "info", state: "running", text: "Testhändelse från Workflow", basis: null, values: null },
    }], now);
    return NextResponse.json({ result }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
