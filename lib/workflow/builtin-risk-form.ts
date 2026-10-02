import { formDocumentSchema, type FormDocument } from "./form-document";
import { formMetaSchema } from "./form-publish";
import type { BuiltinForm } from "./builtin-forms";

/**
 * Riskbedömning as a form (2026-09-27, decision B): HINTEK's original, built from the form builder's building
 * blocks – the five-step scales, the risk before and after the protective measure with its level ("15 · Hög"), the
 * 5 × 5 matrix, common measures and approval. In the task it looks exactly like today's risk assessment (
 * 2026-09-27): the scales and the matrix side by side in the folded Bedömningsstöd, the risk cards with Före → Efter
 * in the title row and the two rating groups, and the approval with its statement. The PDF has the control's look.
 */
import { RISK_FORM_ID } from "./builtin-originals";
export { RISK_FORM_ID };

const LIKELIHOOD = ["Mycket osannolik", "Osannolik", "Möjlig", "Sannolik", "Mycket sannolik"];
const CONSEQUENCE = ["Försumbar", "Mindre", "Allvarlig", "Mycket allvarlig", "Katastrofal"];
// The same levels as today: high risk is red, moderate amber and low green (score = likelihood × consequence).
const RISK_LEVELS = [
  { from: 1, label: "Låg", tone: "success" },
  { from: 5, label: "Måttlig", tone: "warning" },
  { from: 10, label: "Hög", tone: "danger" },
  { from: 17, label: "Mycket hög", tone: "critical" },
];

const RISK_CATEGORIES = ["El", "Fall", "Lyft och last", "Ras och fallande föremål", "Trafik och fordon", "Maskin och klämrisk", "Brand och explosion", "Kemiska ämnen", "Ergonomi", "Buller och vibrationer", "Ensamarbete", "Övrigt"];
const MEASURE_TYPES = ["Eliminera vid källan", "Tekniskt skydd", "Instruktion och organisation", "Personlig skyddsutrustning"];
const SAFETY_RULES = [["frankopplat", "Frånkopplat"], ["sakrat", "Säkrat mot återinkoppling"], ["spanningslost", "Spänningslöshet verifierad"], ["jordat", "Jordat och kortslutet"], ["skyddat", "Skyddat mot närliggande spänningsförande delar"]] as const;

const column = (key: string, label: string, input: string, extra: Record<string, unknown> = {}) => ({ id: `risk-c-${key}`, key, label, input, ...extra });
const scale = (key: string, label: string, cardLabel: string, group: string, steps: string[]) => column(key, label, "scale", { required: true, options: steps, defaultValue: 1, cardLabel, group });
const numbered = (steps: string[]) => steps.map((step, index) => `${index + 1} – ${step}`).join("\n");

