import { formDocumentSchema, type FormDocument } from "./form-document";

/** The design's example form (Daniel 2026-09-26): isolation measurement with a row formula, a total and a result. */
export const isolationMeasurementForm: FormDocument = formDocumentSchema.parse({
  schema: 1,
  blocks: [
    { id: "rubrik", type: "heading", text: "Isolationsmätning", level: 1 },
    { id: "instruktion", type: "text", text: "Mät isolationsresistansen mellan ledare och skyddsjord med frånkopplad last. Gränsvärdet är normalt 1,0 MΩ vid 500 V." },
    { id: "huvud", type: "columns", columns: [
      [{ id: "instrument", type: "field", key: "instrument", label: "Instrument", input: "text", required: true, help: "", unit: "", min: null, max: null, options: [], multiple: false, allowNotApplicable: true, deviationOn: "NONE" }],
      [{ id: "provspanning", type: "field", key: "provspanning", label: "Provspänning", input: "choice", required: true, help: "", unit: "", min: null, max: null, options: ["250 V", "500 V", "1000 V"], multiple: false, allowNotApplicable: true, deviationOn: "NONE" }],
      [{ id: "provdatum", type: "field", key: "provdatum", label: "Provdatum", input: "date", required: true, help: "", unit: "", min: null, max: null, options: [], multiple: false, allowNotApplicable: true, deviationOn: "NONE" }],
    ] },
    { id: "matning", type: "table", key: "matning", label: "Mätning", rowMode: "fixed", fixedRows: ["L1–PE", "L2–PE", "L3–PE", "N–PE"], required: true, help: "", columns: [
      { id: "uppmatt", key: "uppmatt", label: "Uppmätt", input: "number", required: true, unit: "MΩ", options: [], min: null, max: null, formula: "", passCondition: false, total: "min" },
      { id: "grans", key: "grans", label: "Gräns", input: "number", required: true, unit: "MΩ", options: [], min: null, max: null, formula: "", passCondition: false, total: "none" },
      { id: "godkand", key: "godkand", label: "Godkänd", input: "formula", required: false, unit: "", options: [], min: null, max: null, formula: "[uppmatt] >= [grans]", passCondition: true, total: "none" },
    ] },
    { id: "lagsta", type: "computed", key: "lagsta", label: "Lägsta värde", formula: "MIN(matning.uppmatt)", unit: "MΩ", passCondition: false },
    { id: "resultat", type: "computed", key: "resultat", label: "Resultat", formula: "OM(ANTAL.OM(matning.godkand; FALSKT) = 0; \"Godkänd\"; \"Avvikelse\")", unit: "", passCondition: false },
    { id: "utford", type: "signature", key: "utford", label: "Utförd av", required: true },
  ],
});
