import { z } from "zod";
import { themeChoices, toThemeChoice } from "@/lib/theme";
import { emptyTaskCardLayout, taskCardLayoutSchema } from "@/lib/workflow/task-card-layout";
import { normalizeMenuHidden, normalizeMenuShortcuts } from "@/lib/workflow/menu-items";
import { defaultDetailLevels } from "@/lib/workflow/detail-level";
import { normalizeNativeLayout } from "@/lib/workflow/native-layout";
import { effectiveDetailLevels, personalChoicesCount, workViewStamp, type WorkViewSetting } from "@/lib/workflow/work-view";
import { currentWorkProfile, WORK_PROFILES } from "@/lib/workflow/work-profile";
// The menu's two lists, read the same way for the computer's menu and for the phone's Mer (phoneMenu).
const menuHiddenSchema = () => z.array(z.string().max(40)).max(40).catch([]).default([]).transform(normalizeMenuHidden);
const menuShortcutsSchema = () => z.array(z.string().max(40)).max(20).catch([]).default([]).transform(normalizeMenuShortcuts);
const choiceStampSchema = () => z.string().max(40).nullable().optional().catch(undefined);
// Autospara utkast and Visa knappar för test- och exempelrader are gone as choices (2026-10-07): drafts always
// autosave and example rows are never offered. Older stored data may still carry autoSave/showExamples; the schema
// drops the keys without complaint.
export const preferencesSchema = z.object({
  rowsOnTop: z.boolean().default(false),
  // 2026-09-25: Workflow Blue is the primary direction (docs/design-standard.md), so it is the default for accounts without a saved preference, not a plain neutral light surface.
  // Blue and Customer are Light since 2026-10-16; a stored old value is read as Light, never refused.
  // Ljust, Mörkt or Som enheten (D5, 2026-10-21); an older stored value (blue, customer) is read as Ljust.
  theme: z.preprocess((value) => (value === undefined ? value : toThemeChoice(value)), z.enum(themeChoices)).default("light"),
  compact: z.boolean().default(false),
  // The start page after signing in; an unknown value (such as the older "controls") falls back to Översikt.
  quickAction: z.enum(["new", "tasks", "customers", "stats"]).catch("stats").default("stats"),
  textScale: z.enum(["100", "110", "125"]).default("100"),
  // Order and visibility of the cards under Ny uppgift (2026-09-27).
  taskCardLayout: taskCardLayoutSchema.default(emptyTaskCardLayout),
  // Menu buttons the person has chosen to hide (2026-09-30); display only, never access.
  // A button that is no longer in the menu (Platser and Krediter became tabs 2026-10-02) is dropped, the rest kept.
  // Point 5 (B1/B2, 2026-10-23): a key saved for the old menu (Ny X, Verktyg) is read as the button that holds it now.
  hiddenMenuItems: menuHiddenSchema(),
  // Pages under Verktyg shown directly in the menu as shortcuts (2026-10-09): the same page, never
  // a copy; display only, never access. An unknown key is dropped.
  menuShortcuts: menuShortcutsSchema(),
  // Anpassa menyn per enhet (2026-10-24): the two lists above are the computer's and the tablet's menu, and Mer on
  // the phone has a choice of its own. Missing (null) = Mer follows the menu, so a choice saved before reads on both until
  // the phone's is changed. Same JSON object, no schema change.
  phoneMenu: z.object({ hiddenMenuItems: menuHiddenSchema(), menuShortcuts: menuShortcutsSchema() }).nullable().catch(null).default(null),
  // Visningsnivå per device (2026-10-02, all three devices 2026-10-11): the level on a phone, a tablet and a
  // computer, each 1–3; display only. The first time: phone 2, tablet 2, computer 3. The computer's key is new and
  // lives in the same JSON object (no schema change); a record without it reads as the default.
  detailLevel: z.object({
    phone: z.union([z.literal(1), z.literal(2), z.literal(3)]).catch(defaultDetailLevels.phone).default(defaultDetailLevels.phone),
    tablet: z.union([z.literal(1), z.literal(2), z.literal(3)]).catch(defaultDetailLevels.tablet).default(defaultDetailLevels.tablet),
    desktop: z.union([z.literal(1), z.literal(2), z.literal(3)]).catch(defaultDetailLevels.desktop).default(defaultDetailLevels.desktop),
  }).catch({ ...defaultDetailLevels }).default({ ...defaultDetailLevels }),
  // Hem's tiles and the tab bar at level 1 on a phone (2026-10-09 evening): personal, the same default for all;
  // display only, never access (lib/workflow/native-layout.ts).
  nativeLayout: z.unknown().optional().transform(normalizeNativeLayout),
  // Arbetsvy (2026-10-08): the stamp of the admin's work view the person's own display level was chosen under
  // (lib/workflow/work-view.ts). Missing = chosen before any view; null = back to the view's default.
  viewBasis: z.string().max(40).nullable().optional().catch(undefined),
  // Yrkesprofil (2026-11-01, lib/workflow/work-profile.ts): the person's own choice, display only; no permission check reads it.
  ownWorkProfile: z.object({ profile: z.preprocess(currentWorkProfile, z.enum(WORK_PROFILES)), setAt: z.string().min(1).max(40), basis: z.string().max(90) }).nullable().catch(null).default(null),
  // The stamp of the profile the menu, Mer and Hem with the tab bar were saved under. It tells "not chosen" from "chosen
  // empty": hiddenMenuItems and nativeLayout read the same either way, and every save writes them back through this schema.
  choiceBasis: z.object({ menu: choiceStampSchema(), phone: choiceStampSchema(), native: choiceStampSchema() }).catch({}).default({}),
  // Guided tours the person has seen or dismissed (2026-09-28), by tour: when.
  tours: z.record(z.string().max(40), z.string().max(40)).default({}),
  // Beslutsstöd (2026-10-01): how often tips are shown, and the tips the person never wants again.
  advisor: z.object({
    level: z.enum(["often", "normal", "rarely", "off"]).catch("normal").default("normal"),
    muted: z.array(z.string().max(40)).max(40).catch([]).default([]),
    // Whether a proposal the person asked Workflow AI for goes straight into an empty field (2026-10-02); off = a
    // proposal to use or dismiss.
    autofill: z.boolean().catch(false).default(false),
  }).catch({ level: "normal", muted: [], autofill: false }).default({ level: "normal", muted: [], autofill: false }),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences = preferencesSchema.parse({});

/** Which menu a choice belongs to: Mer on the phone, or the menu on a computer and a tablet. */
export type MenuDevice = "phone" | "desktop";
export type MenuDeviceChoices = { hiddenMenuItems: string[]; menuShortcuts: string[] };

/** The menu choices in force on a device; a phone without a choice of its own reads the computer's. */
export function menuChoicesFor(preferences: { hiddenMenuItems: readonly string[]; menuShortcuts: readonly string[]; phoneMenu?: MenuDeviceChoices | null }, device: MenuDevice): MenuDeviceChoices {
  const source = device === "phone" && preferences.phoneMenu ? preferences.phoneMenu : preferences;
  return { hiddenMenuItems: [...source.hiddenMenuItems], menuShortcuts: [...source.menuShortcuts] };
}

/** One device's menu choices as a save: the phone's in phoneMenu, the computer's in the two lists (the other left as stored). */
export function menuChoicesPatch(device: MenuDevice, choices: MenuDeviceChoices, profileStamp = ""): PreferencesPatch {
  const lists = { hiddenMenuItems: [...choices.hiddenMenuItems], menuShortcuts: [...choices.menuShortcuts] } as Pick<Preferences, "hiddenMenuItems" | "menuShortcuts">;
  // Under a yrkesprofil the save carries its stamp, so the choice wins over the profile's while the profile stands, also when empty.
  const basis = profileStamp ? { choiceBasis: device === "phone" ? { phone: profileStamp } : { menu: profileStamp } } : {};
  return device === "phone" ? { phoneMenu: lists, ...basis } : { ...lists, ...basis };
}

/** The choices one save sends: only what was changed (a device's level alone, without the other device's). */
export type PreferencesPatch = Partial<Omit<Preferences, "detailLevel" | "choiceBasis">> & { detailLevel?: Partial<Preferences["detailLevel"]>; choiceBasis?: Partial<Preferences["choiceBasis"]> };

/**
 * A save merged onto what is stored (simulation 0.6.3: a person with a phone and a tablet open saw the tablet's level jump
 * from 2 to 3 – each device saved its whole, older copy of the preferences and the last one won). A save carries only
 * what was changed; the rest stays as stored, and a device's display level never resets the other device's. Unknown
 * keys are ignored, and the result is read through the schema like everything stored.
 */
export function mergePreferences(stored: unknown, patch: unknown): Preferences {
  const base = preferencesSchema.parse(stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {});
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const input = patch as Record<string, unknown>;
  const next: Record<string, unknown> = { ...base };
  for (const key of Object.keys(preferencesSchema.shape)) if (key in input && input[key] !== undefined) next[key] = input[key];
  if (input.detailLevel && typeof input.detailLevel === "object" && !Array.isArray(input.detailLevel)) {
    const levels = input.detailLevel as Record<string, unknown>;
    next.detailLevel = {
      phone: levels.phone ?? base.detailLevel.phone,
      tablet: levels.tablet ?? base.detailLevel.tablet,
      desktop: levels.desktop ?? base.detailLevel.desktop,
    };
  }
  if (input.choiceBasis && typeof input.choiceBasis === "object" && !Array.isArray(input.choiceBasis)) next.choiceBasis = { ...base.choiceBasis, ...(input.choiceBasis as Record<string, unknown>) };
  return preferencesSchema.parse(next);
}

/** The same merge for the page's own copy, so what is shown matches what the server keeps. */
export const applyPreferencesPatch = (current: Preferences, patch: PreferencesPatch): Preferences => mergePreferences(current, patch);

/**
 * One device's display level as a save. While the person's own levels count under the admin's work view, only that
 * device is sent; otherwise the levels in force (the view's) become the person's own, with this device changed.
 */
export function detailLevelPatch(setting: WorkViewSetting | null | undefined, preferences: Pick<Preferences, "detailLevel" | "viewBasis">, device: keyof Preferences["detailLevel"], level: 1 | 2 | 3): PreferencesPatch {
  const detailLevel = personalChoicesCount(preferences.viewBasis, setting) ? { [device]: level } : { ...effectiveDetailLevels(setting, preferences), [device]: level };
  return { detailLevel, viewBasis: workViewStamp(setting) };
}
