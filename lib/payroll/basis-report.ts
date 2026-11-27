import { formatSwedish } from "@/lib/swedish-time";
import { CONTENT_WIDTH, continuationOf, createReportKit, mm, REPORT_TONES, type KitIdentity, type KitRow } from "@/lib/workflow/report-kit";
import type { ReportFontBytes } from "@/lib/workflow/report-fonts";
import { formatHours } from "./export";
import { basisKind, basisStatusText, type BasisPerson } from "./basis";
import { pdfTexts } from "@/lib/pdf-templates/catalog";

/**
 * Löneunderlagets PDF (2026-10-30; the design Förslag B 2026-11-03, template 17-löneunderlag): the head with the
 * period, a facts grid with the sums, then one dense table per person with its own bold sum rows, and what to check as
 * plain lines. An internal document: the footer says so.
 */
const hours = (minutes: number) => `${formatHours(minutes, ",")} h`;

/** What to check, person by person in the document's order, so one person's rows stand together; the order within a person is kept. */
export function warningsByPerson(warnings: readonly string[], people: readonly { name: string }[]) {
  const order = (warning: string) => {
    const index = people.findIndex((person) => warning.startsWith(`${person.name} `) || warning.startsWith(`${person.name}:`));
    return index < 0 ? people.length : index;
  };
  return warnings.map((warning, index) => ({ warning, index, person: order(warning) })).sort((a, b) => a.person - b.person || a.index - b.index).map((item) => item.warning);
}

export async function createBasisPdf(input: {
  identity: KitIdentity; fontBytes: ReportFontBytes; from: string; to: string; people: readonly BasisPerson[];
  onlyApproved: boolean; warnings: readonly string[]; createdAt?: Date;
}) {
  const createdAt = input.createdAt ?? new Date();
  const period = input.from === input.to ? input.from : `${input.from} – ${input.to}`;
  // PDF-mallar (2026-11-03): the product owner's texts, today's words by default.
  const t = pdfTexts("payroll", input.identity.templates);
  const title = t.text("title");
  const kit = await createReportKit({ identity: input.identity, fontBytes: input.fontBytes, createdAt, head: { kind: t.shown("kind") ? t.text("kind") : "", title, number: period, dates: [[t.text("head.created"), formatSwedish(createdAt, { dateStyle: "short", timeStyle: "short" })], [t.text("head.selection"), t.text(input.onlyApproved ? "selection.approved" : "selection.all")]], continuation: continuationOf(input.identity, `${title} ${period}`) } });
  kit.pdf.setTitle(`${title} ${period}`);
  kit.pdf.setAuthor(input.identity.company || "Workflow");
  kit.pdf.setCreator("Workflow");
  kit.pdf.setProducer("Workflow");
  kit.pdf.setCreationDate(createdAt);
  kit.firstPage();
  const worked = input.people.reduce((sum, person) => sum + person.workedMinutes, 0);
  const absent = input.people.reduce((sum, person) => sum + person.absenceMinutes, 0);
  const other = input.people.reduce((sum, person) => sum + person.otherMinutes, 0);
  kit.facts([
    { label: t.text("fact.period"), value: period },
    { label: t.text("fact.people"), value: String(input.people.length) },
    { label: t.text("fact.worked"), value: hours(worked) },
    ...(other > 0 ? [{ label: t.text("fact.other"), value: hours(other) }] : []),
    { label: t.text("fact.absence"), value: hours(absent) },
    { label: t.text("fact.check"), value: input.warnings.length ? (input.warnings.length === 1 ? t.text("check.one") : t.text("check.many", { antal: input.warnings.length })) : t.text("check.none"), tone: input.warnings.length ? REPORT_TONES.warning : undefined },
  ], { cols: 3 });

  if (!input.people.length) kit.paragraph(t.text("empty"));
  const fixed = mm(30) + mm(22) + mm(18) + mm(22);
  const columns = [
    { key: "kind", label: t.text("col.kind"), width: mm(30) }, { key: "type", label: t.text("col.type"), width: CONTENT_WIDTH - fixed }, { key: "code", label: t.text("col.code"), width: mm(22), align: "center" as const },
    { key: "days", label: t.text("col.days"), width: mm(18), align: "right" as const }, { key: "hours", label: t.text("col.hours"), width: mm(22), align: "right" as const },
  ];
  for (const person of input.people) {
    kit.section(person.name, { note: `${t.text("person.number", { nr: person.employeeNumber || t.text("person.number.none") })} · ${basisStatusText(person)}`, keep: 60 });
    const missing = (code: string) => code ? code : { text: t.text("row.missing"), tone: REPORT_TONES.warning, bold: true };
    const rows: KitRow[] = [
      ...person.worked.map((item) => [basisKind(item), item.timeType, missing(item.code), "", hours(item.minutes)]),
      ...person.absence.map((item) => [t.text("row.absence"), item.label, missing(item.code), String(item.days), hours(item.minutes)]),
      { cells: [t.text("row.sum"), t.text("row.worked"), "", "", hours(person.workedMinutes)], bold: true },
      ...(person.otherMinutes > 0 ? [{ cells: [t.text("row.sum"), t.text("row.other"), "", "", hours(person.otherMinutes)], bold: true }] : []),
    ];
    kit.table({ title: person.name, dense: true, columns, rows, total: [t.text("row.sum"), t.text("row.absence.total"), "", String(person.absence.reduce((sum, item) => sum + item.days, 0)), hours(person.absenceMinutes)] });
  }

  if (input.warnings.length) {
    kit.section(t.text("section.check"), { note: t.shown("check.note") ? t.text("check.note") : undefined, keep: 30 });
    kit.list(warningsByPerson(input.warnings, input.people).map((warning) => `• ${warning}`));
  }
  kit.footer({ note: t.text("footer") });
  return kit.pdf.save();
}
