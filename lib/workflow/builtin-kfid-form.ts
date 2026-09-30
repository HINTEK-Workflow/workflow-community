import { formDocumentSchema, type FormDocument } from "./form-document";
import { formMetaSchema } from "./form-publish";
import type { BuiltinForm } from "./builtin-forms";

/**
 * Kontroll före idrifttagning as a form (Daniel 2026-09-27, decision B): HINTEK's original, built only from the form
 * builder's building blocks – moments that can be switched on and off, measurement rows with Godkänd decided by a
 * condition while Autobedömning is on, the RCD tests as cards in the PDF and two-line rows on screen, Visuell kontroll
 * as tick boxes, Sammanfattning and the Stöd vid bedömning chapter. In the task it looks exactly like today's control
 * (Daniel 2026-09-27): the task's project, customer and place inside Grunduppgifter with the moments below them, the
 * measurement panels with the round add and picture buttons, and the summary with its pills and completion card.
 * Its PDF is drawn by the shared form report and is compared with today's control report in tests/kfid-form.test.ts.
 * The rule profile (KFID-V1-2026.1) is the one in lib/kfid/model.ts; it reproduces V1's assessment and is not a claim
 * of standards certification.
 */
import { KFID_FORM_ID } from "./builtin-originals";
export { KFID_FORM_ID };
export const KFID_RULE_CODE = "KFID-V1-2026.1";

const field = (key: string, label: string, input: string, extra: Record<string, unknown> = {}) => ({ id: `kfid-f-${key}`, type: "field", key, label, input, width: "third", ...extra });
const column = (key: string, label: string, input: string, extra: Record<string, unknown> = {}) => ({ id: `kfid-c-${key}`, key, label, input, ...extra });
const godkand = (formula: string, pdfWidth: number) => column("ok", "Godkänd", "assessment", { mode: "switch", switchKey: "auto", formula, pdfWidth, help: "Autobedömning på: bedöms av regeln. Av: bocka i själv." });
const bild = column("bild", "Bild", "images", { pdf: "hide", help: "Bild på kontrollraden. Den kommer som bilaga efter protokollet." });
const sectionImages = (key: string) => ({ id: `kfid-i-${key}`, type: "images", key: `${key}_bilder`, label: "Bilder", accept: "files", pdfInline: false, help: "Sektionsbild eller dokument. Kommer som bilaga efter protokollet." });
const moment = (key: string, title: string, description: string, help: string, blocks: unknown[]) => ({ id: `kfid-${key}`, type: "section", title, description, help, optional: true, defaultOn: false, blocks });
const measurement = (key: string, label: string, columns: unknown[], extra: Record<string, unknown> = {}) => ({ id: `kfid-t-${key}`, type: "table", key, label, rowMode: "free", layout: "rows", required: true, allowExample: true, copyRows: false, startEmpty: true, emptyTitle: "Inga mätningar ännu. Lägg till din första rad.", columns, ...extra });
// The RCD test's note under each row: the profile's time limits, computed from the chosen profile.
const RCD_NOTE = "SAMMANFOGA(\"Profil \"; [std]; \": 1× ≤ \"; VÄXLA([std]; \"EN\"; 300; \"TNIT\"; 400; \"TT\"; 200); \" ms, 5× ≤ 40 ms. Autobedömningen använder tider och testknapp; granska övriga provvärden separat.\")";

