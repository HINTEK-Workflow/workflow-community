import { continuationOf, createReportKit, CONTENT_WIDTH, mm, type KitIdentity } from "@/lib/workflow/report-kit";
import type { ReportFontBytes } from "@/lib/workflow/report-fonts";
import { controlRows, registerTime, type RegisterEvent } from "./model";
import { pdfTexts } from "@/lib/pdf-templates/catalog";

/**
 * The Kontrollvy as PDF (Personalliggare, steg 1; the design Förslag B 2026-11-03): the head names the register and the
 * site's id number; a facts grid holds the business keeping the register; the tables hold who is on site and every row
 * of the period, originals and corrections, with identity numbers in full and times as ÅÅÅÅ:MM:DD TT:MM:SS (SKVFS 2015:6
 * 12 §). The wide table of registrations is dense and never under 8 pt.
 */
/** The wide table's tighter cells: date and time stay on one line (ÅÅÅÅ:MM:DD TT:MM:SS). */
const EVENT_PAD = mm(1.2);

export async function createStaffRegisterPdf(input: {
  identity: KitIdentity; fontBytes: ReportFontBytes; projectName: string; siteId: string; company: { name: string; orgNo: string };
  from: string; to: string; events: RegisterEvent[]; onSite: RegisterEvent[]; now: Date;
}) {
  const period = input.from === input.to ? input.from : `${input.from} – ${input.to}`;
  // PDF-mallar (2026-11-03): the product owner's texts, today's words by default; the facts the register must show stay required.
  const t = pdfTexts("staff_register", input.identity.templates);
  const title = t.text("title");
  const kit = await createReportKit({ identity: input.identity, fontBytes: input.fontBytes, createdAt: input.now, head: { kind: t.shown("kind") ? t.text("kind") : "", title, number: input.projectName, dates: [[t.text("head.site"), input.siteId], [t.text("head.period"), period]], continuation: continuationOf(input.identity, input.projectName) } });
  kit.pdf.setTitle(`${title} – ${input.projectName}`);
  kit.pdf.setAuthor(input.identity.company || "Workflow");
  kit.pdf.setCreator("Workflow");
  kit.pdf.setProducer("Workflow");
  kit.pdf.setCreationDate(input.now);
  kit.firstPage();
  kit.facts([
    { label: t.text("fact.business"), value: input.company.name },
    { label: t.text("fact.org-no"), value: input.company.orgNo || t.text("org-no.none") },
    { label: t.text("fact.site"), value: input.siteId },
    { label: t.text("fact.period"), value: period },
    { label: t.text("fact.printed"), value: registerTime(input.now) },
  ], { cols: 3 });
  const onSite = input.onSite.map((event) => [event.personName, event.idNumber, `${event.employerName}${event.employerOrgNo ? `, ${event.employerOrgNo}` : ""}`, registerTime(event.occurredAt)]);
  kit.section(t.text("section.on-site"), { keep: 44 });
  kit.table({ title: t.text("section.on-site"), columns: [
    { key: "name", label: t.text("site.col.name"), width: mm(42) }, { key: "id", label: t.text("site.col.id"), width: mm(34) },
    { key: "employer", label: t.text("site.col.employer"), width: CONTENT_WIDTH - mm(42) - mm(34) - mm(40) }, { key: "since", label: t.text("site.col.since"), width: mm(40) },
  ], rows: onSite.length ? onSite : [[t.text("on-site.empty"), "", "", ""]] });
  const rows = controlRows(input.events).map((row) => [String(row.number), row.name, row.idNumber, `${row.employer}${row.employerOrgNo ? `, ${row.employerOrgNo}` : ""}`, row.kind, row.time, `${row.registered}, ${row.registeredBy}`, row.corrects ? (row.reason ? t.text("events.corrects.reason", { nr: row.corrects, skäl: row.reason }) : t.text("events.corrects", { nr: row.corrects })) : row.reason]);
  kit.section(t.text("section.events"), { note: t.shown("events.note") ? t.text("events.note", { period }) : undefined, keep: 44 });
  const fitted = kit.fitColumns([
    { key: "nr", label: t.text("events.col.number"), width: 16, align: "center" }, { key: "name", label: t.text("events.col.name"), width: 62 }, { key: "id", label: t.text("events.col.id"), width: 66 },
    { key: "employer", label: t.text("events.col.employer"), width: 72 }, { key: "kind", label: t.text("events.col.kind"), width: 44 }, { key: "time", label: t.text("events.col.time"), width: 88 },
    { key: "registered", label: t.text("events.col.registered"), width: 92 }, { key: "note", label: t.text("events.col.note"), width: CONTENT_WIDTH - 440 },
  ], rows, true, { padX: EVENT_PAD });
  kit.table({ title: t.text("section.events"), dense: true, columns: fitted.columns, rows: rows.length ? rows : [["", t.text("events.empty"), "", "", "", "", "", ""]], sizes: fitted.sizes, padX: EVENT_PAD });
  kit.footer({ note: t.text("footer", { id_nr: input.siteId }) });
  return kit.pdf.save();
}
