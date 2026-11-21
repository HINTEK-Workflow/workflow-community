import { REVERSE_VAT_LABEL, REVERSE_VAT_TEXT } from "@/lib/quotes/model";
import { DEVIATION_RETENTION_TEXT } from "@/lib/self-inspection/retention";
import { pdfTextsOf, type PdfBlockDef, type PdfDocumentDef, type PdfTemplateOverride, type PdfTexts } from "./model";

/**
 * The documents' default blocks (PDF-mallar, 2026-11-03 and 2026-11-04; the model is ./model.ts). Each document type
 * lists every fixed text the generator prints: the head, headings, labels, table column labels, notes, the approval and
 * terms lines, the payment box, the signature labels and the footer's note. Never data, sums, what a person wrote, the words
 * for a status or an assessment (the same words as on the screens; docs/rapportprinciper.md) or layout. The defaults are
 * today's texts word for word, so with no overrides every PDF reads exactly as before.
 *
 * `common` holds what the kit itself prints on every document ("Sida n av N", "Namnförtydligande", "Bilagor" …).
 *
 * A changed default here is an upgrade: blocks without an override follow it at once, overridden ones are flagged in the
 * editor, required ones take the new text ("Lagkrav uppdaterades"). Never reuse an id for another meaning; a block that
 * is removed has its overrides archived by the server. Adding a document: a new entry below, then `pdfTexts(type,
 * identity.templates)` in its generator in place of the literal strings, and its example in ./examples.ts. A text that is
 * not in the catalogue cannot be clicked in the editor.
 */
export const PDF_TEMPLATES_EDITION = "2026-11-20.1";

/** The ROT note to the customer, exactly as decided (2026-11-20): the deduction is preliminary and the Tax Agency decides. */
export const ROT_NOTE = "Preliminärt avdrag. Skatteverket avgör.";
const SNAPSHOT_BAND = "ÖGONBLICKSBILD – EJ FÄRDIGSTÄLLT";

type More = Partial<Pick<PdfBlockDef, "placeholders" | "needs" | "when" | "max" | "group" | "required" | "locked">>;
/** The placeholders of a text, all of them needed. */
const ph = (...names: string[]) => ({ placeholders: names, needs: names });
/** A label or a value word printed as part of the drawing: its text may change, it is always there. */
const label = (id: string, text: string, more: More = {}, name = text): PdfBlockDef => ({ id, kind: "label", name, text, always: true, ...more });
const column = (id: string, text: string, name = text): PdfBlockDef => ({ id, kind: "column", name, text, always: true });
const line = (id: string, name: string, text: string, more: More = {}): PdfBlockDef => ({ id, kind: "paragraph", name, text, always: true, ...more });
const heading = (id: string, text: string, more: More = {}, name = text): PdfBlockDef => ({ id, kind: "section", name, text, always: true, ...more });
/** The blocks of one part of the page, for the editor's overview. */
const area = (name: string, blocks: readonly PdfBlockDef[]): PdfBlockDef[] => blocks.map((block) => ({ ...block, area: name }));

/** The specification's columns and the summary box, the same on a quote and an invoice basis. */
const SPEC_COLUMNS = area("Specifikation", [column("col.row", "Rad"), column("col.article", "Art.nr"), column("col.name", "Benämning"), column("col.quantity", "Antal"), column("col.unit", "Enhet"), column("col.price", "À-pris"), column("col.amount", "Belopp")]);
const SUM_ROWS = area("Summering", [
  label("sum.net", "Summa exkl. moms"),
  label("sum.vat", "Moms", { when: "Omvänd moms" }, "Moms (omvänd moms)"),
  label("sum.vat.percent", "Moms {procent} %", ph("procent")),
  label("sum.gross", "Summa inkl. moms", { when: "Med ROT-avdrag" }),
  label("sum.rot-base", "Arbetskostnad inkl. moms (ROT)", { when: "Med ROT-avdrag" }),
  label("sum.rot", "Preliminärt ROT-avdrag {procent} %", { ...ph("procent"), when: "Med ROT-avdrag" }),
  label("sum.rot.cap", "(tak)", { when: "ROT-avdraget når taket" }, "ROT-avdraget når taket"),
  label("sum.after-rot", "efter ROT-avdrag", { when: "Med ROT-avdrag" }),
  label("sum.reverse", "omvänd betalningsskyldighet", { when: "Omvänd moms" }),
]);
const REVERSE_LABEL: PdfBlockDef = { id: "vat.reverse", kind: "legal", name: "Omvänd moms (ordet)", text: REVERSE_VAT_LABEL, required: true, locked: true, when: "Omvänd moms" };

/** What the kit prints on every document. */
const common: PdfDocumentDef = {
  type: "common",
  name: "Gemensamt i alla dokument",
  description: "Sidfoten, signaturernas rader, Bilagor och Kommentarer. En ändring här gäller alla dokument.",
  placeholders: { sida: "Sidans nummer", sidor: "Antal sidor", datum: "Dokumentets datum", nr: "Numret", vad: "Det sidan fortsätter med", etikett: "Etiketten", antal: "Antalet", fil: "Filens namn", bildtext: "Bildens text" },
  blocks: [
    ...area("Sidfot", [
      label("page", "Sida {sida} av {sidor}", ph("sida", "sidor"), "Sidnummer"),
      label("made", "Skapad i Workflow {datum}", ph("datum"), "Skapad i"),
      label("legal.org", "Org.nr {nr}", ph("nr"), "Organisationsnummer"),
      label("legal.seat", "Säte {nr}", { ...ph("nr"), when: "När företaget har fyllt i säte" }, "Säte"),
      label("legal.vat", "Momsreg.nr {nr}", ph("nr"), "Momsregistreringsnummer"),
      label("legal.f-tax", "Godkänd för F-skatt"),
    ]),
    ...area("Fortsättning", [
      label("continued.line", "{vad}, fortsättning från föregående sida", { ...ph("vad"), when: "En tabell fortsätter på nästa sida" }, "Tabell som fortsätter"),
      label("continued.suffix", "fortsättning", {}, "Nummerraden på följande sidor"),
      label("continued.label", "{etikett} (forts.)", { ...ph("etikett"), when: "En lång uppgift fortsätter på nästa sida" }, "Uppgift som fortsätter"),
      label("continued.table", "Tabellen", { when: "En tabell utan namn fortsätter på nästa sida" }, "Tabell utan namn"),
    ]),
    ...area("Signering", [label("sign.name", "Namnförtydligande"), label("sign.date", "Datum"), label("sign.place-date", "Ort och datum")]),
    ...area("Kommentarer och bilagor", [
      heading("section.comments", "Kommentarer", { when: "Kommentarer med i kundrapporten" }),
      heading("section.attachments", "Bilagor", { when: "Dokumentet har bifogade filer" }),
      line("attachments.one", "Bilagor: en fil", "1 bifogad fil följer efter protokollet."),
      line("attachments.many", "Bilagor: flera filer", "{antal} bifogade filer följer efter protokollet.", ph("antal")),
      label("attachment.page", "Bilaga {nr} · {fil}", ph("nr", "fil"), "Rubrik på en bilagas sida"),
      line("image.failed", "Bild som inte går att visa", "{bildtext} – bilden kunde inte bäddas in", ph("bildtext")),
    ]),
    ...area("Riskmatris", [heading("risk.matrix", "Riskmatris", { when: "En riskmatris utan egen rubrik" }), heading("risk.legend", "Risknivå och åtgärdstid")]),
  ],
};

