import {
  newRow,
  sections,
  sectionKeys,
  type SectionKey,
  type ControlData,
} from "./model";
export function exampleRow(section: SectionKey) {
  const examples = {
    iso: { objekt: "Krets 1", u: "500 V", mohm: 5, limit: 1 },
    cont: { name: "PE central–Uttag", ohm: 0.12, limit: 0.5 },
    volt: { name: "Huvudmatning", status: "400 Vac", rotation: "Höger" },
    rcd: {
      place: "JFB1",
      type: "A",
      idn: 30,
      idp: 27,
      idn_measured: 28,
      std: "TNIT",
      t1p: 195,
      t1n: 205,
      t5p: 28,
      t5n: 30,
      uclim: "50",
      ntrip05: true,
      uc: 21,
      btnok: true,
    },
  };
  return { ...newRow(section), ...examples[section], example: true };
}
export function attachmentLabel(
  data: ControlData,
  file: { section: string; rowId: string | null },
) {
  if (!sectionKeys.includes(file.section as SectionKey))
    return "Visuell kontroll";
  const section = file.section as SectionKey;
  const index = data[section].rows.findIndex((r) => r.uid === file.rowId);
  const row = data[section].rows[index];
  return `${sections[section].title}${file.rowId ? (index >= 0 ? ` · Rad ${index + 1}${row.objekt || row.name || row.place ? ` (${row.objekt || row.name || row.place})` : ""}` : " · Tidigare kontrollrad") : ""}`;
}
