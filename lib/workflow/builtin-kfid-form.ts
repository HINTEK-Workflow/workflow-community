import { formDocumentSchema, LIMIT_REFERENCE, type FormDocument } from "./form-document";
import { RCD_LIMIT_KEYS } from "./limit-suggestions";
import { formMetaSchema } from "./form-publish";
import type { BuiltinForm } from "./builtin-forms";
import { KFID_EMPTY_TITLES, KFID_MOMENT_HELP, LIMIT_HELP } from "../kfid/guidance";

/**
 * Kontroll före idrifttagning as a form (2026-09-27, decision B): Workflow's original, built only from the form
 * builder's building blocks – moments that can be switched on and off, measurement rows with Godkänd decided by a
 * condition while Autobedömning is on, the RCD tests as cards in the PDF and two-line rows on screen, Visuell kontroll
 * as tick boxes, Sammanfattning and the Stöd vid bedömning chapter. In the task it looks exactly like today's control
 * (2026-09-27): the task's project, customer and place inside Grunduppgifter with the moments below them, the
 * measurement panels with the round add and picture buttons, and the summary with its pills and completion card.
 * Its PDF is drawn by the shared form report and is locked by the references in tests/report-reference.test.ts
 * (since 2026-10-06 the only control; the older control editor is gone). The rule code (KFID-V1-2026.1) names the
 * assessment it reproduces from V1 and is not a claim of standards certification.
 *
 * Standards-neutral (2026-10-06): the form carries no limit values. It declares its limits by key – the lowest
 * insulation resistance, the highest continuity resistance and Zs, the RCD trip times per standard (referred to by
 * designation) and the two Uc choices – and the company enters the values under Inställningar → Värden och referenser.
 * The rows' Gräns columns are filled in from them and can be changed per row; the RCD condition reads them by name
 * (`gräns.…`). Without a value a row is "Ej bedömd – ange gräns". Workflow's former numbers are only suggestions
 * (lib/workflow/limit-suggestions.ts).
 */
import { KFID_FORM_ID } from "./builtin-originals";
export { KFID_FORM_ID };
// The customer never sees the internal abbreviation KFID (kundresa 2026-11-07, M16): the code under the heading is the
// form's rule profile and its version.
export const KFID_RULE_CODE = "Regelprofil V1-2026.1";

