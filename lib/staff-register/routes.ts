import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, requireModule, type Context } from "@/lib/kfid/server";
import { requireStaffRegisterWrite, staffRegisterCaller, staffRegisterFailure, staffRegisterWritable } from "@/lib/staff-register/api";
import { controlCsv, controlPeriod, controlRows, personInputSchema, reasonSchema } from "@/lib/staff-register/model";
import { createStaffRegisterPdf } from "@/lib/staff-register/report";
import { controlView, ownRows, registerCheck, registerCorrection, registerStatus, saveOwnIdNumber, savePerson } from "@/lib/staff-register/server";
import { swedishDayKey } from "@/lib/swedish-time";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";

/**
 * Personalliggare, steg 1 (2026-10-09): the handlers behind /api/staff-register and /api/staff-register/export.
 * They take the session context as a loader (the routes pass the real `context`), so the integration test can run the
 * very same code with a prepared context.
 *
 * GET ?projectId= is the project's register panel (your state; who is on site and the people for those with the
 * rights); GET ?projectId=&mine=1 your own recent rows; GET ?projectId=&control=1 (&from= &to= &personId=) the
 * Kontrollvy with identity numbers in full (admin, staff-register:read or the project's responsible person; a person
 * checked in on the site right now gets today only, logged – "Visa för Skatteverket", 2026-10-10). POST checks
 * in or out, corrects a row or saves a person (Origin). Every call is the caller's company only.
 *
 * Payment block (2026-10-09, narrowed the same evening: "bara vid förfallen faktura"): POST here does not call
 * requireCloudWriteAccess but requireStaffRegisterWrite, which lets a company paused for an overdue invoice keep checking
 * people in and out and correcting rows (a legal duty on the building site). Any other block – e.g. the Cloud agreement
 * has ended – stops new rows like everything else, while reading, the Kontrollvy and the export stay open for the
 * retention time ("När ett Cloud-avtal upphör: läs och exportera kvar"). Session, membership, tenant, rights and Origin
 * are checked exactly as before. Do not copy this exemption to any other route.
 */
const noStore = { "Cache-Control": "private, no-store" };
const id = z.string().min(1).max(100);
type LoadContext = () => Promise<Context>;

export async function staffRegisterGet(request: Request, load: LoadContext = context) {
  try {
    const ctx = await load();
    const caller = staffRegisterCaller(ctx);
    const url = new URL(request.url);
    const projectId = id.parse(url.searchParams.get("projectId") ?? "");
    if (url.searchParams.get("control") === "1") {
      const period = controlPeriod(url.searchParams.get("from"), url.searchParams.get("to"), swedishDayKey(new Date()));
      const personId = url.searchParams.get("personId") ? id.parse(url.searchParams.get("personId")) : undefined;
      const view = await controlView(caller, { projectId, startAt: period.startAt, endAt: period.endAt, personId }, ctx.organization.name);
      // limited: "Visa för Skatteverket" – a checked-in person's view of today on this site, without the export.
      return NextResponse.json({
        limited: view.limited, project: view.project, company: view.company, from: period.from, to: period.to,
        rows: controlRows(view.events).map((row) => ({ ...row, occurredAt: view.events.find((event) => event.id === row.id)?.occurredAt.toISOString() ?? "" })),
        onSite: view.onSite.map((event) => ({ personId: event.personId, name: event.personName, idNumber: event.idNumber, employer: event.employerName, employerOrgNo: event.employerOrgNo, since: event.occurredAt.toISOString() })),
      }, { headers: noStore });
    }
    if (url.searchParams.get("mine") === "1") {
      const rows = await ownRows(caller, projectId);
      return NextResponse.json({ rows: rows.map((row) => ({ id: row.id, kind: row.kind, occurredAt: row.occurredAt.toISOString(), registeredAt: row.registeredAt.toISOString(), correctsId: row.correctsId, reason: row.reason, registeredBy: row.registeredByName })) }, { headers: noStore });
    }
    // writable: false shows the register read-only (no Checka in/ut) when new rows are not allowed (see above).
    return NextResponse.json({ ...(await registerStatus(caller, projectId)), writable: await staffRegisterWritable(ctx) }, { headers: noStore });
  } catch (error) {
    return staffRegisterFailure(error);
  }
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), projectId: id, personId: id.optional(), kind: z.enum(["IN", "OUT"]), occurredAt: z.string().max(40).optional(), reason: reasonSchema.optional() }),
  z.object({ action: z.literal("correct"), eventId: id, kind: z.enum(["IN", "OUT", "VOID"]), occurredAt: z.string().max(40).optional(), reason: reasonSchema }),
  z.object({ action: z.literal("save_my_id"), idNumber: z.string().trim().min(1, "Skriv ditt personnummer.").max(40), foreign: z.boolean().default(false) }),
  z.object({ action: z.literal("save_person"), person: personInputSchema }),
]);