const quote: PdfDocumentDef = {
  type: "quote",
  name: "Offert och ÄTA",
  description: "Offerten till kunden och tillägget (ÄTA) till en accepterad offert.",
  placeholders: { företag: "Företagets namn", giltig_till: "Offertens sista giltighetsdag", version: "Den accepterade versionens nummer", antal_rader: "Antal rader utan pris, t.ex. \"2 rader\"", procent: "Procentsatsen", kontakt: "Kontaktpersonen" },
  groups: { notes: "Noter vid summan", end: "Avsnitt efter summan" },
  blocks: [
    { id: "kind", kind: "kind", name: "Slag (offert)", text: "Ekonomi" },
    { id: "kind.ata", kind: "kind", name: "Slag (ÄTA)", text: "Ekonomi · tillägg till offert" },
    { id: "title", kind: "title", name: "Titel (offert)", text: "Offert", required: true },
    { id: "title.ata", kind: "title", name: "Titel (ÄTA)", text: "ÄTA", required: true },
    ...area("Sidhuvud", [label("head.date", "Datum"), label("head.valid", "Giltig till", { when: "När offerten har ett slutdatum" })]),
    { id: "band.draft", kind: "band", name: "Utkastmärke", text: "UTKAST – INTE SKICKAD", required: true, when: "Utkast" },
    { id: "fact.receiver", kind: "label", name: "Mottagare (offert)", text: "Offert till", required: true },
    { id: "fact.receiver.ata", kind: "label", name: "Mottagare (ÄTA)", text: "Beställare", required: true },
    ...area("Fakta", [
      label("party.none", "Ingen kund angiven", { when: "Offert utan kund" }),
      label("party.attn", "Att: {kontakt}", { ...ph("kontakt"), when: "Kunden har en kontaktperson" }, "Kontaktperson"),
      label("fact.subject", "Avser"),
      label("fact.project", "Projekt", { when: "Offerten hör till ett projekt" }),
      label("fact.place", "Plats", { when: "Offerten har en plats" }),
      label("fact.customer-type", "Kundtyp", { when: "Med ROT-avdrag" }),
      label("fact.customer-type.rot", "Privatperson – ROT", { when: "Med ROT-avdrag" }),
      label("fact.buyer-vat", "Köparens momsreg.nr", { when: "Omvänd moms" }),
      label("fact.changes", "Ändrar", { when: "ÄTA" }),
      label("fact.changes.value", "Version {version} (accepterad)", { ...ph("version"), when: "ÄTA" }),
      label("fact.vat", "Moms"),
      label("fact.vat.value", "{procent} %, priser exkl. moms", ph("procent")),
      label("fact.status", "Status", { when: "Offerten är besvarad" }),
    ]),
    REVERSE_LABEL,
    { id: "section.scope", kind: "section", name: "Omfattning", text: "Omfattning", when: "När offerten har en beskrivning" },
    { id: "section.scope.ata", kind: "section", name: "Orsak (ÄTA)", text: "Orsak till ändringen", when: "När ÄTA:n har en beskrivning" },
    { id: "section.spec", kind: "section", name: "Specifikation", text: "Specifikation", required: true },
    { id: "spec.note", kind: "note", name: "Not under Specifikation", text: "Belopp i SEK exkl. moms" },
    ...SPEC_COLUMNS,
    { id: "spec.empty", kind: "paragraph", name: "Inga rader", text: "Offerten har inga rader.", required: true, when: "Offert utan rader" },
    { id: "approval.heading", kind: "section", name: "Rubrik vid summan", text: "Godkännande" },
    { id: "approval.valid", kind: "paragraph", name: "Giltighet", text: "Offerten gäller till och med {giltig_till}.", placeholders: ["giltig_till"], needs: ["giltig_till"], when: "När offerten har ett slutdatum" },
    { id: "approval.sent", kind: "paragraph", name: "Hur kunden godkänner", text: "Godkänn via länken i meddelandet eller signera nedan och återsänd." },
    { id: "approval.draft", kind: "paragraph", name: "Utkast inte skickat", text: "Utkastet är inte skickat.", required: true, when: "Utkast" },
    { id: "approval.ata", kind: "paragraph", name: "Godkännande (ÄTA)", text: "Arbetet utförs efter beställarens godkännande och faktureras tillsammans med den ursprungliga offerten." },
    { id: "note.reverse-vat", kind: "legal", name: "Omvänd betalningsskyldighet", text: REVERSE_VAT_TEXT, required: true, locked: true, when: "Omvänd moms" },
    { id: "note.rot", kind: "note", name: "ROT-avdrag", text: ROT_NOTE, required: true, group: "notes", when: "Med ROT-avdrag" },
    { id: "note.unpriced", kind: "note", name: "Rader utan pris", text: "{antal_rader} saknar pris och ingår inte i summan.", placeholders: ["antal_rader"], needs: ["antal_rader"], required: true, group: "notes", when: "Rader utan pris" },
    ...SUM_ROWS,
    ...area("Summering", [label("total.to-pay", "Att betala", { when: "Med ROT-avdrag eller omvänd moms" }), label("total.incl", "Totalt inkl. moms")]),
    { id: "pay.number", kind: "label", name: "Nummer i betalrutan (offert)", text: "Offertnummer", required: true },
    { id: "pay.number.ata", kind: "label", name: "Nummer i betalrutan (ÄTA)", text: "ÄTA-nummer", required: true },
    { id: "pay.bankgiro", kind: "label", name: "Bankgiro i betalrutan", text: "Bankgiro", required: true, area: "Betalruta", when: "När företaget har fyllt i bankgiro" },
    { id: "pay.plusgiro", kind: "label", name: "Plusgiro i betalrutan", text: "Plusgiro", required: true, area: "Betalruta", when: "När företaget har fyllt i plusgiro" },
    ...area("Betalruta", [
      label("pay.valid", "Giltig till"), label("pay.vat", "Moms"),
      label("pay.total", "Att betala inkl. moms"), label("pay.total.rot", "Att betala efter ROT", { when: "Med ROT-avdrag" }), label("pay.total.reverse", "Att betala", { when: "Omvänd moms" }, "Att betala (omvänd moms)"),
    ]),
    { id: "total.ata", kind: "label", name: "Beloppet (ÄTA)", text: "Ny total inkl. moms", required: true, when: "ÄTA" },
    { id: "total.ata.reverse", kind: "label", name: "Beloppet (ÄTA, omvänd moms)", text: "Ny total", required: true, when: "ÄTA med omvänd moms" },
    { id: "total.ata.rot", kind: "label", name: "Beloppet (ÄTA, ROT)", text: "Ny total efter ROT", required: true, when: "ÄTA med ROT-avdrag" },
    { id: "change.ata", kind: "label", name: "Ändringen (ÄTA)", text: "Ändring inkl. moms", required: true, when: "ÄTA" },
    { id: "change.ata.reverse", kind: "label", name: "Ändringen (ÄTA, omvänd moms)", text: "Ändring", required: true, when: "ÄTA med omvänd moms" },
    { id: "change.ata.rot", kind: "label", name: "Ändringen (ÄTA, ROT)", text: "Ändring inkl. moms, före ROT", required: true, when: "ÄTA med ROT-avdrag" },
    { id: "section.changes", kind: "section", name: "Ändringar (ÄTA)", text: "Ändringar mot accepterad version", required: true, group: "end", when: "ÄTA" },
    { id: "changes.note", kind: "note", name: "Not under Ändringar", text: "Version {version}. Belopp i kronor exklusive moms.", placeholders: ["version"] },
    { id: "changes.empty", kind: "paragraph", name: "Inga ändringar", text: "Inga ändringar mot den accepterade versionen.", required: true },
    ...area("Ändringar", [
      label("changes.title", "Ändringar", { when: "ÄTA" }, "Tabellens namn"),
      column("changes.col.name", "Benämning"), column("changes.col.change", "Ändring"), column("changes.col.before", "Antal före"), column("changes.col.after", "Antal efter"), column("changes.col.amount", "Belopp"),
      label("changes.added", "Tillagt"), label("changes.removed", "Borttaget"), label("changes.changed", "Ändrat"),
      label("changes.total", "Förändring av summan exkl. moms"),
    ]),
    { id: "section.terms", kind: "section", name: "Villkor", text: "Villkor", required: true, group: "end", when: "När offerten har villkor" },
    { id: "sign.company", kind: "signature", name: "Signatur, företaget", text: "För {företag}", placeholders: ["företag"], required: true },
    { id: "sign.customer", kind: "signature", name: "Signatur, beställaren", text: "Beställarens godkännande", required: true },
  ],
};

const invoiceBasis: PdfDocumentDef = {
  type: "invoice_basis",
  name: "Fakturaunderlag",
  description: "Internt underlag för fakturan, med attest.",
  placeholders: { antal_rader: "Antal rader utan pris, t.ex. \"2 rader\"", procent: "Procentsatsen", kontakt: "Kontaktpersonen", datum: "Datumet", namn: "Personen" },
  groups: { notes: "Noter vid summan" },
  blocks: [
    { id: "kind", kind: "kind", name: "Slag", text: "Ekonomi · internt" },
    { id: "title", kind: "title", name: "Titel", text: "Fakturaunderlag", required: true },
    ...area("Sidhuvud", [label("head.created", "Skapat"), label("head.invoiced", "Fakturerat", { when: "Fakturerat" })]),
    { id: "band.internal", kind: "band", name: "Märke: ej faktura", text: "INTERNT UNDERLAG – EJ FAKTURA", required: true },
    { id: "band.draft", kind: "band", name: "Utkastmärke", text: "UTKAST", required: true, when: "Utkast" },
    { id: "fact.customer", kind: "label", name: "Kund", text: "Kund", required: true },
    ...area("Fakta", [
      label("party.none", "Ingen kund angiven", { when: "Underlag utan kund" }),
      label("party.attn", "Att: {kontakt}", { ...ph("kontakt"), when: "Kunden har en kontaktperson" }, "Kontaktperson"),
      label("fact.subject", "Avser"),
      label("fact.order", "Arbetsorder", { when: "Underlaget hör till en arbetsorder" }),
      label("fact.project", "Projekt", { when: "Underlaget hör till ett projekt" }),
      label("fact.status", "Status"),
      label("fact.invoiced-by", "Fakturerat av", { when: "Fakturerat" }),
      label("fact.buyer-vat", "Köparens momsreg.nr", { when: "Omvänd moms" }),
    ]),
    REVERSE_LABEL,
    { id: "section.spec", kind: "section", name: "Specifikation", text: "Specifikation", required: true },
    { id: "spec.note", kind: "note", name: "Not under Specifikation", text: "Priser i kronor exkl. moms" },
    ...SPEC_COLUMNS,
    ...area("Specifikation", [label("line.rot", "(arbetskostnad, ROT)", { when: "Med ROT-avdrag" }, "Rad med ROT")]),
    { id: "spec.empty", kind: "paragraph", name: "Inga rader", text: "Underlaget har inga rader.", required: true },
    { id: "note.reverse-vat", kind: "legal", name: "Omvänd betalningsskyldighet", text: REVERSE_VAT_TEXT, required: true, locked: true, when: "Omvänd moms" },
    { id: "note.rot", kind: "note", name: "ROT-avdrag", text: ROT_NOTE, required: true, group: "notes", when: "Med ROT-avdrag" },
    { id: "note.unpriced", kind: "note", name: "Rader utan pris", text: "{antal_rader} saknar pris och ingår inte i summan.", placeholders: ["antal_rader"], needs: ["antal_rader"], required: true, group: "notes", when: "Rader utan pris" },
    { id: "pay.bankgiro", kind: "label", name: "Bankgiro i betalrutan", text: "Bankgiro", required: true, area: "Betalruta", when: "När företaget har fyllt i bankgiro" },
    { id: "pay.plusgiro", kind: "label", name: "Plusgiro i betalrutan", text: "Plusgiro", required: true, area: "Betalruta", when: "När företaget har fyllt i plusgiro" },
    { id: "sum.heading", kind: "section", name: "Rubrik vid summan", text: "Till fakturering" },
    { id: "sum.pending", kind: "paragraph", name: "Ej fakturerat", text: "Underlaget förs över till fakturan när det är attesterat.", when: "Inte fakturerat" },
    ...area("Summering", [
      line("state.invoiced", "Fakturerat", "Fakturerat {datum}.", { ...ph("datum"), when: "Fakturerat" }),
      line("state.invoiced.by", "Fakturerat, med namn", "Fakturerat {datum} av {namn}.", { ...ph("datum", "namn"), when: "Fakturerat" }),
      label("total.invoice", "Att fakturera"), label("total.incl", "inkl. moms"),
    ]),
    ...SUM_ROWS,
    ...area("Betalruta", [
      label("pay.basis", "Underlag"), label("pay.status", "Status"), label("pay.vat", "Moms"),
      label("pay.total", "Att fakturera inkl. moms"), label("pay.total.rot", "Att fakturera efter ROT", { when: "Med ROT-avdrag" }), label("pay.total.reverse", "Att fakturera", { when: "Omvänd moms" }, "Att fakturera (omvänd moms)"),
    ]),
    { id: "sign.attest", kind: "signature", name: "Signatur, attest", text: "Attesterat av", required: true },
    { id: "sign.invoice", kind: "signature", name: "Signatur, fakturering", text: "Fakturerat (fakturanr, datum)", required: true },
  ],
};

