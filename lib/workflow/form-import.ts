import type { FormLimit, FormSection } from "./form-document";

/**
 * Control points from a spreadsheet (2026-09-28): one row per point, for any control – a round, a recurring inspection,
 * a checklist of one's own – read into a form and refined in the builder. Generic on purpose (Daniel 2026-09-29: no
 * import for one control type; a separate Import page with AI analysis of documents is planned and can reuse this).
 * Pure: the server reads the file, this turns the rows into sections, checklists, fields and limits; nothing is published.
 */
export const IMPORT_COLUMNS = [
  "avsnitt_nr", "avsnitt_namn", "punkt_nr", "kontrollpunkt", "instruktion", "svarstyp", "valalternativ", "enhet", "decimaler",
  "varning_min", "varning_max", "larm_min", "larm_max", "gransvarde_kalla", "gransvarde_referens", "per_aggregat", "frekvens", "obligatorisk", "foto_vid_avvikelse", "aktiv", "sortering",
] as const;
export const IMPORT_EXAMPLE: Record<string, string>[] = [
  { avsnitt_nr: "1", avsnitt_namn: "Elcentraler", punkt_nr: "1.01", kontrollpunkt: "Märkning och gruppförteckning aktuell", svarstyp: "bedomning", foto_vid_avvikelse: "ja", frekvens: "ar", aktiv: "ja", sortering: "1" },
  { avsnitt_nr: "1", avsnitt_namn: "Elcentraler", punkt_nr: "1.02", kontrollpunkt: "Jordfelsbrytare provade med testknapp", svarstyp: "ja_nej", frekvens: "kvartal", aktiv: "ja", sortering: "2" },
  { avsnitt_nr: "2", avsnitt_namn: "Mätvärden", punkt_nr: "2.01", kontrollpunkt: "Lagertemperatur", instruktion: "Läs av på displayen.", svarstyp: "matvarde", enhet: "°C", decimaler: "0", gransvarde_kalla: "tillverkare", gransvarde_referens: "Drift- och underhållsinstruktionen", frekvens: "rond", obligatorisk: "ja", aktiv: "ja", sortering: "3" },
];

/** Friendly names are accepted too ("Avsnitt", "Kontrollpunkt", "Svarstyp", "Enhet" …). */
const ALIASES: Record<string, string> = {
  avsnitt: "avsnitt_namn", "avsnitt namn": "avsnitt_namn", kontrollpunkt: "kontrollpunkt", punkt: "kontrollpunkt", instruktion: "instruktion", hjälptext: "instruktion", hjalptext: "instruktion",
  svarstyp: "svarstyp", typ: "svarstyp", alternativ: "valalternativ", enhet: "enhet", decimaler: "decimaler", "varning min": "varning_min", "varning max": "varning_max",
  "larm min": "larm_min", "larm max": "larm_max", källa: "gransvarde_kalla", kalla: "gransvarde_kalla", referens: "gransvarde_referens", frekvens: "frekvens", obligatorisk: "obligatorisk", aktiv: "aktiv", sortering: "sortering",
};
export function importColumn(header: string) {
  const plain = header.trim().toLowerCase().replace(/\*$/, "").trim();
  if ((IMPORT_COLUMNS as readonly string[]).includes(plain)) return plain;
  return ALIASES[plain] ?? ALIASES[plain.replace(/_/g, " ")] ?? null;
}

const yes = (value: string | undefined) => /^(ja|j|yes|y|1|x|sant|true)$/i.test((value ?? "").trim());
const number = (value: string | undefined) => { const text = (value ?? "").trim().replace(",", "."); return text && Number.isFinite(Number(text)) ? Number(text) : null; };
const slug = (text: string) => (text.toLowerCase().normalize("NFC").replace(/[^a-zåäö0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-zåäö]+/, "").slice(0, 34)) || "punkt";
const SOURCE_TEXT: Record<string, string> = { vattendom: "Vattendomen / tillståndet", tillverkare: "Tillverkarens anvisning", drift_tillsynsprogram: "Drift- och tillsynsprogrammet", dammsakerhetsprogram: "Dammsäkerhetsprogrammet", referensvarde: "Referensvärde från tidigare mätningar" };
const FREQUENCY_TEXT: Record<string, string> = { rond: "varje rond", vecka: "veckovis", manad: "månadsvis", kvartal: "kvartalsvis", ar: "årligen", vid_behov: "vid behov" };

export type ImportResult = { sections: FormSection[]; limits: FormLimit[]; issues: string[]; points: number };

/**
 * Rows → sections: points judged OK/Ej OK are gathered in one checklist per section (with a camera when a row asks
 * for a photo), Ja/nej, text, choice and date points become fields, and measured values become number fields with a
 * trend and a configurable limit that says where its value comes from. `taken` keeps new keys unique in the form.
 */
