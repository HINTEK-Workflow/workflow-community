import { z } from "zod";

export const sectionKeys = ["iso", "cont", "volt", "rcd"] as const;
export type SectionKey = (typeof sectionKeys)[number];
export type Field = {
  key: string;
  label: string;
  type?: "number" | "checkbox";
  options?: string[];
  default?: string | number | boolean;
};
export const sections: Record<
  SectionKey,
  { title: string; description: string; fields: Field[]; tone: string }
> = {
  iso: {
    title: "Isolation",
    description: "Isolationsresistans mellan ledare.",
    tone: "violet",
    fields: [
      { key: "objekt", label: "Krets / objekt" },
      {
        key: "u",
        label: "Testspänning",
        options: ["250 V", "500 V", "1000 V"],
        default: "500 V",
      },
      { key: "mohm", label: "Uppmätt (MΩ)", type: "number" },
      { key: "limit", label: "Gräns (MΩ)", type: "number", default: 1 },
    ],
  },
  cont: {
    title: "Kontinuitet",
    description: "Resistans i skyddsledare och förbindningar.",
    tone: "cyan",
    fields: [
      { key: "name", label: "Ledare / sträcka" },
      { key: "ohm", label: "Uppmätt (Ω)", type: "number" },
      { key: "limit", label: "Gräns (Ω)", type: "number", default: 0.5 },
    ],
  },
  volt: {
    title: "Spänningsprovning",
    description: "Matningsspänning och rotationsriktning.",
    tone: "amber",
    fields: [
      { key: "name", label: "Mätpunkt" },
      {
        key: "status",
        label: "Spänning",
        options: ["Ej mätt", "230 Vac", "400 Vac", "Saknas", "Avvikande"],
        default: "Ej mätt",
      },
      {
        key: "rotation",
        label: "Rotation",
        options: ["Ej mätt", "Höger", "Vänster"],
        default: "Ej mätt",
      },
    ],
  },
  rcd: {
    title: "Jordfelsbrytarprov",
    description: "Utlösningstider, ström och testknapp.",
    tone: "rose",
    fields: [
      { key: "place", label: "Placering / ID" },
      {
        key: "std",
        label: "Bedömningsprofil",
        options: ["EN", "TNIT", "TT"],
        default: "EN",
      },
      { key: "type", label: "Typ", options: ["A", "AC", "B"], default: "A" },
      { key: "idn", label: "Märkström (mA)", type: "number", default: 30 },
      { key: "idp", label: "Utlösningsström + (mA)", type: "number" },
      { key: "idn_measured", label: "Utlösningsström − (mA)", type: "number" },
      { key: "t1p", label: "t 1× + (ms)", type: "number" },
      { key: "t1n", label: "t 1× − (ms)", type: "number" },
      { key: "t5p", label: "t 5× + (ms)", type: "number" },
      { key: "t5n", label: "t 5× − (ms)", type: "number" },
      {
        key: "uclim",
        label: "Uc gräns (V)",
        options: ["25", "50"],
        default: "50",
      },
      { key: "uc", label: "Uc uppmätt (V)", type: "number" },
      { key: "ntrip05", label: "0,5× IΔn ej utlöst", type: "checkbox" },
      { key: "btnok", label: "Testknapp OK", type: "checkbox" },
    ],
  },
};
export const visualFields = [
  { key: "markning", label: "Märkning och skyltning utförd" },
  { key: "dok", label: "Dokumentation lämnad (schema / ritning)" },
  { key: "mek", label: "Mekaniskt skydd och infästning OK" },
  { key: "ip", label: "IP-klass och omgivning lämplig" },
];
const short = z.string().max(500);
const cell = z.union([
  z.string().max(2000),
  z.number().finite().nonnegative().max(1e12),
  z.boolean(),
  z.null(),
]);
const row = z
  .record(z.string().max(40), cell)
  .refine((r) => Object.keys(r).length <= 32, "För många fält");