const workOrder: PdfDocumentDef = {
  type: "work_order",
  name: "Arbetsorderrapport",
  description: "Rapporten över en arbetsorder, även som del av projektrapporten.",
  placeholders: { plats: "Platsen", status: "Status", procent: "Procent klart", del: "Maskindelen", nr: "Numret", antal: "Antalet", timmar: "Timmarna", tid: "Tidpunkten" },
  groups: { body: "Avsnitt i rapporten" },
  blocks: [
    { id: "kind", kind: "kind", name: "Slag", text: "Rapport · arbetsorder" },
    { id: "title", kind: "title", name: "Titel", text: "Arbetsorderrapport", required: true },
    ...area("Sidhuvud", [label("head.done", "Utfört", { when: "Färdigställd" }), label("head.created", "Skapad", { when: "Inte färdigställd" }), label("head.status", "Status")]),
    { id: "band.snapshot", kind: "band", name: "Märke: ej färdigställd", text: SNAPSHOT_BAND, required: true, when: "Arbetsordern är inte färdigställd" },
    { id: "fact.customer", kind: "label", name: "Kund och plats", text: "Kund och plats", required: true },
    ...area("Fakta", [
      label("party.none", "Ingen kund", { when: "Arbetsorder utan kund" }),
      label("party.temp-place", "Tillfällig plats: {plats}", { ...ph("plats"), when: "Tillfällig plats" }, "Tillfällig plats"),
      label("fact.project", "Projekt"), label("project.none", "Utan projekt", { when: "Arbetsorder utan projekt" }),
      label("fact.task", "Uppgift", { when: "I en projektrapport" }),
      label("fact.order", "Hör till arbetsorder", { when: "Uppgiften hör till en arbetsorder" }),
      label("fact.doer", "Utfört av"), label("doer.none", "Inte tilldelad", { when: "Ingen tilldelad" }),
      label("fact.due", "Klart senast", { when: "Med slutdatum" }),
      label("fact.status", "Status"), label("fact.status.value", "{status} · {procent} % klart", ph("status", "procent"), "Status med procent"),
      label("fact.time", "Rapporterad tid"), label("fact.description", "Beskrivning", { when: "Med beskrivning" }),
    ]),
    ...area("Avsnitt", [
      heading("section.project", "Om projektet", { when: "Projektet har egna fält" }),
      heading("section.maintenance", "Underhåll · {del}", { ...ph("del"), when: "Underhållsmoment" }),
      label("maintenance.label", "Underhåll", { when: "Underhåll utan ifyllda uppgifter" }),
      label("maintenance.none", "Inget ifyllt.", { when: "Underhåll utan ifyllda uppgifter" }),
    ]),
    { id: "section.execution", kind: "section", name: "Utfört arbete", text: "Utfört arbete", group: "body" },
    { id: "execution.empty", kind: "paragraph", name: "Inget utfört arbete", text: "Inget utfört arbete dokumenterat.", required: true },
    { id: "section.materials", kind: "section", name: "Tid och material", text: "Tid och material", group: "body" },
    { id: "materials.note", kind: "note", name: "Not med priser", text: "Priser i kronor exkl. moms", when: "Med priser" },
    { id: "materials.empty", kind: "paragraph", name: "Inget material", text: "Inget material registrerat.", required: true },
    ...area("Tid och material", [
      label("table.material", "Material", {}, "Tabellens namn (utan priser)"),
      column("col.name", "Benämning"), column("col.article", "Art.nr"), column("col.quantity", "Antal"), column("col.unit", "Enhet"), column("col.price", "À-pris"), column("col.amount", "Belopp"),
      label("row.labour", "Arbetstid", { when: "Med priser" }),
      label("row.no-rate", "(timpris saknas)", { when: "Med priser och utan timpris" }),
      label("row.no-price", "(pris saknas)", { when: "Med priser och utan pris för tidtypen" }),
      label("row.hours", "h", { when: "Med priser" }, "Enhet för arbetstid"),
      label("row.maker-no", "tillv. {nr}", { ...ph("nr"), when: "Tillverkarens nummer" }, "Tillverkarens nummer"),
      label("total.work-material", "Arbete och material exkl. moms", { when: "Med priser" }),
    ]),
    ...area("Utgifter", [
      label("table.expenses", "Utgifter", { when: "Med utgifter" }, "Tabellens namn"),
      column("col.expense", "Utgift"), column("expenses.col.quantity", "Antal"), column("expenses.col.unit", "Enhet"), column("expenses.col.price", "À-pris"), column("expenses.col.amount", "Belopp"),
      label("total.expenses", "Summa utgifter exkl. moms", { when: "Med priser" }),
      label("total.expenses.one", "(1 rad utan läsbart belopp)", { when: "En utgift utan läsbart belopp" }, "En rad utan belopp"),
      label("total.expenses.many", "({antal} rader utan läsbart belopp)", { ...ph("antal"), when: "Utgifter utan läsbart belopp" }, "Flera rader utan belopp"),
    ]),
    ...area("Summering", [
      label("sum.labour", "Arbete, {timmar} h", { ...ph("timmar"), when: "Med priser" }),
      label("sum.labour.no-rate", "Arbete (timpris saknas)", { when: "Med priser och utan timpris" }),
      label("sum.material", "Material", { when: "Med priser" }), label("sum.expenses", "Utgifter", { when: "Med priser" }),
      line("sum.note.no-rate", "Saknat timpris", "Arbetet saknar timpris och ingår inte i summan.", { when: "Med priser och utan timpris" }),
      label("total.sum", "Totalt", { when: "Med priser" }),
      label("total.small", "exkl. moms · arbete, material och utgifter", { when: "Med priser" }),
      label("total.small.no-rate", "exkl. moms, arbetet utan timpris", { when: "Med priser och utan timpris" }),
    ]),
    { id: "section.closing", kind: "section", name: "Avvikelser och avslut", text: "Avvikelser och avslut", required: true },
    ...area("Avvikelser och avslut", [label("closing.deviations", "Avvikelser"), label("closing.comment", "Avslutande kommentar")]),
    { id: "closing.none", kind: "paragraph", name: "Inga avvikelser", text: "Inga avvikelser dokumenterade.", required: true },
    { id: "closing.no-comment", kind: "paragraph", name: "Ingen kommentar", text: "Ingen avslutande kommentar.", required: true },
    { id: "section.signing", kind: "section", name: "Signering", text: "Signering", required: true },
    { id: "sign.done", kind: "signature", name: "Signatur, utfört av", text: "Utfört av", required: true },
    { id: "sign.unsigned", kind: "signature", name: "Inte signerad", text: "Inte signerad", required: true },
    { id: "sign.receipt", kind: "signature", name: "Signatur, kunden", text: "Kundens kvittens", required: true },
    { id: "sign.no-receipt", kind: "signature", name: "Ingen kvittens", text: "Ingen kvittens", required: true },
    ...area("Signering", [
      label("sign.signed", "Signerad {tid}", { ...ph("tid"), when: "Signerad" }), label("sign.received", "Kvitterat {tid}", { ...ph("tid"), when: "Kvitterad" }), label("sign.received.plain", "Kvitterat", { when: "Kvitterad utan tid" }),
    ]),
    ...area("Bilder och bilagor", [
      heading("section.images", "Bilder", { when: "Med bilder" }),
      label("attach.image", "Bild", { when: "Med bilagor" }, "Bilaga: bild"), label("attach.file", "Fil", { when: "Med bilagor" }, "Bilaga: fil"),
      line("attach.images-above", "Bilagor: bilderna ovan", "Bilderna visas ovan."), line("attach.files", "Bilagor: filer", "Filer som hör till uppgiften."),
    ]),
  ],
};

