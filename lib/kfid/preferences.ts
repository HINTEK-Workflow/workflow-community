import { z } from "zod";
import { themeNames } from "@/lib/theme";
import { emptyTaskCardLayout, taskCardLayoutSchema } from "@/lib/workflow/task-card-layout";
import { MENU_HIDEABLE } from "@/lib/workflow/menu-items";
export const quickActionLabels = {
  new: "Ny kontroll",
  controls: "Öppna arkivet",
  save: "Spara",
  copy: "Spara som",
  customers: "Mina kunder",
  pdf: "PDF / utskrift",
  xlsx: "Exportera Excel",
  import: "Importera JSON",
  settings: "Inställningar",
  stats: "Statistik",
  latest: "Senaste kontrollen",
  none: "Dölj",
} as const;
export type QuickAction = keyof typeof quickActionLabels;
export const suggestionSchema = z
  .record(z.string().max(60), z.array(z.string().trim().max(200)).max(100))
  .refine((v) => Object.keys(v).length <= 60, "För många förslagsfält.");
export const preferencesSchema = z.object({
  autoSave: z.boolean().default(true),
  rowsOnTop: z.boolean().default(false),
  // 2026-09-25: HINTEK Blue is the primary direction (docs/design-standard.md), so it is the default for accounts without a saved preference, not a plain neutral light surface.
  theme: z.enum(themeNames).default("blue"),
  compact: z.boolean().default(false),
  suggestions: z.string().max(5000).default(""),
  quickAction: z.enum(["new", "controls", "customers", "stats"]).default("stats"),
  quickActions: z
    .tuple([
      z.enum(Object.keys(quickActionLabels) as [QuickAction, ...QuickAction[]]),
      z.enum(Object.keys(quickActionLabels) as [QuickAction, ...QuickAction[]]),
    ])
    .default(["latest", "customers"]),
  autoSuggestEnabled: z.boolean().default(true),
  showExamples: z.boolean().default(false),
  textScale: z.enum(["100", "110", "125"]).default("100"),
  fieldSuggestions: suggestionSchema.default({}),
  // Order and visibility of the cards under Ny uppgift (2026-09-27).
  taskCardLayout: taskCardLayoutSchema.default(emptyTaskCardLayout),
  // Menu buttons the person has chosen to hide (2026-09-30); display only, never access.
  hiddenMenuItems: z.array(z.enum(MENU_HIDEABLE)).max(20).catch([]).default([]),
  // Guided tours the person has seen or dismissed (2026-09-28), by tour: when.
  tours: z.record(z.string().max(40), z.string().max(40)).default({}),
  // Beslutsstöd (2026-10-01): how often tips are shown, and the tips the person never wants again.
  advisor: z.object({
    level: z.enum(["often", "normal", "rarely", "off"]).catch("normal").default("normal"),
    muted: z.array(z.string().max(40)).max(40).catch([]).default([]),
    // Whether a proposal the person asked HINTEK AI for goes straight into an empty field (2026-10-02); off = a
    // proposal to use or dismiss.
    autofill: z.boolean().catch(false).default(false),
  }).catch({ level: "normal", muted: [], autofill: false }).default({ level: "normal", muted: [], autofill: false }),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences = preferencesSchema.parse({});
export const builtInSuggestions: Record<string, string[]> = {
  meta: [
    "Elcentral",
    "Undercentral",
    "Gruppcentral",
    "Kabelskåp",
    "Ställverk",
    "Laddbox",
    "Fastighetsel",
    "Reservkraft",
  ],
  iso: [
    "PE <> N+L1+L2+L3",
    "PE <> N",
    "PE <> L1",
    "PE <> L2",
    "PE <> L3",
    "L1 <> N",
    "L2 <> N",
    "L3 <> N",
    "L1 <> L2",
    "L1 <> L3",
    "L2 <> L3",
    "Krets A",
    "Krets B",
  ],
  cont: [
    "PE-ledare",
    "Huvudjordledare",
    "Skyddsutjämning",
    "Gruppledning",
    "Kabel 1",
    "Kabel 2",
    "Matning till central",
    "Matning till laddbox",
  ],
  volt: [
    "Vägguttag",
    "CEE 16A",
    "CEE 32A",
    "Matning L1-L2-L3",
    "Laddbox",
    "Motor",
    "Inkommande central",
    "Utgående grupp",
  ],
  rcd: [
    "JFB huvud",
    "JFB grupp 1",
    "JFB grupp 2",
    "JFB laddbox",
    "JFB uttagsgrupp",
    "Central A",
    "Undercentral B",
  ],
  vis: [
    "Märkning och skyltning utförd",
    "Dokumentation inlämnad",
    "Mekaniskt skydd korrekt",
    "IP-klass bedömd som lämplig",
    "Inga anmärkningar",
    "Avvikelser finns",
  ],
};
