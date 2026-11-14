import { emptyFormValues, type FormValues } from "../../lib/workflow/form-document";
import { companyRcdLimits } from "../helpers/suggested-limits";

/**
 * Fixed answers to Kontroll före idrifttagning for the locked reference PDFs (2026-10-06: the older control
 * editor is gone, every control is the form). The cases are the ones the form was proven against when it replaced the
 * control (2026-09-27), written here as the grunduppgifter, the moments switched on, the measurement rows and the visual
 * inspection. Numbers are written the way the protocol prints them ("0.4").
 */
type Row = Record<string, string | number | boolean>;
type Moment = "iso" | "cont" | "volt" | "rcd";
export type KfidCase = {
  meta: { proj: string; perf: string; ctrl: string; client: string; addr: string; date: string; instr: string; sn: string; cal: string };
  active: Record<Moment | "vis", boolean>;
  rows: Record<Moment, (Row & { uid: string })[]>;
  vis: { checks: Record<string, boolean>; comment: string };
};
export const KFID_MOMENTS: Moment[] = ["iso", "cont", "volt", "rcd"];

const row = (uid: string, values: Row): Row & { uid: string } => ({ uid, ok: false, comment: "", ...values });

export const kfidFull: KfidCase = {
  meta: { proj: "Brf Solgläntan – ny elcentral A1", perf: "Elon Strömberg", ctrl: "Maria Ek", client: "Anna Berg", addr: "anna.berg@example.se", date: "2026-09-27", instr: "Installationstestare", sn: "SN 4471-22", cal: "2026-03-01" },
  active: { iso: true, cont: true, volt: true, rcd: true, vis: true },
  rows: {
    iso: [
      row("iso-1", { objekt: "Grupp 1 – belysning trapphus", u: "500 V", mohm: 250, limit: 1 }),
      row("iso-2", { objekt: "Grupp 2 – uttag kök", u: "500 V", mohm: 0.4, limit: 1, comment: "Fukt i kopplingsdosa, åtgärdas och mäts om." }),
      row("iso-3", { objekt: "Exempelkrets", u: "250 V", mohm: 12, limit: 0.5, example: true }),
    ],
    cont: [
      row("cont-1", { name: "PE huvudcentral – A1", ohm: 0.12, limit: 0.5 }),
      row("cont-2", { name: "Skyddsutjämning VVS", ohm: 0.74, limit: 0.5, comment: "Förbindning lös, efterdragen." }),
    ],
    volt: [
      row("volt-1", { name: "Inkommande L1–L2–L3", status: "400 Vac", rotation: "Höger" }),
      row("volt-2", { name: "Uttag kök", status: "Saknas", rotation: "Ej mätt", comment: "Säkring löst ut." }),
    ],
    rcd: [
      row("rcd-1", { place: "JFB 1 – A1:F2", std: "EN", type: "A", idn: 30, idp: 21, idn_measured: 22, t1p: 24, t1n: 26, t5p: 12, t5n: 14, uclim: "50", uc: 1.2, ntrip05: true, btnok: true, comment: "Provad med testknapp och instrument." }),
      row("rcd-2", { place: "JFB 2 – A1:F7", std: "TT", type: "AC", idn: 30, idp: 25, idn_measured: 26, t1p: 240, t1n: 255, t5p: 38, t5n: 44, uclim: "25", uc: 3.4, ntrip05: false, btnok: true }),
    ],
  },
  vis: { checks: { markning: true, dok: true, mek: false, ip: true, beroring: true, funktion: true }, comment: "Mekaniskt skydd saknas vid kabelgenomföring i källaren. Ny genomföring beställd." },
};

const longRows = (count: number, make: (index: number) => Row) => Array.from({ length: count }, (_, index) => row(`r-${index + 1}`, make(index)));
export const kfidLong: KfidCase = {
  meta: { proj: "Industrihall Norra – nyinstallation med ett mycket långt projektnamn som bryts på två rader i rutan", perf: "Elon Strömberg", ctrl: "", client: "", addr: "", date: "2026-09-20", instr: "Installationstestare", sn: "", cal: "" },
  active: { iso: true, cont: false, volt: false, rcd: true, vis: false },
  rows: {
    iso: longRows(42, (index) => ({ objekt: `Grupp ${index + 1} – ${index % 3 ? "uttag" : "belysning och nödbelysning i produktionshallens norra del"}`, u: index % 4 ? "500 V" : "1000 V", mohm: 100 + index, limit: 1, ok: index % 7 !== 3, comment: index % 5 === 0 ? "Uppmätt efter att frånskiljaren öppnats och alla laster kopplats bort." : "" })),
    cont: [],
    volt: [],
    rcd: longRows(4, (index) => ({ place: `JFB ${index + 1}`, std: "TNIT", type: "B", idn: 300, idp: 180, idn_measured: 190, t1p: 120, t1n: 130, t5p: 20, t5n: 22, uclim: "50", uc: 2, ntrip05: true, btnok: index !== 2, ok: index !== 2 })),
  },
  vis: { checks: {}, comment: "" },
};

export const kfidTemplate: KfidCase = { ...kfidFull, rows: { iso: [], cont: [], volt: [], rcd: [] } };

/** The case as the form's answers; `files` are the task's attachments, placed on their row or moment. */
export function kfidValues(data: KfidCase, files: { id: string; section: string; rowId: string | null }[] = []): FormValues {
  const values = emptyFormValues();
  const text = (value: unknown) => typeof value === "number" ? String(value) : value ?? "";
  values.fields = { ...data.meta };
  for (const key of [...KFID_MOMENTS, "vis"] as const) values.sections[`kfid-${key}`] = data.active[key];
  for (const key of KFID_MOMENTS) {
    values.tables[key] = data.rows[key].map((item) => {
      const cells: Record<string, string | number | boolean | string[] | null> = {};
      for (const [name, value] of Object.entries(item)) if (!["uid", "example"].includes(name)) cells[name] = typeof value === "boolean" ? value : text(value) as string;
      cells.bild = files.filter((file) => file.section === key && file.rowId === item.uid).map((file) => file.id);
      return { id: item.uid, label: "", cells, ...(item.example === true ? { example: true } : {}) };
    });
    values.images[`${key}_bilder`] = files.filter((file) => file.section === key && !file.rowId).map((file) => file.id);
  }
  values.images.vis_bilder = files.filter((file) => !KFID_MOMENTS.includes(file.section as Moment)).map((file) => file.id);
  values.checklists.vis = Object.fromEntries(Object.keys(data.vis.checks).map((item) => [item, { state: data.vis.checks[item] === true ? "OK" as const : data.vis.checks[item] === false ? "NOT_OK" as const : null, comment: "" }]));
  values.deviationComment = data.vis.comment;
  // The company's own values for the RCD test (Värden och referenser), as a company that has entered them.
  values.limits = companyRcdLimits();
  return values;
}