const riskAssessment: PdfDocumentDef = {
  type: "risk_assessment",
  name: "Riskbedömning",
  description: "Den äldre riskbedömningen och riskbedömningen före arbetet på arbetsorder och protokoll.",
  placeholders: { plats: "Platsen", status: "Status", procent: "Procent klart", tid: "Tidpunkten" },
  blocks: [
    ...area("Sidhuvud", [
      { id: "kind", kind: "kind", name: "Slag", text: "Arbetsmiljö · riskbedömning", always: true }, { id: "title", kind: "title", name: "Titel", text: "Riskbedömning", required: true },
      label("head.done", "Utfört", { when: "Färdigställd" }), label("head.created", "Skapad", { when: "Inte färdigställd" }), label("head.status", "Status"),
      { id: "band.snapshot", kind: "band", name: "Märke: ej färdigställd", text: SNAPSHOT_BAND, required: true, when: "Riskbedömningen är inte färdigställd" },
    ]),
    ...area("Fakta", [
      label("fact.customer", "Kund och plats"), label("party.none", "Ingen kund", { when: "Utan kund" }),
      label("party.temp-place", "Tillfällig plats: {plats}", { ...ph("plats"), when: "Tillfällig plats" }, "Tillfällig plats"),
      label("fact.project", "Projekt"), label("project.none", "Utan projekt", { when: "Utan projekt" }),
      label("fact.task", "Uppgift", { when: "I en projektrapport" }), label("fact.order", "Hör till arbetsorder", { when: "Uppgiften hör till en arbetsorder" }),
      label("fact.responsible", "Ansvarig"), label("responsible.none", "Inte tilldelad", { when: "Ingen tilldelad" }),
      label("fact.due", "Klart senast", { when: "Med slutdatum" }), label("fact.status", "Status"),
      label("fact.status.value", "{status} · {procent} % klart", ph("status", "procent"), "Status med procent"),
      label("fact.time", "Rapporterad tid"), label("fact.assignment", "Uppdrag", { when: "Med beskrivning" }),
      heading("section.project", "Om projektet", { when: "Projektet har egna fält" }),
    ]),
    ...area("Riskmatris", [
      heading("matrix.title", "Riskmatris 5 × 5"), line("matrix.caption", "Matrisens förklaring", "S = sannolikhet, K = konsekvens, 1–5. Siffran är riskens nummer före åtgärd."),
      label("legend.1", "1–4 Låg"), label("legend.1.note", "Åtgärda vid tillfälle"), label("legend.2", "5–9 Måttlig"), label("legend.2.note", "Åtgärd planeras"),
      label("legend.3", "10–16 Hög"), label("legend.3.note", "Åtgärd före arbetet"), label("legend.4", "17–25 Mycket hög"), label("legend.4.note", "Arbetet påbörjas inte utan åtgärd"),
    ]),
    ...area("Identifierade risker", [
      heading("section.risks", "Identifierade risker"), line("risks.note", "Not under Identifierade risker", "S = sannolikhet 1–5, K = konsekvens 1–5; risken före och efter skyddsåtgärden"),
      line("risks.none", "Inga risker", "Inga risker dokumenterade."),
      column("col.number", "Nr"), column("col.hazard", "Riskkälla"), column("col.before", "S×K"), column("col.risk", "Risk"), column("col.measure", "Skyddsåtgärd"), column("col.after", "S×K efter"), column("col.residual", "Kvar"),
      label("measure.none", "Ej angiven", { when: "Risk utan skyddsåtgärd" }),
    ]),
    ...area("Skyddsåtgärder och godkännande", [
      heading("section.general", "Gemensamma skyddsåtgärder"), line("general.none", "Inga gemensamma åtgärder", "Inga gemensamma åtgärder dokumenterade."),
      label("sign.approved", "Godkänd av"), label("sign.approved.at", "Godkänd {tid}", { ...ph("tid"), when: "Godkänd" }), label("sign.approved.none", "Inte godkänd", { when: "Inte godkänd" }),
      label("sign.participants", "Deltagare – har tagit del"),
    ]),
    ...area("Som steg på en arbetsorder eller ett protokoll", [
      heading("step.heading", "Riskbedömning före arbetet"), line("step.extended", "Utökad riskbedömning", "En utökad riskbedömning är kopplad till jobbet och följer som eget dokument.", { when: "Utökad riskbedömning" }),
      label("step.level", "Nivå"), label("step.confirmed", "Bekräftad av"), label("step.confirmed.extended", "Se den utökade riskbedömningen", { when: "Utökad riskbedömning" }), label("step.confirmed.none", "Inte bekräftad", { when: "Inte bekräftad" }),
      label("step.time", "Tidpunkt"),
      heading("step.exception", "Riskbedömning ej gjord: arbetet redan utfört", { when: "Undantag" }), label("step.exception.by", "Angivet av", { when: "Undantag" }), label("step.exception.unknown", "Okänd", { when: "Undantag utan namn" }),
    ]),
  ],
};