const field = (key: string, label: string, input: string, extra: Record<string, unknown> = {}) => ({ id: `kfid-f-${key}`, type: "field", key, label, input, width: "third", ...extra });
const column = (key: string, label: string, input: string, extra: Record<string, unknown> = {}) => ({ id: `kfid-c-${key}`, key, label, input, ...extra });
const godkand = (formula: string, pdfWidth: number) => column("ok", "Godkänd", "assessment", { mode: "auto", formula, pdfWidth, help: "Bedöms av regeln mot gränsvärdet. Ett värde som inte når upp förblir underkänt, men kontrollen är ändå utförd och kan färdigställas med en kommentar." });
const bild = column("bild", "Bild", "images", { pdf: "hide", help: "Bild på kontrollraden. Den kommer som bilaga efter protokollet." });
const sectionImages = (key: string) => ({ id: `kfid-i-${key}`, type: "images", key: `${key}_bilder`, label: "Bilder", accept: "files", pdfInline: false, help: "Sektionsbild eller dokument. Kommer som bilaga efter protokollet." });
const moment = (key: string, title: string, description: string, help: string, blocks: unknown[]) => ({ id: `kfid-${key}`, type: "section", title, description, help, optional: true, defaultOn: false, blocks });
const measurement = (key: keyof typeof KFID_EMPTY_TITLES, label: string, columns: unknown[], extra: Record<string, unknown> = {}) => ({ id: `kfid-t-${key}`, type: "table", key, label, rowMode: "free", layout: "rows", required: true, allowExample: true, copyRows: false, startEmpty: true, emptyTitle: KFID_EMPTY_TITLES[key], columns, ...extra });
// The standards as the installation tester names them (2026-10-02, named as in V1), referred to by designation.
// Since 2026-10-10 the row offers only EN 61008 / EN 61009 – the 1× time that applies in Sweden. TN/IT and TT
// stay in the condition and among the limits, so older protocols (and copies or imports) that hold them are judged and
// shown exactly as before; Värden och referenser hides their rows unless the company has a value (RETIRED_LIMIT_KEYS).
const RCD_EN = "EN 61008 / EN 61009";
const RCD_TNIT = "IEC 60364-4-41 TN/IT";
const RCD_TT = "IEC 60364-4-41 TT";
// The company's values by name (2026-10-06): the 1× time for the standard chosen on the row (older protocols and
// imports may hold "EN"/"TNIT"/"TT"), the 5× time and the touch-voltage limit chosen on the row ("25"/"50" in older ones).
const limit = (key: string) => `${LIMIT_REFERENCE}${key}`;
const T1 = RCD_LIMIT_KEYS.t1;
const RCD_T1 = `VÄXLA([std]; "${RCD_EN}"; ${limit(T1.EN)}; "${RCD_TNIT}"; ${limit(T1.TNIT)}; "${RCD_TT}"; ${limit(T1.TT)}; "EN"; ${limit(T1.EN)}; "TNIT"; ${limit(T1.TNIT)}; "TT"; ${limit(T1.TT)})`;
const RCD_T5 = limit(RCD_LIMIT_KEYS.t5);
const RCD_UC = `VÄXLA([uclim]; "≤ 25"; ${limit(RCD_LIMIT_KEYS.uc25)}; "≤ 50"; ${limit(RCD_LIMIT_KEYS.uc50)}; "25"; ${limit(RCD_LIMIT_KEYS.uc25)}; "50"; ${limit(RCD_LIMIT_KEYS.uc50)})`;
// The tester cannot run 5× IΔn at 300 mA and more for types A, F and B, nor at 1000 mA (2026-10-05 review): 5× is
// then left empty and not judged. A 5× time that was measured is always judged.
const RCD_NO_5X = `OCH(INTE(ÄRTOM([idn])); ELLER([idn] >= 1000; OCH([idn] >= 300; INTE(ÄRTOM([type])); [type] <> "AC")))`;
const RCD_5X_OK = `ELLER(OCH(ANTAL([t5p]; [t5n]) = 2; MAX([t5p]; [t5n]) <= ${RCD_T5}); OCH(ANTAL([t5p]; [t5n]) = 0; ${RCD_NO_5X}))`;
// As in V1 (2026-10-05): the chosen standard's limits beside the Standard label, and the Uc column's label
// following the chosen limit ("Uc ≤ 25 Vac"), both computed on the row so they change with the choice. Without the
// company's value the hint says so.
const RCD_LIMITS_HINT = `OM(ÄRTOM([std]); ""; OM(ÄRTOM(${RCD_T1}); "gräns saknas"; SAMMANFOGA("1× ≤ "; ${RCD_T1}; OM(${RCD_NO_5X}; " ms, 5× provas inte"; OM(ÄRTOM(${RCD_T5}); " ms"; SAMMANFOGA(" ms, 5× ≤ "; ${RCD_T5}; " ms"))))))`;
const RCD_UC_LABEL = `OM(ÄRTOM(${RCD_UC}); ""; SAMMANFOGA("Uc ≤ "; ${RCD_UC}; " Vac"))`;
// The limits the form declares, without values: the company enters them under Värden och referenser. A key is shared
// with every form that measures the same quantity (the lowest insulation resistance also in Isolationsmätning).
const KFID_LIMITS = [
  { key: "isolation_min", label: "Isolationsresistans, lägsta", unit: "MΩ", help: "Fylls i som Gräns på nya isolationsrader." },
  { key: "continuity_max", label: "Kontinuitet, högsta resistans", unit: "Ω", help: "Fylls i som Gräns på nya kontinuitetsrader." },
  { key: "zs_max", label: "Högsta tillåtna Zs", unit: "Ω", help: "Förval på nya rader; ändras på raden efter skyddets typ och märkström." },
  { key: T1.EN, label: `Jordfelsbrytare 1× IΔn, ${RCD_EN}`, unit: "ms", help: "Högsta utlösningstid." },
  { key: T1.TNIT, label: `Jordfelsbrytare 1× IΔn, ${RCD_TNIT}`, unit: "ms", help: "Högsta utlösningstid. Gäller bara äldre protokoll där det valet gjordes." },
  { key: T1.TT, label: `Jordfelsbrytare 1× IΔn, ${RCD_TT}`, unit: "ms", help: "Högsta utlösningstid. Gäller bara äldre protokoll där det valet gjordes." },
  { key: RCD_LIMIT_KEYS.t5, label: "Jordfelsbrytare 5× IΔn", unit: "ms", help: "Högsta utlösningstid." },
  { key: RCD_LIMIT_KEYS.uc25, label: "Uc-gräns vid valet ≤ 25", unit: "Vac", help: "Högsta beröringsspänning." },
  { key: RCD_LIMIT_KEYS.uc50, label: "Uc-gräns vid valet ≤ 50", unit: "Vac", help: "Högsta beröringsspänning." },
];

