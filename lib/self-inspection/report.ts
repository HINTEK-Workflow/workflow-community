import { CONTENT_WIDTH, createReportKit, mm, type KitIdentity, type ReportKit } from "@/lib/workflow/report-kit";
import type { ReportFontBytes } from "@/lib/workflow/report-fonts";
import { formatSwedishDate } from "@/lib/swedish-time";
import { ACTIVITY_GROUPS, ACTIVITY_TYPES, peopleOverview, type ContentView, type VersionView } from "./model";
import { capabilityLabel, limitationsOf, mayDo, orgChart, programOutline, type DataBlock } from "./outline";
import { parseProgramText } from "./text";
import { pdfTexts } from "@/lib/pdf-templates/catalog";
import { untraced, type PdfTexts } from "@/lib/pdf-templates/model";

/**
 * The approved programme as PDF (2026-10-06; the design Förslag B 2026-11-03): the head with the version, a facts
 * grid, the table of contents as a list, then numbered sections as plain headings with running text and tables, and the
 * appendices Roller och ansvar and Personer och kompetens as parts of their own. Only an approved version is printed; a
 * draft never is. Authorisation numbers are not part of a version and so never appear here.
 */
const day = (value: string | null) => value ? formatSwedishDate(value.length === 10 ? `${value}T12:00:00Z` : value) : "";

/**
 * "ELSÄK-FS 2017:3 3 kap. 2 §" reads as a doubled 3: the printed reference gets a comma after the regulation's number. Only
 * the print: the stored text of a version stays as it was fixed.
 */
const legalText = (value: string) => value.replace(/(-FS \d{4}:\d+) (?=\d+ kap\.)/g, "$1, ");