const protocol: PdfDocumentDef = {
  type: "protocol",
  name: "Protokoll (mallens fasta texter)",
  description: "Det som står på varje protokoll utöver formuläret: fakta, slutomdöme och signering. Formulärets egna texter ändras i formuläret.",
  contentIn: { text: "Kontrollernas innehåll ändrar du i formuläret. Här ser du hur protokollet ser ut bland de andra dokumenten, och du kan bara ändra de fasta orden runt omkring.", href: "/?view=forms", link: "Öppna formulären" },
  placeholders: { nr: "Protokollets nummer", version: "Mallversionen", kommentar: "Kommentaren", datum: "Tidpunkten", titel: "Kontrollmomentet", godkända: "Antal godkända", antal: "Antalet", procent: "Procent", tabell: "Tabellen", rad: "Raden", namn: "Personen", tid: "Tidpunkten", fil: "Filen", etikett: "Blockets namn", punkt: "Punkten", följer: "Antal filer som följer", status: "Status", lodrätt: "Matrisens lodräta axel", vågrätt: "Matrisens vågräta axel", storlek: "Matrisens storlek" },
  blocks: [
    ...area("Sidhuvud", [
      { ...label("title", "Protokoll", { when: "Formuläret saknar egen rapportrubrik" }, "Titel (reserv)"), elsewhere: "Rubriken ändrar du i formuläret, under Rubrik i PDF:en." },
      label("kind.control", "Kontroll · protokoll"), label("kind.round", "Drift · rondprotokoll"), label("kind.risk", "Arbetsmiljö · före arbete"), label("kind.safety", "Arbetsmiljö · protokoll"),
      label("kind.blank.control", "Kontroll · tom mall"), label("kind.blank.round", "Drift · tom mall"), label("kind.blank.safety", "Arbetsmiljö · tom mall"),
      label("head.template", "Mallversion"), label("head.protocol", "Protokoll", { when: "Färdigställt" }, "Datumets namn (färdigställt)"), label("head.date", "Datum"), label("head.undated", "odaterad", { when: "Datumet saknas" }),
      label("head.version", "Version {version}", { ...ph("version"), when: "Utan protokollnummer" }), label("head.blank", "Tom mall", { when: "Tom mall" }),
      label("footer.code", "Mallversion {version}", ph("version"), "Sidfotens mallversion"),
    ]),
    { id: "band.snapshot", kind: "band", name: "Märke: ej färdigställt", text: SNAPSHOT_BAND, required: true, when: "Protokollet är inte färdigställt" },
    { id: "fact.customer", kind: "label", name: "Fakta: Kund", text: "Kund", required: true },
    { id: "fact.project", kind: "label", name: "Fakta: Projekt", text: "Projekt", required: true },
    { id: "fact.place", kind: "label", name: "Fakta: Plats", text: "Plats", required: true },
    { id: "fact.order", kind: "label", name: "Fakta: Arbetsorder", text: "Arbetsorder", required: true },
    ...area("Fakta", [
      label("party.none", "Ingen kund", { when: "Utan kund" }), label("project.none", "Utan projekt", { when: "Utan projekt" }),
      label("fact.task", "Uppgift", { when: "Utan protokollnummer" }), label("fact.belongs", "Hör till arbetsorder", { when: "Utan protokollnummer" }),
      label("fact.temp-place", "Tillfällig plats", { when: "Tillfällig plats" }), label("fact.doer", "Utförd av", { when: "Formulärets uppgiftsfakta" }), label("fact.responsible", "Ansvarig", { when: "Utan protokollnummer" }),
      label("doer.none", "Inte tilldelad", { when: "Ingen tilldelad" }), label("fact.due", "Klart senast", { when: "Med slutdatum" }), label("fact.date", "Datum", { when: "Tom mall" }, "Datum (tom mall)"), label("fact.status", "Status"),
      label("fact.status.value", "{status} · {procent} % klart", ph("status", "procent"), "Status med procent"), label("fact.time", "Rapporterad tid"), label("fact.description", "Beskrivning", { when: "Med beskrivning" }),
      heading("section.scans", "Bekräftat genom skanning", { when: "Rond med QR-skanning" }), label("scan.point", "punkt: {punkt}", { ...ph("punkt"), when: "Rond med QR-skanning" }, "Skannad punkt"),
      heading("section.project", "Om projektet", { when: "Projektet har egna fält" }),
    ]),
    ...area("Fält och tabeller", [
      label("field.overdue", "Kalibrering förfallen", { when: "Instrumentets kalibrering är förfallen" }), label("field.no-limit", "Gräns saknas – inte bedömt", { when: "Mätvärde utan gräns" }, "Mätvärde utan gräns"), label("field.comment", "Kommentar: {kommentar}", { ...ph("kommentar"), when: "Fält med kommentar" }, "Fältets kommentar"), label("field.deviation", "AVVIKELSE", { when: "Fält markerat som avvikelse" }),
      label("sign.confirmed", "Bekräftad", { when: "Signaturfält" }), label("sign.confirmed.at", "Bekräftad {datum}", { ...ph("datum"), when: "Signaturfält" }), label("sign.unconfirmed", "Inte bekräftad", { when: "Signaturfält" }),
      column("col.row", "Rad"), label("row.number", "Rad {rad}", { ...ph("rad"), when: "Rad utan namn" }, "Rad utan namn"),
      label("row.example", "EXEMPELDATA –", { when: "Formulärets exempelrad" }), label("row.images.one", "1 bild", { when: "Rad med bild" }), label("row.images.many", "{antal} bilder", { ...ph("antal"), when: "Rad med bilder" }),
      label("total.sum", "Summa", { when: "Tabell med summa" }), label("total.min", "Lägsta", { when: "Tabell med lägsta värde" }), label("total.max", "Högsta", { when: "Tabell med högsta värde" }), label("total.avg", "Medel", { when: "Tabell med medelvärde" }), label("total.mixed", "Summering", { when: "Tabell med blandade summeringar" }),
      label("card.item", "Objekt", { when: "Objektkort utan eget namn" }), label("card.deviation", "Avvikelse", { when: "Objektkort med avvikelse" }), label("images.files", "se bilagor", { when: "Bildblock med filer" }), label("images.pictures", "se bilder", { when: "Bildblock" }),
      label("images.below", "{etikett}: {fil} nedan.", { ...ph("etikett", "fil"), when: "Bildblock" }, "Bildblockets rad"),
      label("attach.label", "Bilaga", { when: "Bilaga utan plats" }), label("attach.row", "Rad {rad}", { ...ph("rad"), when: "Bilaga på en rad" }, "Bilaga: rad"),
    ]),
    ...area("Checklista", [
      column("check.col.number", "Nr"), column("check.col.item", "Kontrollpunkt"), column("check.col.ok", "OK"), column("check.col.not-ok", "Ej OK"), column("check.col.na", "Ej akt."), column("check.col.note", "Anmärkning / mätvärde"),
      column("check.col.state", "Bedömning"), column("check.col.comment", "Kommentar"),
    ]),
    { id: "summary.heading", kind: "section", name: "Sammanfattning", text: "Sammanfattning / avvikelser", required: true },
    ...area("Sammanfattning", [
      label("summary.approved", "{titel}: {godkända}/{antal} godkända", ph("titel", "godkända", "antal"), "Godkända per moment"),
      label("summary.not-approved", "{tabell}, {rad}: Ej godkänd.", { ...ph("tabell", "rad"), when: "Rad som inte är godkänd" }, "Rad som inte är godkänd"),
      label("summary.one", "1 avvikelse:", { when: "En avvikelse" }, "En avvikelse"), label("summary.many", "{antal} avvikelser:", { ...ph("antal"), when: "Flera avvikelser" }, "Flera avvikelser"),
      label("summary.more", "… och {antal} till, markerade ovan.", { ...ph("antal"), when: "Fler än åtta avvikelser" }, "Fler avvikelser"), label("summary.warning", "Varning", { when: "Värde utanför varningsgränsen" }),
      line("summary.none", "Inga avvikelser", "Inga avvikelser."), line("summary.no-comment", "Inga kommentarer", "Inga ytterligare kommentarer."),
      line("summary.empty", "Ej ifyllt", "Ej ifyllt – inga kontrollpunkter är ifyllda."),
      label("summary.logged", "Avvikelse {nr} i avvikelseloggen är {status}: {titel}", { ...ph("nr", "status", "titel"), when: "Protokollet har en avvikelse i loggen som inte är klar" }, "Avvikelse i loggen"),
      label("summary.logged.open", "öppen", { when: "Avvikelsen är öppen" }, "Avvikelse: öppen"), label("summary.logged.in-progress", "under åtgärd", { when: "Avvikelsen åtgärdas" }, "Avvikelse: under åtgärd"),
      label("summary.completion", "Kompletteringsgrad: {procent} %", ph("procent"), "Kompletteringsgrad"),
      label("summary.judged", "{tabell}, {rad}: gräns saknas.", { ...ph("tabell", "rad"), when: "Rad bedömd av tekniker" }, "Rad utan gräns"),
    ]),
    { id: "limits.heading", kind: "section", name: "Gränsvärden", text: "Gränsvärden", required: true },
    { id: "limits.note", kind: "note", name: "Not under Gränsvärden", text: "Larm- och varningsnivåer som protokollet bedömts mot." },
    ...area("Gränsvärden", [
      column("limits.col.name", "Storhet"), column("limits.col.alarm", "Larm"), column("limits.col.warning", "Varning"), column("limits.col.source", "Källa"), column("limits.col.origin", "Gäller från"),
      label("origin.form", "Formuläret"), label("origin.facility", "Anläggningen"), label("origin.object", "Objektet"), label("origin.company", "Företaget"),
      line("limits.none.one", "Inga nivåer, ett värde", "Inga larm- eller varningsnivåer var angivna för anläggningen när protokollet fylldes i, så värdet har inte bedömts mot gränsvärden."),
      line("limits.none.many", "Inga nivåer, flera värden", "Inga larm- eller varningsnivåer var angivna för anläggningen när protokollet fylldes i, så värdena har inte bedömts mot gränsvärden."),
      line("limits.none.rows", "Inga värden, raderna bedöms", "Inga av företagets eller anläggningens värden var angivna när protokollet fylldes i. Raderna bedömdes mot de gränser som står på dem."),
      heading("matrix.legend", "Risknivå", { when: "Riskmatris i formuläret" }, "Riskmatrisens förklaring"),
      line("matrix.caption", "Riskmatrisens rad", "{lodrätt} lodrätt, {vågrätt} vågrätt, 1–{storlek}.", { ...ph("lodrätt", "vågrätt", "storlek"), when: "Riskmatris i formuläret" }),
    ]),
    { id: "decision.label", kind: "label", name: "Beslutsrutan", text: "Slutomdöme", required: true },
    { id: "decision.none", kind: "label", name: "Inget omdöme", text: "Inte angivet", required: true },
    ...area("Slutomdöme", [label("decision.by", "Bedömt av {namn}", { ...ph("namn"), when: "Med slutomdöme" })]),
    { id: "section.signing", kind: "section", name: "Signering", text: "Signering", required: true },
    { id: "section.signing.own", kind: "section", name: "Signering (formulär med egna signaturer)", text: "Färdigställande och kvittens", required: true, when: "Formuläret har egna signaturfält" },
    { id: "sign.technician", kind: "signature", name: "Signatur, tekniker", text: "Ansvarig tekniker", required: true },
    { id: "sign.receipt", kind: "signature", name: "Signatur, kunden", text: "Kundens kvittens", required: true },
    { id: "sign.no-receipt", kind: "signature", name: "Ingen kvittens", text: "Ingen kvittens", required: true },
    ...area("Signering", [
      label("sign.finished", "Färdigställt", { when: "Formuläret har egna signaturfält" }), label("sign.finished.at", "Färdigställt {tid}", { ...ph("tid"), when: "Färdigställt" }), label("sign.not-finished", "Inte färdigställt", { when: "Inte färdigställt" }),
      label("sign.not-assigned", "Inte tilldelad · {status}", { ...ph("status"), when: "Ingen tilldelad" }, "Signatur utan tekniker"),
      label("sign.received", "Kvitterat {tid}", { ...ph("tid"), when: "Kvitterad" }), label("sign.received.plain", "Kvitterat", { when: "Kvitterad utan tid" }),
    ]),
    ...area("Bilagor", [
      line("attach.one-above", "Bilagor: bilden ovan", "Bilden visas i protokollet ovan."), line("attach.all-above", "Bilagor: bilderna ovan", "Bilderna visas i protokollet ovan."),
      line("attach.some", "Bilagor: en del ovan", "{följer} av {antal} filer följer efter protokollet; övriga visas ovan.", ph("följer", "antal")),
    ]),
    { id: "blank.decision", kind: "label", name: "Tom mall: beslutsrutan", text: "Resultat", required: true },
    { id: "blank.sign.done", kind: "signature", name: "Tom mall: utförd av", text: "Utförd av", required: true },
    { id: "blank.sign.review", kind: "signature", name: "Tom mall: granskad av", text: "Granskad av", required: true },
  ],
};

const projectReport: PdfDocumentDef = {
  type: "project_report",
  name: "Projektrapport (omslag)",
  description: "Projektrapportens omslag, innehåll och löpande sidfot.",
  placeholders: { projekt: "Projektets namn", procent: "Procent klart" },
  blocks: [
    { id: "kind", kind: "kind", name: "Slag", text: "Rapport · projekt" },
    { id: "title", kind: "title", name: "Titel", text: "Projektrapport", required: true },
    ...area("Sidhuvud", [label("head.compiled", "Sammanställd"), label("head.tasks", "Uppgifter"), label("project.none", "Projekt", { when: "Rapport utan projektnamn" }, "Projekt utan namn")]),
    { id: "cover.kind", kind: "kind", name: "Omslagets rad över titeln", text: "Projektrapport" },
    { id: "fact.project", kind: "label", name: "Fakta: Projekt", text: "Projekt", required: true },
    { id: "fact.count", kind: "label", name: "Fakta: antal uppgifter", text: "Uppgifter i rapporten" },
    { id: "section.contents", kind: "section", name: "Innehåll", text: "Innehåll", required: true },
    { id: "contents.note", kind: "note", name: "Not under Innehåll", text: "Pågående uppgifter är ögonblicksbilder. Protokoll och kontroller följer som egna delar efter arbetsordrarna." },
    ...area("Innehåll", [label("kind.order", "Arbetsorder"), label("kind.risk", "Riskbedömning"), label("part.progress", "{procent} % klart", ph("procent"), "Procent klart")]),
    { id: "time.total", kind: "label", name: "Summa tid", text: "Rapporterad tid, summa", required: true },
    { id: "part.snapshot", kind: "note", name: "Del ej färdigställd", text: "ögonblicksbild, uppgiften är inte färdigställd", required: true },
    { id: "sign.manager", kind: "signature", name: "Signatur, projektledare", text: "Projektledare", required: true },
    { id: "sign.customer", kind: "signature", name: "Signatur, beställaren", text: "Beställarens mottagande", required: true },
    { id: "footer", kind: "footer", name: "Sidfotens not", text: "Projektrapport · {projekt}", placeholders: ["projekt"], required: true },
  ],
};