export function importControlPoints(rows: Record<string, string>[], taken: Set<string> = new Set(), newId: () => string = () => Math.random().toString(36).slice(2, 10)): ImportResult {
  const issues: string[] = [];
  const unique = (base: string) => { let key = slug(base); for (let index = 2; taken.has(key); index++) key = `${slug(base).slice(0, 30)}_${index}`; taken.add(key); return key; };
  const active = rows.map((row, index) => ({ row, index })).filter(({ row }) => (row.kontrollpunkt ?? "").trim() && (row.aktiv === undefined || row.aktiv.trim() === "" || yes(row.aktiv)));
  // A section keeps the number any of its rows gives it; sections without a number follow in the order they appear.
  const sectionOf = (row: Record<string, string>) => (row.avsnitt_namn ?? "").trim() || "Kontrollpunkter";
  const sectionNumber = new Map<string, number>();
  for (const { row, index } of active) { const nr = number(row.avsnitt_nr); if (!sectionNumber.has(sectionOf(row)) || nr !== null) sectionNumber.set(sectionOf(row), nr ?? 1000 + index); }
  active.sort((a, b) => sectionNumber.get(sectionOf(a.row))! - sectionNumber.get(sectionOf(b.row))! || (number(a.row.sortering) ?? a.index) - (number(b.row.sortering) ?? b.index));
  const sections = new Map<string, FormSection>();
  const checklists = new Map<string, Extract<FormSection["blocks"][number], { type: "checklist" }>>();
  const limits: FormLimit[] = [];
  for (const { row, index } of active) {
    const sectionName = (row.avsnitt_namn ?? "").trim() || "Kontrollpunkter";
    let section = sections.get(sectionName);
    if (!section) {
      section = { id: newId(), type: "section", title: sectionName.slice(0, 200), description: "", newPage: false, blocks: [], optional: false, defaultOn: true, pdfStyle: "standard", collapsed: false, help: "", taskTitle: "", showIf: { key: "", op: "eq", value: "" } };
      sections.set(sectionName, section);
    }
    const label = row.kontrollpunkt.trim().slice(0, 200);
    const help = [row.instruktion?.trim(), row.frekvens?.trim() ? `Frekvens: ${FREQUENCY_TEXT[row.frekvens.trim().toLowerCase()] ?? row.frekvens.trim()}.` : ""].filter(Boolean).join(" ").slice(0, 500);
    const type = (row.svarstyp ?? "").trim().toLowerCase().replace(/[\s/]+/g, "_");
    const common = { id: newId(), required: yes(row.obligatorisk), help, width: "third" as const, visibility: { task: true, pdf: true }, showIf: { key: "", op: "eq" as const, value: "" }, placeholder: "", pdfLabel: "", remarks: false, limitKey: "", trend: false,
      unit: "", min: null, max: null, options: [] as string[], multiple: false, allowNotApplicable: true, deviationOn: "NONE" as const, deviationOptions: [] as string[], defaultValue: null, allowedMin: null, allowedMax: null, decimals: null, maxLength: null, prefill: "none" as const, highlight: false, momentSwitch: false };
    if (["bedomning", "bedömning", "ok_ej_ok", "b"].includes(type)) {
      let list = checklists.get(sectionName);
      if (!list) {
        list = { id: newId(), type: "checklist", key: unique(`${sectionName} punkter`), label: sectionName.slice(0, 200), items: [], required: false, help: "", mode: "assessment", photos: false, deviationTable: "", width: "full", visibility: { task: true, pdf: true }, showIf: { key: "", op: "eq", value: "" } };
        checklists.set(sectionName, list);
        section.blocks.push(list);
      }
      list.items.push({ id: `p${list.items.length + 1}`, text: label.slice(0, 300) });
      if (yes(row.foto_vid_avvikelse)) list.photos = true;
      continue;
    }
    if (["matvarde", "mätvärde", "matvärde", "m", "tal"].includes(type)) {
      const key = unique(label);
      const source = [SOURCE_TEXT[(row.gransvarde_kalla ?? "").trim().toLowerCase()] ?? (row.gransvarde_kalla ?? "").trim(), (row.gransvarde_referens ?? "").trim()].filter(Boolean).join(": ");
      limits.push({ key, label, unit: (row.enhet ?? "").trim().slice(0, 20), low: number(row.larm_min), high: number(row.larm_max), warnLow: number(row.varning_min), warnHigh: number(row.varning_max), source: source.slice(0, 300), help: "" });
      const decimals = number(row.decimaler);
      section.blocks.push({ ...common, type: "field", key, label, input: "number", unit: (row.enhet ?? "").trim().slice(0, 20), limitKey: key, trend: true, decimals: decimals !== null && decimals >= 0 && decimals <= 6 ? Math.round(decimals) : null, width: "quarter" });
      continue;
    }
    const key = unique(label);
    if (["ja_nej", "janej", "jn", "j_n"].includes(type)) section.blocks.push({ ...common, type: "field", key, label, input: "yesno" });
    else if (["val", "choice"].includes(type)) {
      const options = (row.valalternativ ?? "").split(/[;|]/).map((item) => item.trim()).filter(Boolean).slice(0, 50);
      if (!options.length) issues.push(`Rad ${index + 2}: ${label} saknar valalternativ och blev ett textfält.`);
      section.blocks.push({ ...common, type: "field", key, label, input: options.length ? "choice" : "text", options });
    } else if (["datum_tid", "datum", "tid"].includes(type)) section.blocks.push({ ...common, type: "field", key, label, input: type === "datum" ? "date" : "datetime" });
    else {
      if (type && type !== "text") issues.push(`Rad ${index + 2}: okänd svarstyp "${row.svarstyp}" för ${label} – blev ett textfält.`);
      section.blocks.push({ ...common, type: "field", key, label, input: "text" });
    }
  }
  return { sections: [...sections.values()], limits, issues, points: active.length };
}