export const riskFormDocument: FormDocument = formDocumentSchema.parse({
  schema: 2,
  report: { title: "Riskbedömning", code: "", taskFacts: true },
  task: { layout: "panel", titleKey: "", requiredMarks: false, newTitle: "Ny riskbedömning" },
  blocks: [
    { id: "risk-stod", type: "section", title: "Bedömningsstöd", description: "Femgradig skala och riskmatris. Samma skala används före och efter skyddsåtgärderna.", collapsed: true, blocks: [
      { id: "risk-n-sannolikhet", type: "note", title: "Sannolikhet", text: numbered(LIKELIHOOD), style: "card", width: "third", visibility: { task: true, pdf: false } },
      { id: "risk-n-konsekvens", type: "note", title: "Konsekvens", text: numbered(CONSEQUENCE), style: "card", width: "third", visibility: { task: true, pdf: false } },
      { id: "risk-matris", type: "matrix", label: "Riskmatris 5 × 5", size: 5, xLabel: "Sannolikhet", yLabel: "Konsekvens", bands: RISK_LEVELS, width: "third", tall: true },
      { id: "risk-n-sa", type: "note", title: "Så bedöms risken", text: "Multiplicera sannolikhet med konsekvens. Dokumentera sedan en konkret skyddsåtgärd och bedöm den kvarvarande risken på nytt. Mycket hög eller hög kvarvarande risk bör åtgärdas innan arbetet startar.", style: "notice", width: "two_thirds", visibility: { task: true, pdf: false } },
    ] },
    { id: "risk-risker", type: "section", title: "Identifierade risker", description: "Beskriv faran och skyddsåtgärden och bedöm risken före och efter åtgärden.", blocks: [
      { id: "risk-t-risker", type: "table", key: "risker", label: "Identifierade risker", layout: "cards", itemLabel: "Risk", itemLabelPlural: "risker", rowMode: "free", required: true, copyRows: false,
        emptyTitle: "Inga risker identifierade ännu", emptyAction: "Lägg till första risken", startEmpty: true, emptyIcon: "shield-alert",
        help: "Gå igenom arbetsmoment, arbetsplats, verktyg, energi, lyft och omgivning. Lägg till varje betydande fara som en egen risk.", columns: [
          column("fara", "Risk eller fara", "textarea", { required: true, cardWidth: "half", placeholder: "Exempel: fall från stege, spänningssatt del eller tunga lyft" }),
          column("atgard", "Skyddsåtgärd", "textarea", { required: true, cardWidth: "half", placeholder: "Vad ska göras, av vem och före vilket moment" }),
          scale("sannolikhet", "Sannolikhet före", "Sannolikhet", "Före skyddsåtgärd", LIKELIHOOD),
          scale("konsekvens", "Konsekvens före", "Konsekvens", "Före skyddsåtgärd", CONSEQUENCE),
          column("fore", "Risk före", "formula", { formula: "[sannolikhet] * [konsekvens]", bands: RISK_LEVELS, placement: "header", cardLabel: "Före" }),
          scale("sannolikhet_efter", "Sannolikhet efter", "Sannolikhet", "Kvarvarande risk efter åtgärd", LIKELIHOOD),
          scale("konsekvens_efter", "Konsekvens efter", "Konsekvens", "Kvarvarande risk efter åtgärd", CONSEQUENCE),
          column("efter", "Kvarvarande risk", "formula", { formula: "[sannolikhet_efter] * [konsekvens_efter]", bands: RISK_LEVELS, placement: "header", cardLabel: "Efter" }),
          // 2026-09-28 (docs/kallor/riskbedomning.md): the kind of hazard and of measure, and the action plan AFS 2023:1 11–13 §§
          // asks for – whether the risk is serious, who does what by when, and that it was done and checked.
          column("kategori", "Riskkategori", "choice", { options: RISK_CATEGORIES, cardWidth: "quarter" }),
          column("atgardstyp", "Typ av åtgärd", "choice", { options: MEASURE_TYPES, cardWidth: "quarter", help: "Åtgärdstrappan: i första hand vid källan, sist personlig skyddsutrustning." }),
          column("allvarlig", "Allvarlig risk", "yesno", { group: "Handlingsplan", cardWidth: "quarter" }),
          column("ansvarig", "Ansvarig för åtgärd", "text", { group: "Handlingsplan", cardWidth: "quarter" }),
          column("klart", "Genomförs senast", "date", { group: "Handlingsplan", cardWidth: "quarter" }),
          column("genomford", "Genomförd och kontrollerad", "check", { group: "Handlingsplan", cardWidth: "quarter" }),
        ] },
    ] },
    // Elarbete (2026-09-28, SS-EN 50110-1 and ESA): shown only when the work is electrical work.
    { id: "risk-el", type: "section", title: "Elarbete", description: "Planering av elarbete enligt SS-EN 50110-1 och ESA.", blocks: [
      { id: "risk-f-elarbete", type: "field", key: "elarbete", label: "Arbetet omfattar elarbete", input: "yesno", allowNotApplicable: false, width: "third" },
      { id: "risk-f-metod", type: "field", key: "arbetsmetod", label: "Arbetsmetod", input: "choice", options: ["Arbete utan spänning", "Arbete nära spänning", "Arbete med spänning"], width: "third", showIf: { key: "elarbete", op: "eq", value: "YES" } },
      { id: "risk-f-esl", type: "field", key: "elsakerhetsledare", label: "Elsäkerhetsledare", input: "text", width: "third", showIf: { key: "elarbete", op: "eq", value: "YES" } },
      { id: "risk-f-ala", type: "field", key: "anlaggningsansvarig", label: "Elanläggningsansvarig", input: "text", width: "third", showIf: { key: "elarbete", op: "eq", value: "YES" } },
      { id: "risk-f-instr", type: "field", key: "instruktioner", label: "Instruktioner och dokumentation från anläggningens innehavare mottagna", input: "yesno", width: "two_thirds", showIf: { key: "elarbete", op: "eq", value: "YES" } },
      { id: "risk-h-regler", type: "heading", text: "De fem säkerhetsreglerna vid arbete utan spänning", level: 3, showIf: { key: "arbetsmetod", op: "eq", value: "Arbete utan spänning" } },
      ...SAFETY_RULES.map(([key, label]) => ({ id: `risk-f-${key}`, type: "field", key, label, input: "yesno", required: true, width: "third", showIf: { key: "arbetsmetod", op: "eq", value: "Arbete utan spänning" } })),
    ] },
    { id: "risk-godkannande", type: "section", title: "Gemensamma åtgärder och godkännande", description: "Sammanfatta övergripande skydd och låt ansvarig granska bedömningen innan arbetet startar.", blocks: [
      { id: "risk-f-atgarder", type: "field", key: "atgarder", label: "Gemensamma skyddsåtgärder", input: "textarea", width: "full", placeholder: "Exempel: arbetsberedning, avspärrning, personlig skyddsutrustning och kontroll före start" },
      { id: "risk-f-paborjas", type: "field", key: "paborjas", label: "Arbetet får påbörjas", input: "yesno", allowNotApplicable: false, width: "third", help: "Beslutet efter granskningen av riskerna och åtgärderna." },
      { id: "risk-s-godkand", type: "signature", key: "godkand", label: "Godkänd av", required: true, width: "full", placeholder: "För- och efternamn", statement: "Jag har granskat riskerna, åtgärderna och den kvarvarande risknivån" },
    ] },
  ],
});

export const riskForm: BuiltinForm = {
  id: RISK_FORM_ID, document: riskFormDocument, meta: formMetaSchema.parse({
    name: "Riskbedömning", icon: "shield-check", color: "amber", category: "SAFETY",
    description: "Risker med sannolikhet och konsekvens före och efter skyddsåtgärd, riskmatris, gemensamma åtgärder och godkännande.",
  }),
};