const staffRegister: PdfDocumentDef = {
  type: "staff_register",
  name: "Personalliggare",
  description: "Kontrollvyn för byggarbetsplatsens personalliggare.",
  placeholders: { period: "Perioden", id_nr: "Byggarbetsplatsens id-nummer", nr: "Radens nummer", skäl: "Skälet" },
  blocks: [
    { id: "kind", kind: "kind", name: "Slag", text: "Personalliggare · kontrollvy" },
    { id: "title", kind: "title", name: "Titel", text: "Personalliggare", required: true },
    ...area("Sidhuvud", [label("head.site", "Id-nr"), label("head.period", "Period")]),
    { id: "fact.business", kind: "label", name: "Fakta: näringsidkare", text: "Näringsidkare", required: true },
    { id: "fact.org-no", kind: "label", name: "Fakta: organisationsnummer", text: "Organisationsnummer", required: true },
    { id: "fact.site", kind: "label", name: "Fakta: id-nr", text: "Byggarbetsplatsens id-nr", required: true },
    { id: "fact.period", kind: "label", name: "Fakta: period", text: "Period", required: true },
    { id: "fact.printed", kind: "label", name: "Fakta: utskriven", text: "Utskriven", required: true },
    ...area("Fakta", [label("org-no.none", "Ej angivet", { when: "Organisationsnummer saknas" })]),
    { id: "section.on-site", kind: "section", name: "På plats nu", text: "På plats nu", required: true },
    ...area("På plats nu", [column("site.col.name", "Namn"), column("site.col.id", "Personnummer"), column("site.col.employer", "Arbetsgivare"), column("site.col.since", "Incheckad")]),
    { id: "on-site.empty", kind: "paragraph", name: "Ingen incheckad", text: "Ingen är incheckad.", required: true },
    { id: "section.events", kind: "section", name: "Registreringar", text: "Registreringar", required: true },
    { id: "events.note", kind: "note", name: "Not under Registreringar", text: "Alla registreringar {period}, original och rättelser.", placeholders: ["period"] },
    ...area("Registreringar", [
      column("events.col.number", "Nr"), column("events.col.name", "Namn"), column("events.col.id", "Personnummer"), column("events.col.employer", "Arbetsgivare"), column("events.col.kind", "Händelse"), column("events.col.time", "Tidpunkt"), column("events.col.registered", "Registrerad"), column("events.col.note", "Rättelse / skäl"),
      label("events.corrects", "Rättar rad {nr}", { ...ph("nr"), when: "Rättelse" }), label("events.corrects.reason", "Rättar rad {nr}: {skäl}", { ...ph("nr", "skäl"), when: "Rättelse med skäl" }),
    ]),
    { id: "events.empty", kind: "paragraph", name: "Inga registreringar", text: "Inga registreringar under perioden.", required: true },
    { id: "footer", kind: "footer", name: "Sidfotens not", text: "Personalliggare · {id_nr}", placeholders: ["id_nr"], needs: ["id_nr"], required: true },
  ],
};

const selfInspection: PdfDocumentDef = {
  type: "self_inspection",
  name: "Egenkontrollprogram",
  description: "Det fastställda programmet; företagets egna avsnitt ändras i programmet, inte här.",
  contentIn: { text: "Programmets innehåll ändrar du i Egenkontroll. Här ser du hur det ser ut bland de andra dokumenten, och du kan bara ändra de fasta orden runt omkring.", href: "/?view=self_inspection", link: "Öppna Egenkontroll" },
  placeholders: { datum: "Datumet", version: "Versionens nummer", kontrollsumma: "Versionens kontrollsumma", namn: "Personen", nr: "Bilagans bokstav", titel: "Rubriken", lista: "Listan", nivå: "Nivån", företag: "Företagets namn" },
  blocks: [
    { id: "kind", kind: "kind", name: "Slag", text: "Egenkontrollprogram" },
    ...area("Sidhuvud", [label("head.version", "Version {version}", ph("version")), label("head.approved", "Fastställd"), label("head.by", "Av", { when: "Med namn" }), label("head.continued", "Version {version} · fastställd {datum}", ph("version", "datum"), "Nummerraden på följande sidor")]),
    ...area("Fakta", [
      label("fact.version", "Version"), label("fact.approved", "Fastställd"), label("fact.approved.by", "{datum} av {namn}", { ...ph("datum", "namn"), when: "Med namn" }, "Fastställd, med namn"), label("fact.registration", "Registreringen kontrollerad"), label("registration.none", "Ej angivet", { when: "Inte kontrollerad" }), label("fact.change", "Ändring"),
    ]),
    { id: "section.contents", kind: "section", name: "Innehåll", text: "Innehåll", required: true },
    ...area("Innehåll", [label("toc.appendix", "Bilaga {nr}", ph("nr"), "Bilaga i innehållet"), heading("appendix.title", "Bilaga {nr}. {titel}", ph("nr", "titel"), "Bilagans rubrik")]),
    { id: "appendix.roles", kind: "note", name: "Bilaga A: not", text: "Rollerna i programmet, deras ansvar och vem som har dem när versionen fastställdes." },
    { id: "appendix.people", kind: "note", name: "Bilaga B: not", text: "Vad var och en får utföra, bedömningen av kompetensen och begränsningar när versionen fastställdes." },
    { id: "appendix.people.own", kind: "note", name: "Bilaga B: not, egen kopia", text: "Vad var och en får utföra när versionen fastställdes. Kompetensbedömningen och begränsningarna står bara för dig; andras visas för dem själva och administratören.", required: true },
    { id: "facts.heading", kind: "section", name: "Programmets uppgifter", text: "Programmets uppgifter", required: true },
    { id: "facts.no-types", kind: "paragraph", name: "Inga verksamhetstyper", text: "Inga verksamhetstyper är angivna.", required: true },
    { id: "facts.others.yes", kind: "paragraph", name: "Andras anläggningar: ja", text: "Företaget utför arbete på anläggningar som andra äger.", required: true },
    { id: "facts.others.no", kind: "paragraph", name: "Andras anläggningar: nej", text: "Företaget utför inte arbete på anläggningar som andra äger.", required: true },
    { id: "facts.registration", kind: "paragraph", name: "Registreringen kontrollerad", text: "Registreringen hos Elsäkerhetsverket kontrollerades senast: {datum}.", placeholders: ["datum"], needs: ["datum"], required: true },
    ...area("Programmets uppgifter", [
      label("facts.not-given", "ej angivet", { when: "Registreringen inte kontrollerad" }, "Inget datum"), label("types.title", "Verksamhetstyper", {}, "Tabellens namn"), column("types.col.group", "Grupp"), column("types.col.types", "Verksamhetstyper"),
    ]),
    ...area("Elinstallatör för regelefterlevnad", [
      label("ere.title", "Elinstallatör för regelefterlevnad", {}, "Tabellens namn"), column("ere.col.name", "Utsedd"), column("ere.col.level", "Auktorisation"), column("ere.col.registered", "Registrering"),
      label("ere.level.none", "Ej angiven"), label("ere.registered", "Står i registreringen"), label("ere.none", "Ingen utsedd"), label("person.unknown", "Okänd person"),
    ]),
    ...area("Organisation", [label("org.title", "Organisation", {}, "Tabellens namn"), column("org.col.function", "Funktion"), column("org.col.role", "Roll"), column("org.col.level", "Nivå"), column("org.col.people", "Utsedda"), label("org.none", "Ingen utsedd", { when: "Roll utan person" }, "Ingen utsedd (roll)")]),
    ...area("Vem får göra vad", [
      label("people.title", "Vem får göra vad", {}, "Tabellens namn"), column("people.col.person", "Person"), column("people.col.roles", "Roller"), column("people.col.level", "Nivå"), column("people.col.may", "Får utföra"), column("people.col.limits", "Begränsningar"),
      line("people.none", "Inga personer", "Inga personer är kopplade till programmet."),
    ]),
    ...area("Roller", [
      label("role.ere", "elinstallatör för regelefterlevnad", {}, "Rollens tillägg"), label("role.level", "nivå {nivå}", { ...ph("nivå"), when: "Roll med nivå" }), label("role.note", "Rollbeskrivning · {företag} · utfärdad {datum}", ph("företag", "datum"), "Rollens not"),
      label("role.note.by", "Rollbeskrivning · {företag} · utfärdad {datum} av {namn}", { ...ph("företag", "datum", "namn"), when: "Med namn" }, "Rollens not, med namn"),
      line("role.program", "Rollens delar i programmet", "I programmet: {lista}.", ph("lista")), line("role.members", "Rollens utsedda", "Utsedda: {lista}.", ph("lista")), label("role.member.level", "auktorisation {nivå}", { ...ph("nivå"), when: "Med auktorisation" }), label("role.member.registered", "står i registreringen", { when: "Står i registreringen" }), label("role.members.none", "ingen", { when: "Roll utan person" }, "Ingen utsedd (rad)"),
    ]),
    ...area("Personer", [
      line("person.roles", "Personens roller", "Roller: {lista}.", ph("lista")), line("person.roles.level", "Personens roller, med nivå", "Roller: {lista}. Nivå: {nivå}.", { ...ph("lista", "nivå"), when: "Person med nivå" }), label("person.no-role", "ingen roll", { when: "Person utan roll" }),
      line("person.may", "Personen får utföra", "Får utföra: {lista}.", ph("lista")), label("person.assessment", "Bedömning", { when: "Med kompetensbedömning" }), line("person.limits", "Personens begränsningar", "Begränsningar: {lista}.", ph("lista")),
    ]),
    { id: "footer", kind: "footer", name: "Sidfotens not", text: "Version {version} · fastställd {datum} · {kontrollsumma}", placeholders: ["version", "datum", "kontrollsumma"], needs: ["version", "kontrollsumma"], required: true },
  ],
};