export async function staffRegisterPost(request: Request, load: LoadContext = context) {
  try {
    checkOrigin(request);
    const ctx = await load();
    const caller = staffRegisterCaller(ctx);
    // Not requireCloudWriteAccess: only an overdue invoice is exempt for the staff register (see above).
    await requireStaffRegisterWrite(ctx);
    const input = requestSchema.parse(await body(request));
    // Företagets moduler (0.39.0): with Personalliggare off nobody new checks in. The register must still be right, so whoever is
    // checked in can check out and a row can be corrected; the Kontrollvy and the export are reads and never stop.
    if (!(input.action === "correct" || (input.action === "check" && input.kind === "OUT"))) requireModule(ctx, "staff_register");
    if (input.action === "check") return NextResponse.json(await registerCheck(caller, input));
    if (input.action === "correct") return NextResponse.json(await registerCorrection(caller, input));
    if (input.action === "save_my_id") return NextResponse.json({ person: await saveOwnIdNumber(caller, input, ctx.organization.name) });
    return NextResponse.json({ person: await savePerson(caller, input.person, ctx.organization.name) });
  } catch (error) {
    return staffRegisterFailure(error);
  }
}

/**
 * The Kontrollvy as a file for an inspection – CSV (Excel) or PDF – for a period of days and optionally one person
 * (admin, staff-register:read or the project's responsible person). Identity numbers are written in full; the file is
 * never stored. A read, so it never follows the payment block, also after the Cloud agreement has ended.
 */
export async function staffRegisterExport(request: Request, load: LoadContext = context) {
  try {
    const ctx = await load();
    const url = new URL(request.url);
    const projectId = id.parse(url.searchParams.get("projectId") ?? "");
    const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
    const now = new Date();
    const period = controlPeriod(url.searchParams.get("from"), url.searchParams.get("to"), swedishDayKey(now));
    const personId = url.searchParams.get("personId") ? id.parse(url.searchParams.get("personId")) : undefined;
    // Never the on-site view of "Visa för Skatteverket": the export needs the Kontrollvy right.
    const view = await controlView(staffRegisterCaller(ctx), { projectId, startAt: period.startAt, endAt: period.endAt, personId }, ctx.organization.name, now, { exporting: true });
    const base = `personalliggare-${view.project.siteId}-${period.from}${period.to === period.from ? "" : `-${period.to}`}`.replace(/[^\p{L}\p{N}-]+/gu, "-");
    const headers = (type: string, name: string) => ({ "Content-Type": type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store" });
    if (format === "csv") {
      const csv = controlCsv({ company: view.company.name, companyOrgNo: view.company.orgNo, siteId: view.project.siteId, project: view.project.name, from: period.from, to: period.to }, view.events);
      return new Response(csv, { headers: headers("text/csv; charset=utf-8", `${base}.csv`) });
    }
    const bytes = await createStaffRegisterPdf({
      identity: await workflowReportIdentity(ctx.organizationId, ctx.organization.name), fontBytes: await workflowReportFont(),
      projectName: view.project.name, siteId: view.project.siteId, company: view.company, from: period.from, to: period.to, events: view.events, onSite: view.onSite, now,
    });
    return new Response(new Uint8Array(bytes), { headers: headers("application/pdf", `${base}.pdf`) });
  } catch (error) {
    return staffRegisterFailure(error);
  }
}