export const kfidFormDocument: FormDocument = formDocumentSchema.parse({
  schema: 2,
  report: { title: "Kontrollprotokoll", code: KFID_RULE_CODE, taskFacts: false },
  moments: { label: "Kontrollmoment", requireOne: true, placement: "firstSection" },
  // The header exactly like the control's (Daniel 2026-09-28): "Ny kontroll", the tagline, and Utfört av from the user.
  task: { layout: "inline", titleKey: "proj", requiredMarks: false, newTitle: "Ny kontroll", tagline: "Från första mätningen till ett samlat protokoll." },
  blocks: [
    { id: "kfid-grund", type: "section", title: "Grunduppgifter", description: "Projekt, kontaktperson och mätinstrument.", pdfStyle: "untitled", blocks: [
      field("proj", "Projekt / anläggning", "text", { required: true, highlight: true, prefill: "facility" }),
      field("perf", "Utfört av", "text", { required: true, prefill: "user" }),
      field("date", "Datum", "date", { required: true, prefill: "today" }),
      field("client", "Kontaktperson", "text", { prefill: "contact" }),
      field("addr", "E-post", "text", { prefill: "email" }),
      field("ctrl", "Kontrollerat av", "text"),
      field("instr", "Instrument (typ)", "text"),
      field("sn", "Instrument S/N", "text"),
      field("cal", "Kalibrering", "date", { pdfLabel: "Kalibrering (datum)" }),
      field("auto", "Autobedömning", "yesno", { momentSwitch: true, defaultValue: "NO", allowNotApplicable: false, visibility: { task: true, pdf: false },
        help: "Sätter Godkänd automatiskt i varje kontrollrad utifrån gränsvärdena." }),
    ] },
    moment("iso", "Isolation", "Isolationsresistans mellan ledare.", "Mätning av isolationsresistans mellan fasledare och skyddsledare (PE) för att påvisa intakt isolering och frånvaro av skador, fukt eller föroreningar.", [
      measurement("iso", "Isolation", [
        column("objekt", "Krets / objekt", "text", { required: true, pdfWidth: 118, exampleValue: "Krets 1", screenWidth: "2.3fr" }),
        column("u", "Testspänning", "choice", { required: true, options: ["250 V", "500 V", "1000 V"], defaultValue: "500 V", pdfWidth: 72, exampleValue: "500 V", screenWidth: "1.05fr" }),
        column("mohm", "Uppmätt (MΩ)", "number", { required: true, pdfLabel: "Uppmätt Riso (MΩ)", pdfWidth: 82, exampleValue: 5, screenWidth: "1fr" }),
        column("limit", "Gräns (MΩ)", "number", { required: true, defaultValue: 1, pdfLabel: "Min. gräns (MΩ)", pdfWidth: 74, exampleValue: 1, screenWidth: "1fr" }),
        column("comment", "Kommentar", "textarea", { pdfWidth: 115, screenWidth: "2.4fr" }),
        godkand("[mohm] >= [limit]", 54),
        bild,
      ]),
      sectionImages("iso"),
    ]),
    moment("cont", "Kontinuitet", "Resistans i skyddsledare och förbindningar.", "Mätning av skyddsledarkontinuitet (PE) för att säkerställa obruten förbindelse med låg resistans mellan PE-skena och utsatta delar.", [
      measurement("cont", "Kontinuitet", [
        column("name", "Ledare / sträcka", "text", { required: true, pdfWidth: 135, exampleValue: "PE central–Uttag", screenWidth: "2.3fr" }),
        column("ohm", "Uppmätt (Ω)", "number", { required: true, pdfLabel: "Uppmätt R low (Ω)", pdfWidth: 87, exampleValue: 0.12, screenWidth: "1.3fr" }),
        column("limit", "Gräns (Ω)", "number", { required: true, defaultValue: 0.5, pdfWidth: 75, exampleValue: 0.5, screenWidth: "1.3fr" }),
        column("comment", "Kommentar", "textarea", { pdfWidth: 164, screenWidth: "3fr" }),
        godkand("[ohm] <= [limit]", 54),
        bild,
      ]),
      sectionImages("cont"),
    ]),
    moment("volt", "Spänningsprovning", "Matningsspänning och rotationsriktning.", "Verifiering av matningsspänning (230/400 Vac) samt eventuell rotationsriktning (höger/vänster) efter avslutade prov.", [
      measurement("volt", "Spänningsprovning", [
        column("name", "Mätpunkt", "text", { required: true, pdfWidth: 130, exampleValue: "Huvudmatning", screenWidth: "2.3fr" }),
        column("status", "Spänning", "choice", { required: true, options: ["Ej mätt", "230 Vac", "400 Vac", "Saknas", "Avvikande"], defaultValue: "Ej mätt", notFilledOptions: ["Ej mätt"], pdfLabel: "Uppmätt spänning", pdfWidth: 100, exampleValue: "400 Vac", screenWidth: "1.3fr" }),
        column("rotation", "Rotation", "choice", { options: ["Ej mätt", "Höger", "Vänster"], defaultValue: "Ej mätt", pdfLabel: "Rotationsriktning", pdfWidth: 95, exampleValue: "Höger", screenWidth: "1.3fr" }),
        column("comment", "Kommentar", "textarea", { pdfWidth: 136, screenWidth: "3fr" }),
        godkand("ELLER([status] = \"230 Vac\"; [status] = \"400 Vac\")", 54),
        bild,
      ]),
      sectionImages("volt"),
    ]),
    moment("rcd", "Jordfelsbrytarprov", "Utlösningstider, ström och testknapp.", "Provning av att jordfelsbrytaren löser ut korrekt vid simulerad felström och inom tillåten tid.", [
      // Cards in the PDF (like today's report); on screen the control's two lines: profile, type and currents above,
      // placement, times, Uc and the tick boxes below, with the profile's limits as a note.
      measurement("rcd", "Jordfelsbrytarprov", [
        column("place", "Placering / ID", "text", { required: true, exampleValue: "JFB1", line: 2, screenWidth: "minmax(10rem,20%)" }),
        column("std", "Bedömningsprofil", "choice", { required: true, options: ["EN", "TNIT", "TT"], defaultValue: "EN", exampleValue: "TNIT", screenWidth: "minmax(10rem,20%)" }),
        column("type", "Typ", "choice", { required: true, options: ["A", "AC", "B", "F"], defaultValue: "A", exampleValue: "A" }),
        column("uclim", "Uc gräns", "choice", { unit: "V", options: ["25", "50"], defaultValue: "50", pdf: "hide", exampleValue: "50" }),
        column("idn", "Märkström", "number", { required: true, unit: "mA", defaultValue: 30, exampleValue: 30 }),
        column("idp", "Utlösn. ström +", "number", { unit: "mA", pdfLabel: "Utlösn.ström +", exampleValue: 27 }),
        column("idn_measured", "Utlösn. ström −", "number", { unit: "mA", pdfLabel: "Utlösn.ström −", exampleValue: 28 }),
        column("t1p", "t 1× +", "number", { unit: "ms", requiredIf: "auto", required: true, pdfLabel: "t 1× + / −", exampleValue: 195, line: 2 }),
        column("t1n", "t 1× −", "number", { unit: "ms", requiredIf: "auto", required: true, pdf: "join", exampleValue: 205, line: 2 }),
        column("t5p", "t 5× +", "number", { unit: "ms", requiredIf: "auto", required: true, pdfLabel: "t 5× + / −", exampleValue: 28, line: 2 }),
        column("t5n", "t 5× −", "number", { unit: "ms", requiredIf: "auto", required: true, pdf: "join", exampleValue: 30, line: 2 }),
        column("uc", "Uc uppmätt", "number", { unit: "V", pdfLabel: "Uc uppmätt", exampleValue: 21, line: 2 }),
        column("ntrip05", "0,5× IΔn ej utlöst", "check", { pdfLabel: "0,5× IΔn", exampleValue: true, line: 2, screenWidth: "4.5rem" }),
        column("btnok", "Testknapp OK", "check", { pdfLabel: "Testknapp", exampleValue: true, line: 2, screenWidth: "4.5rem" }),
        column("comment", "Kommentar", "textarea", { screenWidth: "minmax(8rem,2.4fr)" }),
        column("note", "Profilens gränser", "formula", { formula: RCD_NOTE, placement: "note", pdf: "hide" }),
        godkand("OCH([btnok]; [t1p] <= VÄXLA([std]; \"EN\"; 300; \"TNIT\"; 400; \"TT\"; 200); [t1n] <= VÄXLA([std]; \"EN\"; 300; \"TNIT\"; 400; \"TT\"; 200); [t5p] <= 40; [t5n] <= 40)", 45),
        bild,
      ], { layout: "cards", taskLayout: "rows", itemLabel: "Prov", cardTitle: "{place} · {std} · typ {type} · {idn} mA", emptyTitle: "Inga mätningar ännu. Lägg till din första rad." }),
      sectionImages("rcd"),
    ]),
    // 2026-09-28 (docs/kallor/kontroll-fore-idrifttagning.md): automatic disconnection, a central part of verification
    // (SS 436 40 00 part 6 / IEC 60364-6). The highest permitted Zs depends on the device and the network, so it is
    // entered per row from the applicable table or the manufacturer – never a fixed value.
    moment("zs", "Automatisk frånkoppling", "Impedans i felslinga mot skyddsanordningen.", "Mätning av felslingeimpedans (Zs) eller kortslutningsström och kontroll att skyddsanordningen löser ut inom föreskriven tid. Högsta tillåtna Zs hämtas från tillämplig tabell eller tillverkarens data för skyddets typ, karakteristik och märkström.", [
      measurement("zs", "Automatisk frånkoppling", [
        column("krets", "Krets / grupp", "text", { required: true, exampleValue: "Grupp 3", screenWidth: "2.3fr" }),
        column("skydd", "Skyddsanordning", "choice", { required: true, options: ["Säkring gG", "Dvärgbrytare B", "Dvärgbrytare C", "Dvärgbrytare D", "Effektbrytare", "Annan"], exampleValue: "Dvärgbrytare B", screenWidth: "1.4fr" }),
        column("in", "Märkström", "number", { required: true, unit: "A", exampleValue: 16, screenWidth: "1fr" }),
        column("zs", "Uppmätt Zs", "number", { required: true, unit: "Ω", exampleValue: 0.62, screenWidth: "1fr" }),
        column("zsmax", "Högsta tillåtna Zs", "number", { required: true, unit: "Ω", exampleValue: 2.73, help: "Från tillämplig tabell eller tillverkarens data.", screenWidth: "1fr" }),
        column("ik", "Ik", "number", { unit: "A", screenWidth: "1fr" }),
        column("comment", "Kommentar", "textarea", { screenWidth: "2fr" }),
        godkand("[zs] <= [zsmax]", 54),
        bild,
      ]),
      sectionImages("zs"),
    ]),
    { id: "kfid-vis", type: "section", title: "Visuell kontroll", description: "", help: "Inspektion av installationens utförande: märkning, förskruvningar, infästning och miljö.", optional: true, defaultOn: false, blocks: [
      { id: "kfid-l-vis", type: "checklist", key: "vis", label: "Visuell kontroll", mode: "check", required: true, help: "Bekräfta de kontrollpunkter som har granskats.", items: [
        { id: "markning", text: "Märkning och skyltning utförd" },
        { id: "dok", text: "Dokumentation lämnad (schema / ritning)" },
        { id: "mek", text: "Mekaniskt skydd och infästning OK" },
        { id: "ip", text: "IP-klass och omgivning lämplig" },
        // Version 4 (Daniel 2026-09-29): the points of the former moments "Före spänningssättning" and "Polaritet och
        // funktionsprov" that no other moment covers (PE is the continuity test, phase sequence the voltage test's
        // rotation, the RCD's function the RCD test) belong to the visual inspection.
        { id: "beroring", text: "Beröringsskydd, kapslingar och lock på plats" },
        { id: "funktion", text: "Polaritet och funktion hos manöverdon kontrollerad" },
      ] },
      sectionImages("vis"),
    ] },
    { id: "kfid-summary", type: "section", title: "Sammanfattning / avvikelser", taskTitle: "Sammanfattning", blocks: [
      { id: "kfid-s-summary", type: "summary", label: "Sammanfattning / avvikelser", help: "Granska resultat och skriv avvikelser, åtgärder eller hänvisningar." },
    ] },
    // Only in the PDF, like today's control: the task shows no Stöd vid bedömning.
    { id: "kfid-support", type: "section", title: "Stöd vid bedömning", pdfStyle: "chapter",
      description: `KFID:s konfigurerade regelprofil ${KFID_RULE_CODE}. Kontrollera alltid mot gällande standard, projekteringsunderlag, nätform och tillverkarens anvisningar.`, blocks: [
        { id: "kfid-n-iso", type: "note", title: "Isolation", text: "Valbara testspänningar i KFID: 250 V, 500 V och 1000 V.\nGodkänd när uppmätt Riso är lika med eller högre än det gränsvärde som registrerats på kontrollraden.", visibility: { task: false, pdf: true } },
        { id: "kfid-n-cont", type: "note", title: "Kontinuitet", text: "Godkänd när uppmätt resistans är lika med eller lägre än det registrerade gränsvärdet.\nBedöm valt gränsvärde utifrån ledarlängd, area och aktuella förutsättningar.", visibility: { task: false, pdf: true } },
        { id: "kfid-n-volt", type: "note", title: "Spänningsprovning", text: "KFID:s autobedömning godkänner registrerad 230 Vac eller 400 Vac.\nRotationsriktning registreras separat och ska bedömas för den aktuella installationen.", visibility: { task: false, pdf: true } },
        { id: "kfid-n-rcd", type: "note", title: "Jordfelsbrytarprov", text: "1× IΔn: EN högst 300 ms, TNIT högst 400 ms, TT högst 200 ms.\n5× IΔn: högst 40 ms. Testknappen ska vara bekräftad.\nÖvriga registrerade provvärden ska granskas mot vald utrustning och aktuella krav.", visibility: { task: false, pdf: true } },
      ] },
  ],
});

export const kfidForm: BuiltinForm = {
  id: KFID_FORM_ID, document: kfidFormDocument, meta: formMetaSchema.parse({
    name: "Kontroll före idrifttagning", icon: "clipboard-check", color: "blue", category: "ELECTRICAL",
    description: "Isolation, kontinuitet, spänningsprovning, jordfelsbrytarprov och visuell kontroll med automatisk bedömning.",
  }),
};