const deviation: PdfDocumentDef = {
  type: "deviation",
  name: "Avvikelserapport",
  description: "En avvikelse, ett tillbud, ett olycksfall eller loggen med flera.",
  placeholders: { antal: "Antalet", tid: "Tidpunkten", datum: "Datumet", namn: "Personen", titel: "Protokollets namn", text: "Noteringen" },
  groups: { parts: "Delar i rapporten" },
  blocks: [
    { id: "kind.incident", kind: "kind", name: "Slag: arbetsmiljö", text: "Arbetsmiljö · rapport" },
    { id: "kind.deviation", kind: "kind", name: "Slag: avvikelse", text: "Rapport · avvikelse" },
    { id: "kind.log", kind: "kind", name: "Slag: logg", text: "Avvikelselogg" },
    { id: "title.deviation", kind: "title", name: "Titel: avvikelse", text: "Avvikelserapport", required: true },
    { id: "title.near-miss", kind: "title", name: "Titel: tillbud", text: "Tillbudsrapport", required: true },
    { id: "title.accident", kind: "title", name: "Titel: olycksfall", text: "Olycksfallsrapport", required: true },
    { id: "title.risk", kind: "title", name: "Titel: riskobservation", text: "Riskobservation", required: true },
    { id: "title.improvement", kind: "title", name: "Titel: förbättring", text: "Förbättringsförslag", required: true },
    { id: "title.log", kind: "title", name: "Titel: logg", text: "Avvikelselogg", required: true },
    ...area("Sidhuvud", [
      label("head.reported", "Rapporterad", { when: "En post" }), label("head.status", "Status", { when: "En post" }), label("head.created", "Skapad", { when: "Logg" }),
      label("head.posts.one", "1 post", { when: "Logg med en post" }), label("head.posts.many", "{antal} poster", { ...ph("antal"), when: "Logg" }),
    ]),
    ...area("Loggens fakta", [
      label("log.count", "Poster"), label("log.scope", "Urval"), label("log.scope.all", "Alla", { when: "Inget urval" }), label("log.open", "Öppna"), label("log.overdue", "Förfallna"), label("log.overdue.none", "Inga", { when: "Inga förfallna" }), label("log.incidents", "Tillbud och olycksfall"), label("log.created", "Skapad"),
    ]),
    ...area("Fakta", [
      label("fact.reporter", "Rapporterad av"), label("reporter.none", "Okänd", { when: "Utan namn" }), label("fact.responsible", "Ansvarig för ärendet"), label("responsible.none", "Ingen vald", { when: "Ingen ansvarig" }),
      label("fact.due", "Klart senast"), label("due.late", "Förfallen", { when: "Förfallen" }), label("due.none", "Inget datum", { when: "Utan datum" }), label("fact.severity", "Allvarlighetsgrad"), label("fact.status", "Status"), label("fact.class", "Klass", { when: "Egenkontroll" }),
      label("fact.related", "Relaterat", { when: "Kopplad till arbetsorder eller protokoll" }), label("related.protocol", "Protokoll: {titel}", { ...ph("titel"), when: "Kopplad till protokoll" }), label("source.none", "protokollet", { when: "Protokoll utan namn" }, "Protokoll utan namn"),
      label("fact.type", "Typ", { when: "Förbättring" }), label("fact.type.deviation", "Typ av avvikelse"),
    ]),
    { id: "section.description", kind: "section", name: "Beskrivning", text: "Beskrivning", group: "parts" },
    { id: "section.action", kind: "section", name: "Åtgärd", text: "Åtgärd", group: "parts" },
    { id: "section.follow-up", kind: "section", name: "Uppföljning", text: "Uppföljning" },
    { id: "section.investigation", kind: "section", name: "Utredning", text: "Utredning", group: "parts", when: "Tillbud, olycksfall och riskobservation" },
    { id: "section.what", kind: "section", name: "Vad hände", text: "Vad hände" },
    { id: "section.why", kind: "section", name: "Varför", text: "Varför" },
    { id: "section.history", kind: "section", name: "Anmälan och avslut", text: "Anmälan och avslut", group: "parts" },
    { id: "section.photos", kind: "section", name: "Bilder", text: "Bilder", group: "parts" },
    ...area("Utredning", [
      label("investigation.occurred", "Hände"), label("occurred.none", "Inte angivet", { when: "Utan tid" }), label("investigation.marks", "Markeringar"), label("marks.none", "inga", { when: "Utan markeringar" }),
      label("mark.serious", "Anmälningspliktig", { when: "Markerad" }), label("mark.injury", "Personskada", { when: "Markerad" }), label("mark.electrical", "Gäller el", { when: "Markerad" }),
    ]),
    ...area("Anmälan och avslut", [
      line("history.not-reported", "Inte anmäld", "Inte markerad som anmäld", { when: "Anmälningspliktig utan anmälan" }), line("history.reported", "Anmäld", "Anmäld {datum}", { ...ph("datum"), when: "Anmäld" }), line("history.reported.by", "Anmäld, med namn", "Anmäld {datum} av {namn}", { ...ph("datum", "namn"), when: "Anmäld" }),
      line("history.done-note", "Notering vid klar", "Notering vid klar: {text}", { ...ph("text"), when: "Med notering" }), line("history.source", "Från protokoll", "Från protokoll: {titel}", { ...ph("titel"), when: "Kopplad till protokoll" }),
    ]),
    ...area("Bilder", [
      line("photos.one", "En bild utan utskrift", "En bild finns i Workflow.", { when: "Bilden går inte att skriva ut" }), line("photos.many", "Bilder utan utskrift", "{antal} bilder finns i Workflow.", { ...ph("antal"), when: "Bilderna går inte att skriva ut" }),
      line("skipped.one", "En bild kom inte med", "En bild kom inte med i PDF:en (format eller antal) och finns kvar i Workflow.", { when: "Bild utan utskrift" }), line("skipped.many", "Bilder kom inte med", "{antal} bilder kom inte med i PDF:en (format eller antal) och finns kvar i Workflow.", { ...ph("antal"), when: "Bilder utan utskrift" }),
    ]),
    { id: "decision.label", kind: "label", name: "Beslutsrutan", text: "Uppföljning och stängning", required: true },
    ...area("Uppföljning och stängning", [label("decision.done", "Åtgärdad"), label("decision.closed", "Ärendet stängt"), label("decision.closed-date", "Stängt datum: ______________")]),
    { id: "sign.reported", kind: "signature", name: "Signatur, rapporterad av", text: "Rapporterad av", required: true },
    { id: "sign.closed", kind: "signature", name: "Signatur, stängt av", text: "Ärendet stängt av", required: true },
    ...area("Signering", [label("sign.reported.at", "Rapporterad {tid}", ph("tid")), label("sign.closed.at", "Stängt {datum}", { ...ph("datum"), when: "Stängt" })]),
    { id: "empty", kind: "paragraph", name: "Tomt urval", text: "Inga poster i urvalet.", required: true },
    { id: "retention.note", kind: "note", name: "Lagringstid", text: DEVIATION_RETENTION_TEXT, when: "I Cloud" },
  ],
};

const payroll: PdfDocumentDef = {
  type: "payroll",
  name: "Löneunderlag",
  description: "Internt underlag för lönen per period.",
  placeholders: { nr: "Anställningsnumret", antal: "Antalet" },
  blocks: [
    { id: "kind", kind: "kind", name: "Slag", text: "Lön · internt underlag" },
    { id: "title", kind: "title", name: "Titel", text: "Löneunderlag", required: true },
    ...area("Sidhuvud", [label("head.created", "Skapat"), label("head.selection", "Urval"), label("selection.approved", "Bara godkända månader"), label("selection.all", "Alla månader")]),
    ...area("Fakta", [
      label("fact.period", "Period"), label("fact.people", "Personer"), label("fact.worked", "Arbetad tid"), label("fact.other", "Annan tid", { when: "Med annan tid" }), label("fact.absence", "Frånvaro"), label("fact.check", "Att kontrollera"),
      label("check.one", "1 rad", { when: "En rad att kontrollera" }), label("check.many", "{antal} rader", { ...ph("antal"), when: "Rader att kontrollera" }), label("check.none", "Inget", { when: "Inget att kontrollera" }),
    ]),
    { id: "empty", kind: "paragraph", name: "Ingen tid", text: "Ingen tid eller godkänd frånvaro i perioden.", required: true },
    ...area("Personens tabell", [
      label("person.number", "Anställningsnummer {nr}", ph("nr")), label("person.number.none", "saknas", { when: "Anställningsnummer saknas" }),
      column("col.kind", "Slag"), column("col.type", "Typ"), column("col.code", "Kod"), column("col.days", "Dagar"), column("col.hours", "Timmar"),
      label("row.missing", "Saknas", { when: "Lönekod saknas" }), label("row.absence", "Frånvaro"), label("row.sum", "Summa"), label("row.worked", "Arbetad tid"), label("row.other", "Annan tid", { when: "Med annan tid" }), label("row.absence.total", "Frånvaro", {}, "Frånvaro (summa)"),
    ]),
    { id: "section.check", kind: "section", name: "Att kontrollera", text: "Att kontrollera", required: true },
    { id: "check.note", kind: "note", name: "Not under Att kontrollera", text: "Rader som inte är med eller saknar uppgifter." },
    { id: "footer", kind: "footer", name: "Sidfotens not", text: "Internt · personuppgifter · delas bara med lön och den anställde", required: true },
  ],
};