/** The programme's own text; `keepAfter` is room its last part keeps under it for what must follow on the same page. */
function text(kit: ReportKit, body: string, keepAfter = 0) {
  const blocks = parseProgramText(legalText(body));
  const items = (block: Extract<(typeof blocks)[number], { type: "list" }>) => block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "•"}  ${item}`);
  blocks.forEach((block, index) => {
    const last = index === blocks.length - 1;
    const after = last ? keepAfter : 0;
    if (block.type === "heading") {
      // A heading keeps its first lines; over a short last list, the list and what follows it.
      const next = blocks[index + 1];
      const whole = index === blocks.length - 2 && next?.type === "list" && next.items.length <= 2;
      kit.subTitle(block.text, whole ? kit.measure(() => kit.list(items(next))).height + keepAfter : 34);
    } else if (block.type === "paragraph") {
      if (after) kit.keep(() => kit.paragraph(block.text), after);
      else kit.paragraph(block.text);
    } else if (block.type === "list") kit.list(items(block), { keepAfter: after });
    else {
      const width = CONTENT_WIDTH / Math.max(1, block.header.length);
      const fitted = kit.fitColumns(block.header.map((label, column) => ({ key: `c${column}`, label, width })), block.rows, block.header.length > 4);
      kit.table({ title: block.header.join(" · "), columns: fitted.columns, rows: block.rows, sizes: fitted.sizes, dense: block.header.length > 4, keepAfter: after });
    }
  });
}

function dataBlock(kit: ReportKit, block: DataBlock, content: ContentView, t: PdfTexts) {
  if (block === "facts") {
    const types = ACTIVITY_GROUPS.map((group) => ({ group: group.label, types: ACTIVITY_TYPES.filter((type) => type.group === group.key && content.activityTypes.includes(type.key)).map((type) => type.label) }))
      .filter((row) => row.types.length);
    kit.subTitle(t.text("facts.heading"), 30);
    if (types.length) kit.table({ title: t.text("types.title"), columns: [{ key: "group", label: t.text("types.col.group"), width: mm(50) }, { key: "types", label: t.text("types.col.types"), width: CONTENT_WIDTH - mm(50) }], rows: types.map((row) => [row.group, row.types.join(", ")]) });
    else kit.paragraph(t.text("facts.no-types"));
    kit.paragraph(t.text(content.worksOnOthersInstallations ? "facts.others.yes" : "facts.others.no"));
    kit.paragraph(t.text("facts.registration", { datum: day(content.registrationCheckedAt) || t.text("facts.not-given") }));
    return;
  }
  if (block === "ere") {
    const rows = content.roles.filter((role) => role.isEre).flatMap((role) => role.members).map((member) => [member.name || t.text("person.unknown"), member.authorizationLevel || t.text("ere.level.none"), member.registered ? t.text("ere.registered") : ""]);
    kit.table({ title: t.text("ere.title"), columns: [{ key: "name", label: t.text("ere.col.name"), width: mm(60) }, { key: "level", label: t.text("ere.col.level"), width: mm(40) }, { key: "reg", label: t.text("ere.col.registered"), width: CONTENT_WIDTH - mm(100) }],
      rows: rows.length ? rows : [[t.text("ere.none"), "", ""]] });
    return;
  }
  if (block === "orgchart") {
    // "Funktion" is the row of the organisation chart; "Nivå" (1–3, 2026-10-07) is the role's level, frozen with the version.
    const rows = orgChart(content.roles).flatMap((row) => row.roles.map((role) => [row.label, role.name, role.level ? String(role.level) : "–", role.members.map((member) => member.name || t.text("person.unknown")).join(", ") || t.text("org.none")]));
    kit.table({ title: t.text("org.title"), columns: [{ key: "function", label: t.text("org.col.function"), width: mm(45) }, { key: "role", label: t.text("org.col.role"), width: mm(45) }, { key: "level", label: t.text("org.col.level"), width: mm(14), align: "center" }, { key: "people", label: t.text("org.col.people"), width: CONTENT_WIDTH - mm(104) }], rows });
    return;
  }
  const people = peopleOverview(content);
  const rows = people.length ? people.map((person) => [person.name || t.text("person.unknown"), person.roles.join(", ") || "–", person.level ? String(person.level) : "–", mayDo(person), limitationsOf(person)]) : [[t.text("people.none"), "", "", "", ""]];
  const fitted = kit.fitColumns([{ key: "name", label: t.text("people.col.person"), width: 100 }, { key: "roles", label: t.text("people.col.roles"), width: 100 }, { key: "level", label: t.text("people.col.level"), width: 30, align: "center" }, { key: "may", label: t.text("people.col.may"), width: 125 }, { key: "limits", label: t.text("people.col.limits"), width: CONTENT_WIDTH - 355 }], rows, true);
  kit.table({ title: t.text("people.title"), dense: true, columns: fitted.columns, rows, sizes: fitted.sizes });
}

export async function createSelfInspectionPdf(input: { identity: KitIdentity; fontBytes: ReportFontBytes; version: VersionView; createdAt?: Date }) {
  const { version } = input;
  const content = version.content;
  const approved = formatSwedishDate(version.approvedAt);
  const createdAt = input.createdAt ?? new Date();
  // PDF-mallar (2026-11-03): the document's fixed texts; the programme's own sections are the company's and are edited in the programme.
  const t = pdfTexts("self_inspection", input.identity.templates);
  const kit = await createReportKit({ identity: input.identity, fontBytes: input.fontBytes, createdAt, head: { kind: t.shown("kind") ? t.text("kind") : "", title: content.title, number: t.text("head.version", { version: version.number }), dates: [[t.text("head.approved"), approved], ...(version.approvedByName ? [[t.text("head.by"), version.approvedByName] as const] : [])], continuation: t.text("head.continued", { version: version.number, datum: approved }) } });
  kit.pdf.setTitle(`${content.title} – version ${version.number}`);
  kit.pdf.setAuthor(input.identity.company || "Workflow");
  kit.pdf.setCreator("Workflow");
  kit.pdf.setProducer("Workflow");
  kit.pdf.setCreationDate(createdAt);
  kit.firstPage();
  // No "Företag" fact: the name stands in the head (PDF review 2026-11-03, finding 11).
  kit.facts([
    { label: t.text("fact.version"), value: String(version.number) },
    { label: t.text("fact.approved"), value: version.approvedByName ? t.text("fact.approved.by", { datum: approved, namn: version.approvedByName }) : approved },
    { label: t.text("fact.registration"), value: content.registrationCheckedAt ?? t.text("registration.none") },
    { label: t.text("fact.change"), value: version.changeReason, span: 12, plain: true },
  ], { cols: 3 });

  const outline = programOutline(content.sections);
  kit.section(t.text("section.contents"), { keep: 30 });
  kit.toc(outline.map((entry) => ({ number: entry.kind === "appendix" ? t.text("toc.appendix", { nr: entry.number }) : entry.number ? `${entry.number}.` : "–", text: entry.title })));

  for (const entry of outline) {
    if (entry.kind === "appendix") {
      // A member's copy holds only their own assessment (2026-10-09) and says so.
      const note = entry.number === "A" ? "appendix.roles" : content.peopleShownFor !== undefined ? "appendix.people.own" : "appendix.people";
      kit.part(t.text("appendix.title", { nr: entry.number, titel: entry.title }), t.shown(note) ? t.text(note) : undefined);
      for (const block of entry.blocks) dataBlock(kit, block, content, t);
      // A role may part between its bullets: the heading keeps its first lines, the closing lines the last bullets.
      if (entry.number === "A") for (const role of content.roles) {
        const ereRole = t.text("role.ere");
        const named = role.isEre && role.name.trim().toLowerCase() !== untraced(ereRole).toLowerCase() ? `${role.name} (${ereRole})` : role.name;
        const description = () => { if (role.description) kit.paragraph(role.description); };
        const closing = () => {
          if (role.capabilities.length) kit.paragraph(t.text("role.program", { lista: role.capabilities.map(capabilityLabel).join(", ") }), { color: kit.colors.muted, size: 9 });
          kit.paragraph(t.text("role.members", { lista: role.members.map((member) => [member.name || t.text("person.unknown"), member.authorizationLevel && t.text("role.member.level", { nivå: member.authorizationLevel }), member.registered && t.text("role.member.registered")].filter(Boolean).join(", ")).join("; ") || t.text("role.members.none") }));
        };
        kit.section(`${named}${role.level ? ` · ${t.text("role.level", { nivå: role.level })}` : ""}`, { note: version.approvedByName ? t.text("role.note.by", { företag: kit.company, datum: approved, namn: version.approvedByName }) : t.text("role.note", { företag: kit.company, datum: approved }), keep: kit.measure(description).height + 34 });
        description();
        text(kit, role.duties, kit.measure(closing).height);
        closing();
      }
      else for (const person of peopleOverview(content)) kit.keep(() => {
        kit.subTitle(person.name || t.text("person.unknown"), 40);
        const roles = person.roles.join(", ") || t.text("person.no-role");
        kit.paragraph(person.level ? t.text("person.roles.level", { lista: roles, nivå: person.level }) : t.text("person.roles", { lista: roles }));
        kit.paragraph(t.text("person.may", { lista: mayDo(person) }));
        const competence = person.competence;
        if (competence?.assessment) kit.paragraph(`${t.text("person.assessment")}${competence.assessedAt ? ` ${day(competence.assessedAt)}` : ""}: ${competence.assessment}`);
        kit.paragraph(t.text("person.limits", { lista: limitationsOf(person) }));
      });
      continue;
    }
    const section = entry.sectionIndex === undefined ? null : content.sections[entry.sectionIndex];
    kit.section(entry.number ? `${entry.number}. ${entry.title}` : entry.title, { note: section?.legalRef ? legalText(section.legalRef) : undefined, keep: 24 });
    if (section) text(kit, section.body);
    for (const block of entry.blocks) dataBlock(kit, block, content, t);
  }
  kit.footer({ note: t.text("footer", { version: version.number, datum: approved, kontrollsumma: version.hash.slice(0, 12) }) });
  return kit.pdf.save();
}