const rows = z.object({ rows: z.array(row).max(300) });
export const controlSchema = z.object({
  meta: z.object({
    proj: short,
    perf: short,
    ctrl: short,
    client: short,
    addr: z
      .string()
      .max(254)
      .refine((v) => !v || z.email().safeParse(v).success, "Ogiltig e-post"),
    date: short,
    instr: short,
    sn: short,
    cal: short,
    autoOn: z.boolean(),
    name: short.optional(),
  }),
  active: z.object({
    iso: z.boolean(),
    cont: z.boolean(),
    volt: z.boolean(),
    rcd: z.boolean(),
    vis: z.boolean(),
  }),
  iso: rows,
  cont: rows,
  volt: rows,
  rcd: rows,
  vis: z.object({
    checks: z.record(z.string(), z.boolean()),
    comment: z.string().max(15000),
  }),
});
export type ControlData = z.infer<typeof controlSchema>;
export type Measurement = ControlData["iso"]["rows"][number];
export type CompletionIssue = {
  code: string;
  path: string;
  message: string;
};
export type CompletionValidation = {
  complete: boolean;
  errors: CompletionIssue[];
  warnings: CompletionIssue[];
  progress: { completed: number; total: number; percent: number };
};
export function blankControl(): ControlData {
  return {
    meta: {
      proj: "",
      perf: "",
      ctrl: "",
      client: "",
      addr: "",
      date: new Date().toISOString().slice(0, 10),
      instr: "",
      sn: "",
      cal: "",
      autoOn: false,
    },
    active: { iso: false, cont: false, volt: false, rcd: false, vis: false },
    iso: { rows: [] },
    cont: { rows: [] },
    volt: { rows: [] },
    rcd: { rows: [] },
    vis: { checks: {}, comment: "" },
  };
}
export function newRow(section: SectionKey): Measurement {
  return Object.fromEntries([
    ["uid", crypto.randomUUID()],
    ["ok", false],
    ["comment", ""],
    ...sections[section].fields.map((f) => [
      f.key,
      f.default ?? (f.type === "checkbox" ? false : ""),
    ]),
  ]);
}
function number(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value === "boolean" || !String(value).trim()) return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export const RULE_VERSION = "KFID-V1-2026.1";
// Explicitly reproduces V1 assessment; this is not a claim of standards certification.
export function evaluate(section: SectionKey, row: Measurement): boolean {
  const n = (key: string) => number(row[key]);
  if (section === "iso")
    return (
      n("mohm") !== null && n("limit") !== null && n("mohm")! >= n("limit")!
    );
  if (section === "cont")
    return n("ohm") !== null && n("limit") !== null && n("ohm")! <= n("limit")!;
  if (section === "volt")
    return ["230 Vac", "400 Vac"].includes(String(row.status));
  const t1 = { EN: 300, TNIT: 400, TT: 200 }[String(row.std)];
  return Boolean(
    t1 &&
      row.btnok === true &&
      ["t1p", "t1n"].every((k) => n(k) !== null && n(k)! <= t1) &&
      ["t5p", "t5n"].every((k) => n(k) !== null && n(k)! <= 40),
  );
}
export function normalizeControl(input: unknown): ControlData {
  const d = controlSchema.parse(input);
  for (const key of sectionKeys) {
    const seen = new Set<string>();
    d[key].rows = d[key].rows.map((r) => {
      const uid =
        typeof r.uid === "string" &&
        r.uid &&
        r.uid.length <= 100 &&
        !seen.has(r.uid)
          ? r.uid
          : crypto.randomUUID();
      seen.add(uid);
      if (key === "iso" && ["250", "500", "1000"].includes(String(r.u)))
        r.u = `${r.u} V`;
      for (const field of sections[key].fields) {
        if (
          field.type === "number" &&
          r[field.key] !== "" &&
          r[field.key] != null
        ) {
          const value = number(r[field.key]);
          if (value === null)
            throw new z.ZodError([
              {
                code: "custom",
                path: [key, field.key],
                message:
                  "Ogiltigt mätvärde. Ange ett tal som är noll eller större.",
              },
            ]);
          r[field.key] = value;
        }
      }
      return {
        ...r,
        uid,
        ok: d.meta.autoOn ? evaluate(key, r) : r.ok === true,
      };
    });
  }
  return d;
}
export function totals(d: ControlData) {
  const result: {
    key: SectionKey | "vis";
    title: string;
    total: number;
    ok: number;
  }[] = sectionKeys
    .filter((k) => d.active[k])
    .map((key) => ({
      key,
      title: sections[key].title,
      total: d[key].rows.filter((row) => row.example !== true).length,
      ok: d[key].rows.filter(
        (row) =>
          row.example !== true &&
          (d.meta.autoOn ? evaluate(key, row) : row.ok === true),
      ).length,
    }));
  if (d.active.vis)
    result.push({
      key: "vis",
      title: "Visuell kontroll",
      total: visualFields.length,
      ok: visualFields.filter((f) => d.vis.checks[f.key]).length,
    });
  return result;
}
export function validateForCompletion(
  d: ControlData,
  options: { attachmentCount?: number } = {},
): CompletionValidation {
  const errors: CompletionIssue[] = [];
  const warnings: CompletionIssue[] = [];
  let completed = 0;
  let total = 0;
  const requirement = (
    valid: boolean,
    code: string,
    path: string,
    message: string,
  ) => {
    total += 1;
    if (valid) completed += 1;
    else errors.push({ code, path, message });
  };
  const warning = (
    valid: boolean,
    code: string,
    path: string,
    message: string,
  ) => {
    if (!valid) warnings.push({ code, path, message });
  };
  const text = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0;

  requirement(
    text(d.meta.proj),
    "meta.project",
    "meta.proj",
    "Ange projekt eller anläggning.",
  );
  requirement(
    text(d.meta.perf),
    "meta.performer",
    "meta.perf",
    "Ange vem som utfört kontrollen.",
  );
  requirement(
    /^\d{4}-\d{2}-\d{2}$/.test(d.meta.date),
    "meta.date",
    "meta.date",
    "Ange kontrollens datum.",
  );

  const activeMeasurements = sectionKeys.filter((key) => d.active[key]);
  requirement(
    activeMeasurements.length > 0 || d.active.vis,
    "sections.active",
    "active",
    "Välj minst ett kontrollmoment.",
  );

  const requiredFields: Record<SectionKey, string[]> = {
    iso: ["objekt", "u", "mohm", "limit"],
    cont: ["name", "ohm", "limit"],
    volt: ["name", "status"],
    rcd: d.meta.autoOn
      ? ["place", "std", "type", "idn", "t1p", "t1n", "t5p", "t5n"]
      : ["place", "std", "type", "idn"],
  };
  let hasDeviation = false;
  for (const key of activeMeasurements) {
    const exampleRows = d[key].rows.filter((row) => row.example === true);
    const realRows = d[key].rows.filter((row) => row.example !== true);
    requirement(
      realRows.length > 0,
      `${key}.rows`,
      `${key}.rows`,
      `${sections[key].title} behöver minst en verklig kontrollrad.`,
    );
    requirement(
      exampleRows.length === 0,
      `${key}.examples`,
      `${key}.rows`,
      `${sections[key].title} innehåller en test-/exempelrad. Den räknas inte som en verklig kontrollrad och måste tas bort före färdigställande.`,
    );
    realRows.forEach((row, index) => {
      for (const fieldKey of requiredFields[key]) {
        const field = sections[key].fields.find((item) => item.key === fieldKey);
        const value = row[fieldKey];
        const valid =
          fieldKey === "status"
            ? text(value) && value !== "Ej mätt"
            : field?.type === "number"
              ? number(value) !== null
              : text(value);
        requirement(
          valid,
          `${key}.${fieldKey}`,
          `${key}.rows.${index}.${fieldKey}`,
          `${sections[key].title}, rad ${index + 1}: ange ${field?.label.toLowerCase() ?? fieldKey}.`,
        );
      }
      if (!(d.meta.autoOn ? evaluate(key, row) : row.ok === true))
        hasDeviation = true;
      if (key === "volt")
        warning(
          row.rotation !== "Ej mätt" && text(row.rotation),
          "volt.rotation",
          `volt.rows.${index}.rotation`,
          `Spänningsprovning, rad ${index + 1}: rotationsriktning är inte registrerad.`,
        );
    });
  }

  if (d.active.vis) {
    for (const field of visualFields) {
      const registered = Object.prototype.hasOwnProperty.call(
        d.vis.checks,
        field.key,
      );
      requirement(
        registered,
        `vis.${field.key}`,
        `vis.checks.${field.key}`,
        `Registrera resultat för ”${field.label}”.`,
      );
      if (registered && d.vis.checks[field.key] !== true) hasDeviation = true;
    }
  }

  if (hasDeviation)
    requirement(
      text(d.vis.comment),
      "summary.deviation",
      "vis.comment",
      "Beskriv avvikelser eller manuella bedömningar i sammanfattningen.",
    );

  warning(
    text(d.meta.ctrl),
    "meta.reviewer",
    "meta.ctrl",
    "Kontrollerad av är inte angivet.",
  );
  warning(
    text(d.meta.instr) && text(d.meta.sn) && text(d.meta.cal),
    "meta.instrument",
    "meta.instr",
    "Instrument, serienummer eller kalibreringsdatum saknas.",
  );
  warning(
    text(d.meta.client) || text(d.meta.addr),
    "meta.contact",
    "meta.client",
    "Kontaktperson eller e-post saknas.",
  );
  if (options.attachmentCount !== undefined)
    warning(
      options.attachmentCount > 0,
      "attachments.empty",
      "attachments",
      "Kontrollen saknar bilder eller dokument. Bilagor är inte ett krav.",
    );

  return {
    complete: errors.length === 0,
    errors,
    warnings,
    progress: {
      completed:
        activeMeasurements.length > 0 || d.active.vis ? completed : 0,
      total,
      percent:
        total && (activeMeasurements.length > 0 || d.active.vis)
          ? Math.round((completed / total) * 100)
          : 0,
    },
  };
}
export function ruleSummary(d: ControlData) {
  // A conclusion line (2026-10-01): the rows that are not approved and the visual points that are not confirmed.
  const counted = totals(d);
  const rows = counted.reduce((sum, section) => sum + section.total, 0);
  const notApproved = counted.reduce((sum, section) => sum + section.total - section.ok, 0) + (d.active.vis ? visualFields.filter((field) => d.vis.checks[field.key] === false).length : 0);
  const unconfirmed = d.active.vis ? visualFields.filter((field) => d.vis.checks[field.key] === undefined).length : 0;
  const conclusion = !rows && !d.active.vis ? "Inga kontrollmoment är valda ännu."
    : notApproved ? `Bedömning: ${notApproved} ${notApproved === 1 ? "punkt är" : "punkter är"} inte godkända – åtgärdas före idrifttagning.`
    : unconfirmed ? `Bedömning: inga avvikelser hittills, men ${unconfirmed} ${unconfirmed === 1 ? "punkt är" : "punkter är"} inte bekräftade.`
    : "Bedömning: inga avvikelser – installationen kan tas i drift enligt kontrollen.";
  return [
    d.meta.proj
      ? `Kontroll av ${d.meta.proj}.`
      : "Kontroll före idrifttagning.",
    ...totals(d).map(
      (s) => `${s.title}: ${s.ok} av ${s.total} kontrollrader godkända.`,
    ),
    ...sectionKeys
      .filter((k) => d.active[k])
      .flatMap((k) =>
        d[k].rows
          .filter((r) => r.comment)
          .map(
            (r) =>
              `${sections[k].title} — ${r.objekt || r.name || r.place || "rad"}: ${r.comment}`,
          ),
      ),
    ...(d.active.vis
      ? visualFields.map(
          (f) =>
            `${f.label}: ${d.vis.checks[f.key] ? "kontrollerat" : "ej bekräftat"}.`,
        )
      : []),
    conclusion,
  ].join("\n");
}
const coordinate = (max: number) =>
  z
    .preprocess(
      (v) =>
        v == null || v === ""
          ? null
          : typeof v === "string"
            ? Number(v.replace(",", "."))
            : v,
      z.number().min(-max).max(max).nullable(),
    )
    .optional();
export const customerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: short.default(""),
  address: short.default(""),
  postalCode: short.default(""),
  city: short.default(""),
  email: z
    .string()
    .max(254)
    .refine((v) => !v || z.email().safeParse(v).success, "Ogiltig e-post")
    .default(""),
  phone: short.default(""),
  mobile: short.default(""),
  lat: coordinate(90),
  lng: coordinate(180),
  notes: z.string().max(5000).default(""),
});