const INVOICE_LEGAL = "Försäljningen är undantagen från momsplikt.";
const INVOICE_LATE = "Vid försenad betalning debiteras dröjsmålsränta enligt räntelagen.";
// The same wording on the invoice (2026-11-20).
const INVOICE_ROT_NOTE = ROT_NOTE;
/** What an invoice and a credit invoice share. What the rules want on the document is required, and the fixed wordings are locked. */
const invoiceBlocks: readonly PdfBlockDef[] = [
  { id: "kind", kind: "kind", name: "Slag", text: "Ekonomi" },
  { id: "date.issued", kind: "label", name: "Fakturadatum", text: "Fakturadatum", required: true },
  { id: "fact.buyer", kind: "label", name: "Köpare", text: "Köpare", required: true },
  { id: "fact.seller", kind: "label", name: "Säljare", text: "Säljare", required: true },
  { id: "fact.buyer-vat", kind: "label", name: "Köparens momsreg.nr", text: "Momsreg.nr", required: true, when: "Omvänd betalningsskyldighet" },
  { id: "fact.subject", kind: "label", name: "Avser", text: "Avser", required: true },
  { id: "fact.performed", kind: "label", name: "Utfört", text: "Utfört", required: true },
  { id: "section.spec", kind: "section", name: "Specifikation", text: "Specifikation", required: true },
  { id: "spec.note", kind: "note", name: "Not under Specifikation", text: "Belopp i SEK exkl. moms" },
  { id: "note.f-tax", kind: "legal", name: "F-skatt", text: "Godkänd för F-skatt", required: true, locked: true, when: "Företaget är godkänt för F-skatt" },
  { id: "note.reverse-vat", kind: "legal", name: "Omvänd betalningsskyldighet", text: REVERSE_VAT_TEXT, required: true, locked: true, when: "Omvänd moms" },
  { id: "note.vat-exempt", kind: "legal", name: "Undantag från moms", text: INVOICE_LEGAL, required: true, locked: true, when: "Företaget säljer utan moms" },
  { id: "note.rot", kind: "legal", name: "Skattereduktion", text: INVOICE_ROT_NOTE, required: true, when: "Med ROT-avdrag" },
  { id: "section.rot", kind: "section", name: "ROT-arbete", text: "ROT-arbete", required: true, when: "Med ROT-avdrag" },
  { id: "fact.personal-number", kind: "label", name: "Köparens personnummer", text: "Köparens personnummer", required: true, when: "Med ROT-avdrag" },
  { id: "fact.property", kind: "label", name: "Fastighetsbeteckning", text: "Fastighetsbeteckning", required: true, when: "Med ROT-avdrag" },
  { id: "fact.brf", kind: "label", name: "Bostadsrättsförening", text: "Bostadsrättsförening, org.nr", required: true, when: "ROT i bostadsrätt" },
  { id: "fact.apartment", kind: "label", name: "Lägenhetsnummer", text: "Lägenhetsnummer", required: true, when: "ROT i bostadsrätt" },
  { id: "fact.work-place", kind: "label", name: "Arbetsplats", text: "Arbetsplats", required: true, when: "Med ROT-avdrag" },
  { id: "fact.performer", kind: "label", name: "Utfört av", text: "Utfört av", required: true, when: "Med ROT-avdrag" },
  { id: "party.org", kind: "label", name: "Org.nr", text: "Org.nr", required: true, locked: true },
  { id: "party.vat", kind: "label", name: "Momsreg.nr", text: "Momsreg.nr", required: true, locked: true },
  { id: "party.seat", kind: "label", name: "Säte", text: "Säte", required: true, locked: true },
  { id: "party.att", kind: "label", name: "Att", text: "Att:", required: true, locked: true },
  { id: "col.row", kind: "label", name: "Kolumn: rad", text: "Rad", required: true, locked: true },
  { id: "col.article", kind: "label", name: "Kolumn: artikelnummer", text: "Art.nr", required: true, locked: true },
  { id: "col.name", kind: "label", name: "Kolumn: benämning", text: "Benämning", required: true, locked: true },
  { id: "col.quantity", kind: "label", name: "Kolumn: antal", text: "Antal", required: true, locked: true },
  { id: "col.unit", kind: "label", name: "Kolumn: enhet", text: "Enhet", required: true, locked: true },
  { id: "col.price", kind: "label", name: "Kolumn: à-pris", text: "À-pris", required: true, locked: true },
  { id: "col.vat", kind: "label", name: "Kolumn: moms", text: "Moms", required: true, locked: true },
  { id: "col.amount", kind: "label", name: "Kolumn: belopp", text: "Belopp", required: true, locked: true },
  { id: "line.rot", kind: "label", name: "Märke på ROT-rad", text: "(arbetskostnad, ROT)", required: true, locked: true, when: "Med ROT-avdrag" },
  { id: "sum.net", kind: "label", name: "Summa exkl. moms", text: "Summa exkl. moms", required: true, locked: true },
  { id: "sum.vat", kind: "label", name: "Moms", text: "Moms", required: true, locked: true },
  { id: "sum.vat-rate", kind: "label", name: "Moms per sats", text: "Moms {sats} %", placeholders: ["sats"], needs: ["sats"], required: true, locked: true },
  { id: "sum.base-rate", kind: "label", name: "Underlag per sats", text: "Underlag {sats} %", placeholders: ["sats"], needs: ["sats"], required: true, locked: true, when: "Flera momssatser" },
  { id: "sum.reverse", kind: "legal", name: "Moms vid omvänd betalningsskyldighet", text: REVERSE_VAT_LABEL, required: true, locked: true, when: "Omvänd moms" },
  { id: "sum.gross", kind: "label", name: "Summa inkl. moms", text: "Summa inkl. moms", required: true, locked: true, when: "Med ROT-avdrag" },
  { id: "sum.labour", kind: "label", name: "Arbetskostnad", text: "Arbetskostnad inkl. moms", required: true, locked: true, when: "Med ROT-avdrag" },
  { id: "sum.other", kind: "label", name: "Material och övrigt", text: "Material och övrigt inkl. moms", required: true, locked: true, when: "Med ROT-avdrag" },
  { id: "sum.rot", kind: "label", name: "Skattereduktion", text: "Skattereduktion ROT {sats} %", placeholders: ["sats"], needs: ["sats"], required: true, locked: true, when: "Med ROT-avdrag" },
  { id: "sum.rot-cap", kind: "label", name: "Tak för skattereduktion", text: "(tak)", required: true, locked: true, when: "Taket nås" },
  { id: "small.vat", kind: "label", name: "Under summan", text: "inkl. moms", required: true, locked: true },
  { id: "small.rot", kind: "label", name: "Under summan, ROT", text: "efter skattereduktion", required: true, locked: true, when: "Med ROT-avdrag" },
  { id: "small.reverse", kind: "label", name: "Under summan, omvänd moms", text: "omvänd betalningsskyldighet", required: true, locked: true, when: "Omvänd moms" },
];

const INVOICE_PLACEHOLDERS = { sats: "Procentsatsen, t.ex. 25", dagar: "Antal dagar" };
const invoice: PdfDocumentDef = {
  type: "invoice",
  name: "Faktura",
  description: "Fakturan till kunden. Den låses när den utfärdas, med mallens texter den dagen.",
  placeholders: INVOICE_PLACEHOLDERS,
  blocks: [
    { id: "title", kind: "title", name: "Titel", text: "Faktura", required: true },
    { id: "band.preview", kind: "band", name: "Märke: förhandsgranskning", text: "FÖRHANDSGRANSKNING – INTE UTFÄRDAD", required: true, when: "Förhandsgranskning" },
    { id: "number.preview", kind: "label", name: "Nummer i förhandsgranskning", text: "Utan nummer", required: true, when: "Förhandsgranskning" },
    { id: "title.proforma", kind: "title", name: "Titel: proformafaktura", text: "Proformafaktura", required: true, when: "Proformafaktura" },
    { id: "band.proforma", kind: "band", name: "Märke: proformafaktura", text: "INTE EN FAKTURA – INGET BETALNINGSKRAV", required: true, when: "Proformafaktura" },
    { id: "total.proforma", kind: "label", name: "Belopp på proformafaktura", text: "Beräknat belopp", required: true, when: "Proformafaktura" },
    { id: "date.due", kind: "label", name: "Förfallodatum", text: "Förfallodatum", required: true },
    { id: "fact.terms", kind: "label", name: "Betalningsvillkor", text: "Betalningsvillkor", required: true },
    { id: "terms.days", kind: "label", name: "Villkorets text", text: "{dagar} dagar", placeholders: ["dagar"], needs: ["dagar"], required: true },
    ...invoiceBlocks,
    { id: "total.pay", kind: "label", name: "Att betala", text: "Att betala", required: true },
    { id: "pay.reference", kind: "label", name: "Betalningsreferens", text: "Ange vid betalning", required: true },
    { id: "pay.ocr", kind: "label", name: "OCR-nummer", text: "OCR-nummer", required: true, when: "Företaget använder OCR" },
    { id: "pay.preview", kind: "label", name: "Referens i förhandsgranskning", text: "Ges vid utfärdandet", required: true, when: "Förhandsgranskning" },
    { id: "pay.bankgiro", kind: "label", name: "Bankgiro", text: "Bankgiro", required: true, locked: true },
    { id: "pay.plusgiro", kind: "label", name: "Plusgiro", text: "Plusgiro", required: true, locked: true },
    { id: "pay.iban", kind: "label", name: "IBAN", text: "IBAN", required: true, locked: true },
    { id: "pay.bic", kind: "label", name: "BIC", text: "BIC", required: true, locked: true },
    { id: "pay.late", kind: "paragraph", name: "Försenad betalning", text: INVOICE_LATE, required: true, when: "Företaget har inga egna villkor" },
  ],
};

const creditInvoice: PdfDocumentDef = {
  type: "credit_invoice",
  name: "Kreditfaktura",
  description: "Rättar en utfärdad faktura. Har eget nummer och hänvisar till fakturan.",
  placeholders: INVOICE_PLACEHOLDERS,
  blocks: [
    { id: "title", kind: "title", name: "Titel", text: "Kreditfaktura", required: true },
    { id: "fact.credits", kind: "label", name: "Krediterar", text: "Krediterar faktura", required: true },
    { id: "fact.reason", kind: "label", name: "Orsak", text: "Orsak", required: true },
    ...invoiceBlocks,
    { id: "total.credit", kind: "label", name: "Krediterat belopp", text: "Krediterat belopp", required: true },
  ],
};

/** Every document type the editor offers, in the editor's order. */
export const PDF_DOCUMENTS: readonly PdfDocumentDef[] = [quote, invoiceBasis, invoice, creditInvoice, workOrder, protocol, riskAssessment, projectReport, staffRegister, selfInspection, deviation, payroll, common];
export type PdfDocumentType = "quote" | "invoice_basis" | "invoice" | "credit_invoice" | "work_order" | "protocol" | "risk_assessment" | "project_report" | "staff_register" | "self_inspection" | "deviation" | "payroll" | "common";
export const PDF_DOCUMENT_TYPES = PDF_DOCUMENTS.map((doc) => doc.type) as PdfDocumentType[];

export function pdfDocumentDef(type: string): PdfDocumentDef | null {
  return PDF_DOCUMENTS.find((doc) => doc.type === type) ?? null;
}

/** The resolved texts a generator reads (defaults when no overrides are given). */
export function pdfTexts(type: PdfDocumentType, overrides?: readonly PdfTemplateOverride[] | null): PdfTexts {
  return pdfTextsOf(pdfDocumentDef(type)!, overrides);
}

/** "1 rad" / "3 rader": the {antal_rader} of a note on rows without a price. */
export const rowCount = (count: number) => `${count} ${count === 1 ? "rad" : "rader"}`;