export const kfidFormDocument: FormDocument = formDocumentSchema.parse({
  schema: 2,
  report: { title: "Kontrollprotokoll", code: KFID_RULE_CODE, taskFacts: false },
  moments: { label: "Kontrollmoment", requireOne: true, placement: "firstSection" },
  // The header exactly like the control's (2026-09-28): "Ny kontroll", the tagline, and Utfört av from the user.
  task: { layout: "inline", titleKey: "proj", requiredMarks: false, newTitle: "Ny kontroll", tagline: "Från första mätningen till ett samlat protokoll." },
  limits: KFID_LIMITS,
  blocks: [
    { id: "kfid-grund", type: "section", title: "Grunduppgifter", description: "Projekt, kontaktperson och mätinstrument.", pdfStyle: "untitled", blocks: [
      // 2026-10-19: the Stöd vid bedömning chapter of the report is a choice, on from the start; a protocol that never answered it keeps the chapter,
      // and the answer itself is not printed (the reference report is unchanged).
      field("support", "Ta med stöd vid bedömning", "yesno", { defaultValue: "YES", visibility: { task: true, pdf: false }, help: "Kapitlet Stöd vid bedömning följer med i rapporten. Välj Nej för att utelämna det." }),
      field("proj", "Projekt / anläggning", "text", { required: true, highlight: true, prefill: "facility" }),
      field("perf", "Utfört av", "text", { required: true, prefill: "user" }),
      field("date", "Datum", "date", { required: true, prefill: "today" }),
      field("client", "Kontaktperson", "text", { prefill: "contact" }),
      field("addr", "E-post", "text", { prefill: "email" }),
      // Egenkontroll (etapp 2–3, 2026-10-06): Kontrollerat av starts from the assignment's inspecting role, and the
      // instrument can be chosen from the company's register. Same fields, same look and report.
      field("ctrl", "Kontrollerat av", "text", { prefill: "inspector" }),
      field("instr", "Instrument (typ)", "text", { prefill: "instrument" }),
      field("sn", "Instrument S/N", "text", { prefill: "instrumentSerial" }),
      field("cal", "Kalibrering", "date", { pdfLabel: "Kalibrering (datum)", prefill: "instrumentCalibration" }),
    ] },
    // The guidance per moment (KFID_MOMENT_HELP) and the column help: Workflow's own wording (2026-10-05/06).
    moment("iso", "Isolation", "Isolationsresistans mellan ledare.", KFID_MOMENT_HELP.iso, [
      measurement("iso", "Isolation", [
        column("objekt", "Krets / objekt", "text", { required: true, pdfWidth: 118, exampleValue: "Krets 1", screenWidth: "2.3fr", help: "Gruppen och mellan vilka ledare, t.ex. Grupp 1 L–PE." }),
        column("u", "Testspänning", "choice", { required: true, options: ["250 V", "500 V", "1000 V"], defaultValue: "500 V", pdfWidth: 72, exampleValue: "500 V", screenWidth: "1.05fr", help: "Samma provspänning som i instrumentet." }),
        column("mohm", "Uppmätt (MΩ)", "number", { required: true, pdfLabel: "Uppmätt Riso (MΩ)", pdfWidth: 82, exampleValue: 5, screenWidth: "1fr", help: "Visar instrumentet ”>” (över mätområdet), skriv talet efter tecknet." }),
        // The company's value on a new row (2026-10-06), changeable per row; a row without a limit is not judged.
        column("limit", "Gräns (MΩ)", "number", { required: true, pdfLabel: "Min. gräns (MΩ)", pdfWidth: 74, screenWidth: "1fr", limitDefault: "isolation_min", help: `Lägsta godtagbara värde. ${LIMIT_HELP}` }),
        column("comment", "Kommentar", "textarea", { pdfWidth: 115, screenWidth: "2.4fr" }),
        godkand("[mohm] >= [limit]", 54),
        bild,
      ]),
      sectionImages("iso"),
    ]),
    moment("cont", "Kontinuitet", "Resistans i skyddsledare och förbindningar.", KFID_MOMENT_HELP.cont, [
      measurement("cont", "Kontinuitet", [
        column("name", "Ledare / sträcka", "text", { required: true, pdfWidth: 135, exampleValue: "PE central–Uttag", screenWidth: "2.3fr" }),
        column("ohm", "Uppmätt (Ω)", "number", { required: true, pdfLabel: "Uppmätt R low (Ω)", pdfWidth: 87, exampleValue: 0.12, screenWidth: "1.3fr", help: "Lågohmsmätning med nollställda mätsladdar, i båda riktningarna." }),
        column("limit", "Gräns (Ω)", "number", { required: true, pdfWidth: 75, screenWidth: "1.3fr", limitDefault: "continuity_max", help: `Högsta godtagbara värde. ${LIMIT_HELP}` }),
        column("comment", "Kommentar", "textarea", { pdfWidth: 164, screenWidth: "3fr" }),
        godkand("[ohm] <= [limit]", 54),
        bild,
      ]),
      sectionImages("cont"),
    ]),
    moment("volt", "Spänningsprovning", "Matningsspänning och rotationsriktning.", KFID_MOMENT_HELP.volt, [
      measurement("volt", "Spänningsprovning", [
        column("name", "Mätpunkt", "text", { required: true, pdfWidth: 130, exampleValue: "Huvudmatning", screenWidth: "2.3fr" }),
        column("status", "Spänning", "choice", { required: true, options: ["Ej mätt", "230 Vac", "400 Vac", "Saknas", "Avvikande"], defaultValue: "Ej mätt", notFilledOptions: ["Ej mätt"], pdfLabel: "Uppmätt spänning", pdfWidth: 100, exampleValue: "400 Vac", screenWidth: "1.3fr", help: "Välj Avvikande om värdet ligger utanför den tolerans som gäller för anläggningen." }),
        column("rotation", "Rotation", "choice", { options: ["Ej mätt", "Höger", "Vänster"], defaultValue: "Ej mätt", pdfLabel: "Rotationsriktning", pdfWidth: 95, exampleValue: "Höger", screenWidth: "1.3fr", help: "Vid trefas: Höger (1-2-3) är rätt fasföljd, Vänster ger Ej godkänd. Ej mätt vid enfas." }),
        column("comment", "Kommentar", "textarea", { pdfWidth: 136, screenWidth: "3fr" }),
        // Review 2026-10-05: the tester reports a left-hand (3-2-1) phase sequence as a wrong connection.
        // 2026-10-06: at 400 Vac the rotation must be judged first – "Ej mätt" there is "Ej bedömd – ange rotation"
        // (a warning, never Godkänd); the older editor warns about the same row.
        godkand("OM(OCH([status] = \"400 Vac\"; ELLER(ÄRTOM([rotation]); [rotation] = \"Ej mätt\")); \"Ej bedömd – ange rotation\"; OCH(ELLER([status] = \"230 Vac\"; [status] = \"400 Vac\"); ELLER(ÄRTOM([rotation]); [rotation] <> \"Vänster\")))", 54),
        bild,
      ]),
      sectionImages("volt"),
    ]),
    moment("rcd", "Jordfelsbrytarprov", "Utlösningstider, ström och testknapp.", KFID_MOMENT_HELP.rcd, [
      // Cards in the PDF (like today's report); on screen the control's two lines: profile, type and currents above,
      // placement, times, Uc and the tick boxes below, with the profile's limits as a note.
      measurement("rcd", "Jordfelsbrytarprov", [
        // Wide enough for "IEC 60364-4-41 TN/IT" to be read in full (2026-10-05); Placering/ID keeps the same width below.
        column("place", "Placering/ID", "text", { required: true, exampleValue: "JFB1", line: 2, screenWidth: "minmax(13rem,22%)" }),
        column("std", "Standard", "choice", { required: true, options: [RCD_EN], defaultValue: RCD_EN, exampleValue: RCD_EN, help: "Standarden för jordfelsbrytarens utlösningstid. Gränserna hämtas från Inställningar → Värden och referenser och visas här. Äldre protokoll med TN/IT eller TT bedöms som förut.", screenWidth: "minmax(13rem,22%)" }),
        column("type", "Typ", "choice", { required: true, options: ["A", "AC", "B", "F"], defaultValue: "A", exampleValue: "A" }),
        column("uclim", "Uc-gräns", "choice", { required: true, unit: "Vac", options: ["≤ 25", "≤ 50"], defaultValue: "≤ 50", pdf: "hide", exampleValue: "≤ 50" }),
        column("idn", "Märkutlösn. ström IΔn", "choice", { required: true, unit: "mA", options: ["10", "30", "100", "300", "500"], defaultValue: "30", exampleValue: "30" }),
        column("idp", "Utlösn. ström Id (+)", "number", { unit: "mA", placeholder: "mätt", pdfLabel: "Id (+)", exampleValue: 27, help: "Strömmen då brytaren löste ut vid rampprovet. Registreras, bedöms inte automatiskt." }),
        column("idn_measured", "Utlösn. ström Id (−)", "number", { unit: "mA", placeholder: "mätt", pdfLabel: "Id (−)", exampleValue: 28, help: "Strömmen då brytaren löste ut vid rampprovet. Registreras, bedöms inte automatiskt." }),
        column("t1p", "t 1× (+)", "number", { unit: "ms", required: true, placeholder: "mätt", pdfLabel: "t 1× (+) / (−)", exampleValue: 195, line: 2 }),
        column("t1n", "t 1× (−)", "number", { unit: "ms", required: true, placeholder: "mätt", pdf: "join", exampleValue: 205, line: 2 }),
        // Not required (review, 2026-10-05): the tester cannot run 5× at 300 mA and more for types A, F and B;
        // Godkänd still needs both 5× times whenever 5× can be run.
        column("t5p", "t 5× (+)", "number", { unit: "ms", placeholder: "mätt", pdfLabel: "t 5× (+) / (−)", exampleValue: 28, line: 2, help: "Lämna tomt när 5× inte kan provas (300 mA och mer för typ A, F och B)." }),
        column("t5n", "t 5× (−)", "number", { unit: "ms", placeholder: "mätt", pdf: "join", exampleValue: 30, line: 2, help: "Lämna tomt när 5× inte kan provas (300 mA och mer för typ A, F och B)." }),
        column("uc", "Uc uppmätt", "number", { unit: "Vac", placeholder: "mätt", pdfLabel: "Uc uppmätt", exampleValue: 21, line: 2, help: "Beröringsspänningen vid IΔn, som instrumentet mäter först. Över vald gräns ger Ej godkänd." }),
        column("ntrip05", "0,5× IΔn ej utlöst", "check", { pdfLabel: "0,5× IΔn", exampleValue: true, line: 2, screenWidth: "4.5rem" }),
        column("btnok", "Testknapp OK", "check", { pdfLabel: "Testknapp", exampleValue: true, line: 2, screenWidth: "4.5rem" }),
        column("comment", "Kommentar", "textarea", { screenWidth: "minmax(8rem,2.4fr)" }),
        column("std_limits", "Gränser för standarden", "formula", { formula: RCD_LIMITS_HINT, placement: "hint", labelFor: "std", pdf: "hide" }),
        column("uclim_label", "Uc-gräns som etikett", "formula", { formula: RCD_UC_LABEL, placement: "label", labelFor: "uclim", pdf: "hide" }),
        // As in V1 (2026-10-05): both tick boxes confirmed by hand ("0,5× IΔn ej utlöst" and "Testknapp OK"), the
        // times within the standard's limits, and a measured Uc within the chosen limit (an Uc not measured is not judged).
        // No requirement text under the row: the limits stand beside "Standard" and follow the choice.
        // Review (2026-10-05): both 1× times measured, both 5× times within 40 ms unless 5× cannot be run.
        godkand(`OCH([ntrip05]; [btnok]; ANTAL([t1p]; [t1n]) = 2; MAX([t1p]; [t1n]) <= ${RCD_T1}; ${RCD_5X_OK}; ELLER(ÄRTOM([uc]); [uc] <= ${RCD_UC}))`, 45),
        bild,
      ], { layout: "cards", taskLayout: "rows", itemLabel: "Prov", cardTitle: "{place} · {std} · typ {type} · {idn} mA" }),
      sectionImages("rcd"),
    ]),
    // 2026-09-28: automatic disconnection, a central part of verification. The highest permitted Zs depends on the device
    // and the network, so it is entered per row from the instrument or the company's limit profile – never a fixed value.
    moment("zs", "Automatisk frånkoppling", "Impedans i felslinga mot skyddsanordningen.", KFID_MOMENT_HELP.zs, [
      measurement("zs", "Automatisk frånkoppling", [
        column("krets", "Krets / grupp", "text", { required: true, exampleValue: "Grupp 3", screenWidth: "2.3fr" }),
        // Dvärgbrytare K added after the review (2026-10-05): the tester offers gG, B, C, D and K.
        column("skydd", "Skyddsanordning", "choice", { required: true, options: ["Säkring gG", "Dvärgbrytare B", "Dvärgbrytare C", "Dvärgbrytare D", "Dvärgbrytare K", "Effektbrytare", "Annan"], exampleValue: "Dvärgbrytare B", screenWidth: "1.4fr" }),
        column("in", "Märkström", "number", { required: true, unit: "A", exampleValue: 16, screenWidth: "1fr" }),
        column("zs", "Uppmätt Zs", "number", { required: true, unit: "Ω", exampleValue: 0.62, screenWidth: "1fr", help: "Mätt L–PE i gruppens mest avlägsna punkt." }),
        column("zsmax", "Högsta tillåtna Zs", "number", { required: true, unit: "Ω", limitDefault: "zs_max", help: `För skyddets typ och märkström. ${LIMIT_HELP}`, screenWidth: "1fr" }),
        column("ik", "Ik", "number", { unit: "A", screenWidth: "1fr", help: "Instrumentets beräknade felström. Registreras, bedöms inte automatiskt." }),
        column("comment", "Kommentar", "textarea", { screenWidth: "2fr" }),
        godkand("[zs] <= [zsmax]", 54),
        bild,
      ]),
      sectionImages("zs"),
    ]),
    { id: "kfid-vis", type: "section", title: "Visuell kontroll", description: "", help: KFID_MOMENT_HELP.vis, optional: true, defaultOn: false, blocks: [
      { id: "kfid-l-vis", type: "checklist", key: "vis", label: "Visuell kontroll", mode: "check", required: true, help: "Bekräfta de kontrollpunkter som har granskats.", items: [
        { id: "markning", text: "Märkning och skyltning utförd" },
        { id: "dok", text: "Dokumentation lämnad (schema / ritning)" },
        { id: "mek", text: "Mekaniskt skydd och infästning OK" },
        { id: "ip", text: "IP-klass och omgivning lämplig" },
        // Version 4 (2026-09-29): the points of the former moments "Före spänningssättning" and "Polaritet och
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
    { id: "kfid-support", type: "section", title: "Stöd vid bedömning", pdfStyle: "chapter", showIf: { key: "support", op: "neq", value: "NO" },
      description: `Bedömningen följer formulärets regelprofil (V1-2026.1). Kontrollera alltid mot gällande standard, projekteringsunderlag, nätform och tillverkarens anvisningar.`, blocks: [
        { id: "kfid-n-iso", type: "note", title: "Isolation", text: "Valbara testspänningar: 250 V, 500 V och 1000 V. Gränsvärdet beror på kretsen och mätspänningen.\nGodkänd när uppmätt Riso är lika med eller högre än det gränsvärde som registrerats på kontrollraden.", visibility: { task: false, pdf: true } },
        { id: "kfid-n-cont", type: "note", title: "Kontinuitet", text: "Godkänd när uppmätt resistans är lika med eller lägre än det registrerade gränsvärdet.\nBedöm valt gränsvärde utifrån ledarlängd, area och aktuella förutsättningar.", visibility: { task: false, pdf: true } },
        { id: "kfid-n-volt", type: "note", title: "Spänningsprovning", text: "Autobedömningen godkänner registrerad 230 Vac eller 400 Vac.\nVänstervridande fasföljd ger Ej godkänd. Vid 400 Vac bedöms raden först när rotationen är registrerad.", visibility: { task: false, pdf: true } },
        { id: "kfid-n-rcd", type: "note", title: "Jordfelsbrytarprov", text: "Godkänd när utlösningstiderna vid 1× och 5× IΔn och uppmätt Uc ligger inom gränserna för vald standard och vald Uc-gräns, och när 0,5× IΔn ej utlöst och testknappen är bekräftade.\n5× IΔn provas inte vid 300 mA och mer för typ A, F och B.\nGränserna och deras källa anges av företaget under Inställningar → Värden och referenser.", visibility: { task: false, pdf: true } },
        { id: "kfid-n-zs", type: "note", title: "Automatisk frånkoppling", text: "Godkänd när uppmätt Zs är lika med eller lägre än den högsta tillåtna Zs som registrerats på raden.\nHögsta tillåtna Zs fylls i från företagets värde och anpassas på raden efter skyddets typ och märkström.", visibility: { task: false, pdf: true } },
      ] },
  ],
});

export const kfidForm: BuiltinForm = {
  id: KFID_FORM_ID, document: kfidFormDocument, meta: formMetaSchema.parse({
    name: "Kontroll före idrifttagning", icon: "clipboard-check", color: "blue", category: "ELECTRICAL",
    description: "Isolation, kontinuitet, spänningsprovning, jordfelsbrytarprov och visuell kontroll med automatisk bedömning.",
  }),
};
