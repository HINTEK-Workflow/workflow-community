import { z } from "zod";
import { swedishDayKey } from "@/lib/swedish-time";
import { TEMPLATE_SECTIONS } from "./template";
import { isRiskClassKey, levelDirectory, levelsView, toLevel, type LevelDirectory, type LevelsView } from "./levels";
import { awaitsAuthorityReport, DEVIATION_PHOTO_PHASES, DEVIATION_SEVERITIES, DEVIATION_TYPES, deviationType, mayHandleDeviation, mayReadDeviation, REPORTABLE_LABEL, SERIOUS_NOTICE, type DeviationViewer } from "./incidents";
export * from "./incidents";

/**
 * Egenkontrollprogram, etapp 1 (2026-10-06, docs/proposals/egenkontrollprogram.md, beslut 1–8). The rules and
 * shapes shared by Cloud (Prisma tables, app/api/self-inspection), Local (the .hwf file) and the demo: one document per
 * company with a draft, approved versions that never change, read confirmations, yearly reviews and a deviation log
 * with an action plan. Warnings never block (beslut 2). No database code here.
 */

// ---------- fixed lists ----------

/** The kinds of electrical installation work a company states in its programme (ELSÄK-FS 2017:3 4 kap. 2–5 §§). */
export const ACTIVITY_GROUPS = [
  { key: "LOW", label: "Lågspänning" },
  { key: "LIMITED", label: "Begränsade verksamhetstyper" },
  { key: "HIGH", label: "Högspänning" },
  { key: "SPECIAL", label: "Särskild verksamhetstyp" },
] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number]["key"];
export const ACTIVITY_TYPES = [
  { key: "LV_RAIL", group: "LOW", label: "Bandrift-lågspänning" },
  { key: "LV_HOMES", group: "LOW", label: "Bostäder" },
  { key: "LV_PUBLIC", group: "LOW", label: "Allmänna och offentliga utrymmen" },
  { key: "LV_OTHER_USE", group: "LOW", label: "Övriga anläggningar för användning av el" },
  { key: "LV_GRID", group: "LOW", label: "Elnät-lågspänning" },
  { key: "LV_PRODUCTION", group: "LOW", label: "Elproduktionsanläggningar" },
  { key: "LIM_LIFTS", group: "LIMITED", label: "Hissar, portar och rulltrappor" },
  { key: "LIM_MACHINES", group: "LIMITED", label: "Maskiner" },
  { key: "LIM_HVAC", group: "LIMITED", label: "Värme, kyla och ventilation" },
  { key: "HV_GRID", group: "HIGH", label: "Elnät-högspänning" },
  { key: "HV_RAIL", group: "HIGH", label: "Bandrift-högspänning" },
  { key: "HV_OTHER", group: "HIGH", label: "Övriga högspänningsanläggningar" },
  { key: "CABLE_LAYING", group: "SPECIAL", label: "Kabelförläggning" },
] as const;
export type ActivityTypeKey = (typeof ACTIVITY_TYPES)[number]["key"];
const ACTIVITY_KEYS = ACTIVITY_TYPES.map((type) => type.key) as [ActivityTypeKey, ...ActivityTypeKey[]];
export const activityLabel = (key: string) => ACTIVITY_TYPES.find((type) => type.key === key)?.label ?? key;

/** Authorisation levels for an electrical installer. */
export const AUTHORIZATION_LEVELS = ["A", "AL", "B"] as const;
export type AuthorizationLevel = (typeof AUTHORIZATION_LEVELS)[number];
/** The lowest level an ERE needs per group (ELSÄK-FS 2017:3 4 kap. 7–8 §§); cable laying alone needs no ERE. */
export const ERE_LEVELS: Record<ActivityGroup, readonly AuthorizationLevel[]> = { LOW: ["A", "AL"], LIMITED: ["A", "AL", "B"], HIGH: ["A"], SPECIAL: ["A", "AL", "B"] };

/** What a programme role does in the programme (data for etapp 2; never a permission in Workflow). */
export const ROLE_CAPABILITIES = [
  { key: "plan", label: "Planerar och kravbestämmer" },
  { key: "perform", label: "Utför arbete" },
  { key: "inspect", label: "Kontrollerar utfört arbete" },
  { key: "approve", label: "Fastställer programmet" },
  { key: "deviations", label: "Tar emot avvikelser" },
] as const;
export type RoleCapability = (typeof ROLE_CAPABILITIES)[number]["key"];
const CAPABILITY_KEYS = ROLE_CAPABILITIES.map((item) => item.key) as [RoleCapability, ...RoleCapability[]];

export const DEVIATION_KINDS = { DEVIATION: "Avvikelse", IMPROVEMENT: "Förbättring" } as const;
export const DEVIATION_CATEGORIES = { IMMEDIATE: "Omedelbar åtgärd", ROUTINE: "Rutinöversyn" } as const;
export const DEVIATION_STATUSES = { OPEN: "Öppen", IN_PROGRESS: "Pågår", DONE: "Åtgärdad" } as const;
export const REVIEW_OUTCOMES = { NO_CHANGES: "Inga ändringar behövs", CHANGES_NEEDED: "Programmet ska ändras" } as const;
export type DeviationKind = keyof typeof DEVIATION_KINDS;
export type DeviationCategory = keyof typeof DEVIATION_CATEGORIES;
export type DeviationStatus = keyof typeof DEVIATION_STATUSES;
export type ReviewOutcome = keyof typeof REVIEW_OUTCOMES;
const enumOf = <T extends Record<string, string>>(record: T) => z.enum(Object.keys(record) as [keyof T & string, ...(keyof T & string)[]]);

/** The programme is reviewed at least once a year (3 kap. 13 §); the bell reminds 30 days ahead. */
export const REVIEW_INTERVAL_MONTHS = 12;
export const REVIEW_REMINDER_DAYS = 30;

// ---------- the document ----------

const id = z.string().min(1).max(120);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange datum som ÅÅÅÅ-MM-DD.");
const timestamp = z.string().min(1).max(40);
const text = (max: number) => z.string().max(max);

export const sectionSchema = z.object({ id, key: z.string().max(60), title: text(160), body: text(20_000), legalRef: text(200), sortOrder: z.number().int() });
export const roleMemberSchema = z.object({
  personId: id,
  /** Local and the demo keep the name; Cloud resolves it from the person in the draft and freezes it in a version. */
  name: text(160).default(""),
  authorizationLevel: z.enum(["", ...AUTHORIZATION_LEVELS]).default(""),
  /** Optional (beslut 7); shown only to admins and the person, never in a version or the PDF. */
  authorizationNumber: text(40).default(""),
  /** The ERE who stands in the company's registration (3 kap. 6 §). */
  registered: z.boolean().default(false),
});
/**
 * What the programme says about one person's competence (2026-10-06, the minimum before etapp 3's competence
 * cards): which work the person may do, the assessment it rests on, limitations and whether the person works under
 * supervision. Part of the draft, so it is frozen with every approved version.
 */
export const competenceSchema = z.object({
  personId: id,
  /** Local and the demo keep the name; Cloud resolves it from the person and freezes it in a version. */
  name: text(160).default(""),
  /** The kinds of work (activity types) the person may do; empty = as the person's roles say. */
  workTypes: z.array(z.enum(ACTIVITY_KEYS)).max(ACTIVITY_KEYS.length).default([]),
  /** The kinds of work in the company's own words, e.g. "service och mindre ändringar i bostäder". */
  scope: text(2000).default(""),
  /** What the assessment rests on: training, experience, work done. */
  assessment: text(4000).default(""),
  assessedAt: day.nullable().default(null),
  limitations: text(2000).default(""),
  supervised: z.boolean().default(false),
});
export const roleSchema = z.object({
  id, key: z.string().max(60), name: text(120), description: text(4000), duties: text(8000), isEre: z.boolean(),
  /** Roller med nivå (2026-10-07): 1–3; a person's level is the highest among their roles (./levels.ts). */
  level: z.number().int().min(1).max(3).default(1),
  capabilities: z.array(z.enum(CAPABILITY_KEYS)).max(CAPABILITY_KEYS.length), sortOrder: z.number().int(), members: z.array(roleMemberSchema).max(200),
});
export const draftProgramSchema = z.object({
  id, title: text(160), templateVersion: text(40),
  activityTypes: z.array(z.enum(ACTIVITY_KEYS)).max(ACTIVITY_KEYS.length),
  worksOnOthersInstallations: z.boolean(),
  registrationCheckedAt: day.nullable(),
  /** Etapp 2 (beslut 1): a programme for one customer in the register; null = the company's own programme. */
  customerId: id.nullable().default(null),
  revision: z.number().int().positive(),
  sections: z.array(sectionSchema).max(60),
  roles: z.array(roleSchema).max(40),
  people: z.array(competenceSchema).max(200).default([]),
  createdAt: timestamp, updatedAt: timestamp,
});
export const contentSchema = z.object({
  title: text(160), templateVersion: text(40), activityTypes: z.array(z.enum(ACTIVITY_KEYS)), worksOnOthersInstallations: z.boolean(), registrationCheckedAt: day.nullable(),
  sections: z.array(z.object({ key: z.string().max(60), title: text(160), body: text(20_000), legalRef: text(200) })),
  roles: z.array(z.object({ key: z.string().max(60), name: text(120), description: text(4000), duties: text(8000), isEre: z.boolean(), capabilities: z.array(z.enum(CAPABILITY_KEYS)),
    /** The role's level as the version froze it; absent in versions approved before levels existed. */
    level: z.number().int().min(1).max(3).optional(),
    members: z.array(z.object({ personId: id, name: text(160), authorizationLevel: z.enum(["", ...AUTHORIZATION_LEVELS]), registered: z.boolean() })) })),
  /** The people's competence as it stood when the version was approved; absent in versions without any. */
  people: z.array(competenceSchema).optional(),
  /**
   * Egenkontroll och GDPR (2026-10-10): people erased since approval. The version keeps their name and role; their
   * authorisation level and competence assessment were removed (lib/auth/erasure.ts). The hash is the approved content's.
   */
  redactions: z.array(z.object({ personId: id, at: day })).optional(),
});
export const versionSchema = z.object({ id, number: z.number().int().positive(), content: contentSchema, hash: z.string().max(128), changeReason: text(1000), approvedById: id, approvedByName: text(160).default(""), approvedAt: timestamp });
export const confirmationSchema = z.object({ versionId: id, personId: id, name: text(160).default(""), confirmedAt: timestamp });
export const reviewSchema = z.object({
  id, reviewedAt: day, reviewedById: id, reviewedByName: text(160).default(""), versionNumber: z.number().int().positive().nullable(),
  registrationChecked: z.boolean(), deviationsReviewed: z.boolean(), competenceFollowed: z.boolean(), outcome: enumOf(REVIEW_OUTCOMES), notes: text(4000), createdAt: timestamp,
});
export const deviationSourceSchema = z.object({ taskId: id, title: text(200).default(""), rowId: text(100).default("") });
/**
 * Etapp 2 (2026-10-06): the kind of work a project or a task is, and – before 2026-10-07 – who performs and who
 * inspects it. Roles are now given in advance with a level (2026-10-07, ./levels.ts), so nothing new is written to
 * the performer and the inspector; what an older file or row holds stays readable and is kept as it was. A task's own
 * choice goes before its project's.
 */
export const assignmentSchema = z.object({
  id, target: z.enum(["project", "task"]), targetId: id,
  performerId: id.nullable().default(null), performerName: text(160).default(""),
  inspectorId: id.nullable().default(null), inspectorName: text(160).default(""),
  activityType: z.enum(ACTIVITY_KEYS).nullable().default(null), updatedAt: timestamp,
});
/**
 * A customer's special requirements as an older version kept them in the programme (etapp 2). Since 2026-10-07 they are
 * the field "Särskilda krav" on the customer card; this shape is only read from older .hwf files, which move the text to
 * the customer when they are opened (features/kfid/local-workspace-store.ts).
 */
export const customerRequirementSchema = z.object({ customerId: id, customerName: text(200).default(""), requirements: text(8000), updatedAt: timestamp });
/** A certificate or proof attached to a line of a competence card (Cloud; the bytes are in the private storage). */
export const credentialFileSchema = z.object({ id, filename: text(200), mimeType: text(100), size: z.number().int().nonnegative(), createdAt: timestamp });
/**
 * Etapp 3: one line of a person's competence card – a training or certificate with dates. `leftAt` is when the person left
 * the company: the card is then kept three months and deleted (2026-10-07); `files` are attached certificates.
 */
export const credentialSchema = z.object({
  id, personId: id, name: text(160).default(""), title: text(160),
  /** Who gave the training (kompetenskort v2, 2026-10-08); "" when not stated. */
  provider: text(160).default(""),
  issuedAt: day.nullable().default(null), validUntil: day.nullable().default(null), note: text(1000).default(""),
  leftAt: timestamp.nullable().default(null), files: z.array(credentialFileSchema).max(20).default([]),
  createdAt: timestamp, updatedAt: timestamp,
});

/**
 * Kompetenskort v2 (2026-10-08): beside the training lines a card has the company's competence groups, driving
 * licence and languages, and every save keeps a version of the whole card. Driving licence classes are the designations
 * only; the language levels are Workflow's own plain words (no external scale is quoted).
 */
export const LICENCE_CLASSES = ["AM", "A1", "A2", "A", "B", "BE", "C1", "C1E", "C", "CE", "D1", "D1E", "D", "DE"] as const;
export type LicenceClass = (typeof LICENCE_CLASSES)[number];
export const LANGUAGE_LEVELS = { BASIC: "Grundläggande", WORK: "Fungerar i arbetet", FLUENT: "Flytande", NATIVE: "Modersmål" } as const;
export type LanguageLevel = keyof typeof LANGUAGE_LEVELS;
export const competenceGroupSchema = z.object({ id, name: text(80), description: text(500).default(""), sortOrder: z.number().int().default(0), createdAt: timestamp, updatedAt: timestamp });
export const languageSchema = z.object({ language: text(60), level: enumOf(LANGUAGE_LEVELS) });
export const competenceCardSchema = z.object({
  personId: id,
  /** Local and the demo keep the name; Cloud resolves it from the person. */
  name: text(160).default(""),
  groupIds: z.array(id).max(50).default([]),
  licenceClasses: z.array(z.enum(LICENCE_CLASSES)).max(LICENCE_CLASSES.length).default([]),
  licenceValidUntil: day.nullable().default(null),
  languages: z.array(languageSchema).max(20).default([]),
  /** The person's own suggestion of a change; the person never edits the card (admins do). */
  suggestion: text(2000).default(""),
  suggestedAt: timestamp.nullable().default(null),
  /** The number of the card's latest version (0 before the first). */
  revision: z.number().int().nonnegative().default(0),
  leftAt: timestamp.nullable().default(null),
  createdAt: timestamp, updatedAt: timestamp,
});
/** What a version keeps: the whole card as it stood, with names instead of ids, so a later change never alters it. */
export const cardContentSchema = z.object({
  trainings: z.array(z.object({ title: text(160), provider: text(160).default(""), issuedAt: day.nullable(), validUntil: day.nullable(), note: text(1000).default(""), files: z.array(text(200)).default([]) })).default([]),
  groups: z.array(text(80)).default([]),
  licenceClasses: z.array(z.string().max(4)).default([]),
  licenceValidUntil: day.nullable().default(null),
  languages: z.array(languageSchema).default([]),
});
export const cardVersionSchema = z.object({
  id, personId: id, number: z.number().int().positive(), content: cardContentSchema, change: text(200).default(""),
  savedById: id, savedByName: text(160).default(""), savedAt: timestamp,
});
/** Etapp 3: the company's measuring instruments with calibration. */
export const instrumentSchema = z.object({
  id, name: text(160), serialNumber: text(80).default(""), calibratedAt: day.nullable().default(null), nextCalibrationAt: day.nullable().default(null), note: text(1000).default(""),
  active: z.boolean().default(true), createdAt: timestamp, updatedAt: timestamp,
});
export const deviationSchema = z.object({
  id, number: z.number().int().positive(), kind: enumOf(DEVIATION_KINDS), title: text(200), description: text(4000), category: enumOf(DEVIATION_CATEGORIES), systematic: z.boolean(),
  status: enumOf(DEVIATION_STATUSES), action: text(4000), responsibleId: id.nullable(), responsibleName: text(160).default(""), dueDate: z.union([day, z.literal("")]), followUp: text(4000),
  reportedById: id, reportedByName: text(160).default(""), createdAt: timestamp, updatedAt: timestamp, closedAt: timestamp.nullable(),
  /** Etapp 2: the protocol row it was taken from ("Till avvikelseloggen"), so the log leads back to it. */
  source: deviationSourceSchema.nullable().default(null),
  /**
   * Avvikelse ↔ arbetsorder (2026-10-10): the work order that fixes the entry, and who closed the entry (a person,
   * or whoever finished the linked work order) with their name as it was then. Optional and additive, so an older .hwf
   * file opens unchanged; the rules are in ./deviation-link.ts.
   */
  workOrderId: id.nullable().optional(),
  closedById: id.nullable().optional(),
  closedByName: text(160).optional(),
  /**
   * Tillbud och olycksfall (2026-10-30, ./incidents.ts): the type (absent = Egenkontroll, as everything from before),
   * the investigation of a near miss or an accident, Allvarlig/Personskada/Gäller el (never a diagnosis), who marked it
   * reported to the authority, the line written at Markera klar and the photos. Optional and additive, so an older .hwf file
   * opens unchanged.
   */
  type: enumOf(DEVIATION_TYPES).optional(),
  /** Lagringstid (2026-11-04, ./retention.ts), Cloud only: kept for a claim; the names, text and photos are gone. */
  retentionHoldAt: timestamp.nullable().optional(),
  personalDataRemovedAt: timestamp.nullable().optional(),
  occurredAt: timestamp.nullable().optional(),
  whatHappened: text(4000).optional(),
  cause: text(4000).optional(),
  serious: z.boolean().optional(),
  personalInjury: z.boolean().optional(),
  electrical: z.boolean().optional(),
  reportedToAuthorityAt: timestamp.nullable().optional(),
  reportedToAuthorityById: id.nullable().optional(),
  reportedToAuthorityByName: text(160).optional(),
  doneNote: text(1000).optional(),
  /** Allvarlighetsgrad (2026-10-30): absent in an older .hwf file, which reads it as Normal (./incidents.ts deviationSeverity). */
  severity: enumOf(DEVIATION_SEVERITIES).optional(),
  /** Photos (Cloud keeps the bytes; a Local file and the demo have none). */
  attachments: z.array(z.object({ id, phase: enumOf(DEVIATION_PHOTO_PHASES), filename: text(200), mimeType: text(100), size: z.number().int().nonnegative(), createdById: id, createdAt: timestamp })).max(40).optional(),
});
export const selfInspectionDocumentSchema = z.object({
  program: draftProgramSchema.nullable().default(null),
  versions: z.array(versionSchema).default([]),
  confirmations: z.array(confirmationSchema).default([]),
  reviews: z.array(reviewSchema).default([]),
  deviations: z.array(deviationSchema).default([]),
  assignments: z.array(assignmentSchema).max(5000).default([]),
  // Read from older files only; the text is on the customer card now (see customerRequirementSchema). Always empty once opened.
  customerRequirements: z.array(customerRequirementSchema).max(1000).default([]),
  credentials: z.array(credentialSchema).max(2000).default([]),
  /** Kompetenskort v2 (2026-10-08): the company's groups, each person's card beside the lines, and the cards' versions. */
  competenceGroups: z.array(competenceGroupSchema).max(100).default([]),
  competenceCards: z.array(competenceCardSchema).max(2000).default([]),
  cardVersions: z.array(cardVersionSchema).max(20_000).default([]),
  instruments: z.array(instrumentSchema).max(500).default([]),
  /** Riskklasser (2026-10-07): the company's own class per task type (key → 1–3); a type without one uses Workflow's proposal. */
  riskClasses: z.record(z.string().max(120), z.number().int().min(1).max(3)).default({}),
});
export type ProgramSection = z.infer<typeof sectionSchema>;
export type RoleMember = z.infer<typeof roleMemberSchema>;
export type ProgramRole = z.infer<typeof roleSchema>;
export type PersonCompetence = z.infer<typeof competenceSchema>;
export type DraftProgram = z.infer<typeof draftProgramSchema>;
export type ProgramContent = z.infer<typeof contentSchema>;
export type ProgramVersion = z.infer<typeof versionSchema>;
export type ReadConfirmation = z.infer<typeof confirmationSchema>;
export type ProgramReview = z.infer<typeof reviewSchema>;
export type ProgramDeviation = z.infer<typeof deviationSchema>;
export type SelfInspectionDocument = z.infer<typeof selfInspectionDocumentSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type CustomerRequirement = z.infer<typeof customerRequirementSchema>;
export type Credential = z.infer<typeof credentialSchema>;
export type CredentialFile = z.infer<typeof credentialFileSchema>;
export type CompetenceGroup = z.infer<typeof competenceGroupSchema>;
export type CompetenceCard = z.infer<typeof competenceCardSchema>;
export type CardContent = z.infer<typeof cardContentSchema>;
export type CardVersion = z.infer<typeof cardVersionSchema>;
export type Instrument = z.infer<typeof instrumentSchema>;
export type DeviationSource = z.infer<typeof deviationSourceSchema>;
export const emptySelfInspectionDocument = (): SelfInspectionDocument => ({ program: null, versions: [], confirmations: [], reviews: [], deviations: [], assignments: [], customerRequirements: [], credentials: [],
  competenceGroups: [], competenceCards: [], cardVersions: [], instruments: [], riskClasses: {} });

// ---------- what can be done ----------

const revision = z.number().int().positive();
const roleInput = z.object({ id: id.optional(), name: z.string().trim().min(1, "Ange rollens namn.").max(120), description: z.string().trim().max(4000), duties: z.string().trim().max(8000), isEre: z.boolean(), capabilities: z.array(z.enum(CAPABILITY_KEYS)).max(CAPABILITY_KEYS.length),
  /** Left out, an existing role keeps its level and a new one starts at 1. */
  level: z.number().int().min(1, "Nivån är 1–3.").max(3, "Nivån är 1–3.").optional() });
/** Next calibration must come after the last one (decision 8, KTR-07). */
export const INSTRUMENT_ORDER_MESSAGE = "Nästa kalibrering måste ligga efter senaste.";
/** A certificate cannot expire before it was taken (R2-KTR-05). */
export const CREDENTIAL_ORDER_MESSAGE = "Giltig till kan inte vara före genomförd.";
/** Vad hände, Varför, when and the three marks of a near miss or an accident (ignored for the other types). */
const investigationInput = {
  occurredAt: z.string().trim().max(40).refine((value) => !Number.isNaN(Date.parse(value)), "Ange när det hände.").nullable().optional(),
  whatHappened: z.string().trim().max(4000).optional(), cause: z.string().trim().max(4000).optional(),
  serious: z.boolean().optional(), personalInjury: z.boolean().optional(), electrical: z.boolean().optional(),
};
export const selfInspectionActionSchema =z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_program") }),
  z.object({ action: z.literal("save_program"), revision, title: z.string().trim().min(1, "Ange programmets namn.").max(160), activityTypes: z.array(z.enum(ACTIVITY_KEYS)).max(ACTIVITY_KEYS.length),
    worksOnOthersInstallations: z.boolean(), registrationCheckedAt: day.nullable(),
    sections: z.array(z.object({ id: id.optional(), title: z.string().trim().min(1, "Varje avsnitt behöver en rubrik.").max(160), body: z.string().max(20_000), legalRef: z.string().trim().max(200) })).min(1).max(60) }),
  z.object({ action: z.literal("save_role"), revision, role: roleInput }),
  z.object({ action: z.literal("remove_role"), revision, roleId: id }),
  z.object({ action: z.literal("assign_role"), revision, roleId: id, personId: id.optional(), name: z.string().trim().max(160).default(""),
    authorizationLevel: z.enum(["", ...AUTHORIZATION_LEVELS]).default(""), authorizationNumber: z.string().trim().max(40).default(""), registered: z.boolean().default(false) }),
  z.object({ action: z.literal("unassign_role"), revision, roleId: id, personId: id }),
  // One person's roles in one step (2026-10-07: roles are given to a person in advance): the person ends up with exactly
  // these roles. Local names a person by name instead of choosing a member.
  z.object({ action: z.literal("set_person_roles"), revision, personId: id.optional(), name: z.string().trim().max(160).default(""), roleIds: z.array(id).max(40) }),
  z.object({ action: z.literal("save_competence"), revision, competence: z.object({ personId: id, name: z.string().trim().max(160).default(""),
    workTypes: z.array(z.enum(ACTIVITY_KEYS)).max(ACTIVITY_KEYS.length).default([]), scope: z.string().trim().max(2000).default(""), assessment: z.string().trim().max(4000).default(""),
    assessedAt: day.nullable().default(null), limitations: z.string().trim().max(2000).default(""), supervised: z.boolean().default(false) }) }),
  z.object({ action: z.literal("remove_competence"), revision, personId: id }),
  z.object({ action: z.literal("approve"), revision, changeReason: z.string().trim().min(1, "Skriv vad som ändrats eller varför versionen fastställs.").max(1000) }),
  z.object({ action: z.literal("confirm_read"), versionNumber: z.number().int().positive() }),
  z.object({ action: z.literal("add_review"), review: z.object({ reviewedAt: day, registrationChecked: z.boolean(), deviationsReviewed: z.boolean(), competenceFollowed: z.boolean(), outcome: enumOf(REVIEW_OUTCOMES), notes: z.string().trim().max(4000) }) }),
  z.object({ action: z.literal("save_deviation"), deviation: z.object({ id: id.optional(), kind: enumOf(DEVIATION_KINDS).default("DEVIATION"), title: z.string().trim().min(1, "Ange en rubrik.").max(200),
    description: z.string().trim().max(4000).default(""), category: enumOf(DEVIATION_CATEGORIES).default("ROUTINE"), systematic: z.boolean().default(false), status: enumOf(DEVIATION_STATUSES).default("OPEN"),
    action: z.string().trim().max(4000).default(""), responsibleId: id.nullable().default(null), dueDate: z.union([day, z.literal("")]).default(""), followUp: z.string().trim().max(4000).default(""),
    source: deviationSourceSchema.nullable().default(null),
    // Tillbud och olycksfall (2026-10-30): the type first; the rest is kept only for a near miss or an accident.
    // Left out (a protocol row, an older client) it is Egenkontroll.
    type: enumOf(DEVIATION_TYPES).optional(),
    // Allvarlighetsgrad (2026-10-30): left out, a new entry is Normal and a saved one keeps its own.
    severity: enumOf(DEVIATION_SEVERITIES).optional(), ...investigationInput }) }),
  // The investigation of a near miss or an accident, by whoever handles it (./incidents.ts mayHandleDeviation); `plan` is Åtgärd.
  z.object({ action: z.literal("save_investigation"), id, plan: z.string().trim().max(4000).default(""), ...investigationInput }),
  // Markera klar: a short optional line (the photos are sent on their own) and, for a near miss or an accident, what its investigation
  // still lacks, saved together with the close (2026-11-02); `plan` is Åtgärd. Öppna igen; Markera som anmäld.
  z.object({ action: z.literal("mark_deviation_done"), id, doneNote: z.string().trim().max(1000).default(""), investigation: z.object({ occurredAt: investigationInput.occurredAt.optional(), whatHappened: investigationInput.whatHappened.optional(), cause: investigationInput.cause.optional(), plan: z.string().trim().max(4000).optional() }).optional() }),
  z.object({ action: z.literal("reopen_deviation"), id }),
  z.object({ action: z.literal("mark_reported_to_authority"), id }),
  // Spara tills vidare (2026-11-04, ./retention.ts), Cloud only: the nightly job leaves the entry alone while a claim runs.
  z.object({ action: z.literal("set_deviation_hold"), id, hold: z.boolean() }),
  // The row an entry was taken from is gone from the protocol (removed, or thrown away with Kasta; 2026-10-12): the
  // reporter – or an admin – withdraws the entry. Untouched (open, no plan, no work order) it leaves the log; otherwise it is marked.
  z.object({ action: z.literal("withdraw_deviation"), id }),
  // Only the kind of work is chosen per project or task now; the performer and the inspector of older clients are ignored
  // (roles are given in advance with a level, 2026-10-07).
  z.object({ action: z.literal("set_assignment"), target: z.enum(["project", "task"]), targetId: id, activityType: z.enum(ACTIVITY_KEYS).nullable().default(null) }),
  // Riskklasser (2026-10-07): the company's own class for a task type; null goes back to Workflow's proposal. Admins only.
  z.object({ action: z.literal("set_risk_class"), key: z.string().min(1).max(120).refine(isRiskClassKey, "Okänd uppgiftstyp."), riskClass: z.number().int().min(1, "Krävd nivå är 1–3.").max(3, "Krävd nivå är 1–3.").nullable() }),
  z.object({ action: z.literal("save_credential"), credential: z.object({ id: id.optional(), personId: id, name: z.string().trim().max(160).default(""),
    title: z.string().trim().min(1, "Ange utbildningen eller intyget.").max(160), provider: z.string().trim().max(160).default(""),
    issuedAt: day.nullable().default(null), validUntil: day.nullable().default(null), note: z.string().trim().max(1000).default("") })
    .refine((item) => !item.issuedAt || !item.validUntil || item.validUntil >= item.issuedAt, { message: CREDENTIAL_ORDER_MESSAGE, path: ["validUntil"] }) }),
  // Kompetenskort v2 (2026-10-08): the rest of a person's card – groups, driving licence, languages (admins).
  z.object({ action: z.literal("save_competence_card"), card: z.object({ personId: id, name: z.string().trim().max(160).default(""),
    groupIds: z.array(id).max(50).default([]), licenceClasses: z.array(z.enum(LICENCE_CLASSES)).max(LICENCE_CLASSES.length).default([]),
    licenceValidUntil: day.nullable().default(null),
    languages: z.array(z.object({ language: z.string().trim().min(1, "Ange språket.").max(60), level: enumOf(LANGUAGE_LEVELS) })).max(20).default([]) }) }),
  // The person suggests a change of their own card (a member never edits it); an admin reads it and clears it.
  z.object({ action: z.literal("suggest_competence_change"), text: z.string().trim().min(1, "Skriv vad som ska ändras.").max(2000) }),
  z.object({ action: z.literal("clear_competence_suggestion"), personId: id }),
  z.object({ action: z.literal("save_competence_group"), group: z.object({ id: id.optional(), name: z.string().trim().min(1, "Ange gruppens namn.").max(80), description: z.string().trim().max(500).default("") }) }),
  z.object({ action: z.literal("remove_competence_group"), id }),
  z.object({ action: z.literal("remove_credential"), id }),
  /** The whole card of a person – every line and its files – at any time (admins; the nightly job does it three months after the person left). */
  z.object({ action: z.literal("remove_credential_card"), personId: id }),
  z.object({ action: z.literal("save_instrument"), instrument: z.object({ id: id.optional(), name: z.string().trim().min(1, "Ange instrumentets typ eller modell.").max(160),
    serialNumber: z.string().trim().max(80).default(""), calibratedAt: day.nullable().default(null), nextCalibrationAt: day.nullable().default(null), note: z.string().trim().max(1000).default(""),
    active: z.boolean().default(true) }).refine((item) => !item.calibratedAt || !item.nextCalibrationAt || item.nextCalibrationAt > item.calibratedAt, { message: INSTRUMENT_ORDER_MESSAGE, path: ["nextCalibrationAt"] }) }),
  z.object({ action: z.literal("remove_instrument"), id }),
]);
export type SelfInspectionAction = z.input<typeof selfInspectionActionSchema>;
export type ParsedSelfInspectionAction = z.output<typeof selfInspectionActionSchema>;

/**
 * The permission area `selfInspection` (beslut 3): every active member reads the current programme, confirms having
 * read it and reports a deviation; company admins edit, approve and manage the log. Checked on the server; the page only
 * draws what this returns.
 */
export const SELF_INSPECTION_PERMISSION_AREA = "selfInspection";
export function selfInspectionAccess(member: { active: boolean; admin: boolean }) {
  return { read: member.active, confirm: member.active, reportDeviation: member.active, edit: member.active && member.admin, approve: member.active && member.admin };
}
/** Which actions need edit (admin) rights; confirm_read and a new deviation report do not. */
export function actionNeedsAdmin(input: ParsedSelfInspectionAction) {
  // Roles per assignment follow the right to edit the project or task, checked where it is stored.
  if (input.action === "confirm_read" || input.action === "set_assignment" || input.action === "suggest_competence_change") return false;
  if (input.action === "save_deviation") return Boolean(input.deviation.id) || input.deviation.kind === "IMPROVEMENT";
  // Withdrawing is the reporter's own right too; the check against the entry is made where it is stored.
  if (input.action === "withdraw_deviation") return false;
  // Tillbud och olycksfall (2026-10-30): checked against the entry where it is stored (mayHandleDeviation).
  if (input.action === "save_investigation" || input.action === "mark_deviation_done" || input.action === "reopen_deviation" || input.action === "mark_reported_to_authority" || input.action === "set_deviation_hold") return false;
  return true;
}
/** How a withdrawn entry is handled: untouched (open, no plan, no work order) it is removed, otherwise kept and marked. */
export const WITHDRAWN_NOTE = "Raden som avvikelsen fördes från är borttagen ur protokollet.";
export function withdrawnDeviationKept(entry: Pick<ProgramDeviation, "status" | "action" | "workOrderId" | "followUp">) {
  return entry.status !== "OPEN" || Boolean(entry.action.trim()) || Boolean(entry.workOrderId);
}
export const withNoteOfWithdrawal = (followUp: string) => followUp.includes(WITHDRAWN_NOTE) ? followUp : [followUp.trim(), WITHDRAWN_NOTE].filter(Boolean).join("\n");
/** Who may withdraw an entry: an admin or the person who reported it. */
export const mayWithdraw = (entry: Pick<ProgramDeviation, "reportedById">, actor: { id: string; admin: boolean }) => actor.admin || entry.reportedById === actor.id;

export class SelfInspectionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

// ---------- rules ----------

/**
 * The content a version freezes (2026-10-06): the text, the facts, the roles with their people and the people's
 * competence, so a later change in the registers never alters an older version. Names come from `names` when given
 * (Cloud reads them from the people at approval), otherwise from what the draft kept. `people` is left out when nobody
 * has competence data, so versions approved before it existed keep their hash.
 */
export function programContent(program: DraftProgram, names?: Map<string, string>): ProgramContent {
  const nameOf = (personId: string, kept: string) => names?.get(personId) || kept;
  const people = (program.people ?? []).map((person) => ({ ...person, name: nameOf(person.personId, person.name), workTypes: [...person.workTypes].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv") || a.personId.localeCompare(b.personId));
  return {
    title: program.title, templateVersion: program.templateVersion, activityTypes: [...program.activityTypes].sort(), worksOnOthersInstallations: program.worksOnOthersInstallations,
    registrationCheckedAt: program.registrationCheckedAt,
    sections: [...program.sections].sort((a, b) => a.sortOrder - b.sortOrder).map(({ key, title, body, legalRef }) => ({ key, title, body, legalRef })),
    roles: [...program.roles].sort((a, b) => a.sortOrder - b.sortOrder).map((role) => ({
      key: role.key, name: role.name, description: role.description, duties: role.duties, isEre: role.isEre, capabilities: [...role.capabilities], level: toLevel(role.level),
      members: role.members.map(({ personId, name, authorizationLevel, registered }) => ({ personId, name: nameOf(personId, name), authorizationLevel, registered })),
    })),
    ...(people.length ? { people } : {}),
  };
}

/**
 * Whether two contents say the same thing regardless of how people's names read: a renamed person, or a version
 * approved before names were frozen, is not a change to approve again.
 */
export async function changeFingerprint(content: ProgramContent) {
  // A version from which an erased person's details were removed says the same as before (the marker is no content).
  const { people, redactions: _redactions, ...rest } = content;
  void _redactions;
  const plain = {
    ...rest,
    roles: rest.roles.map((role) => ({ ...role, members: role.members.map((member) => ({ ...member, name: "" })) })),
    ...(people?.length ? { people: people.map((person) => ({ ...person, name: "" })).sort((a, b) => a.personId.localeCompare(b.personId)) } : {}),
  };
  return contentHash(plain);
}

/**
 * Egenkontroll och GDPR (2026-10-10): what an approved version keeps about an erased person – the name and the
 * role (who was responsible), nothing else. The person's authorisation level goes from their role rows and their
 * competence assessment from `people`; a name that was not frozen at approval (versions before 2026-10-11) is frozen
 * from `name` now, so the version still says who held the role. `registered` (the ERE in the company's registration)
 * stays: it is a fact about the role. Returns null when there is nothing (left) to remove, so a second erasure changes nothing.
 */
export function redactPersonInContent(content: ProgramContent, personId: string, name: string, at: string): ProgramContent | null {
  const left = content.roles.some((role) => role.members.some((member) => member.personId === personId && (member.authorizationLevel || (!member.name && name))))
    || Boolean(content.people?.some((person) => person.personId === personId));
  if (!left) return null;
  const people = content.people?.filter((person) => person.personId !== personId);
  const { people: _people, ...rest } = content;
  void _people;
  return {
    ...rest,
    roles: content.roles.map((role) => ({ ...role, members: role.members.map((member) => member.personId === personId ? { ...member, name: member.name || name, authorizationLevel: "" as const } : member) })),
    ...(people?.length ? { people } : {}),
    redactions: [...(content.redactions ?? []).filter((item) => item.personId !== personId), { personId, at }],
  };
}

/** A stable SHA-256 of a version's content (WebCrypto, so Cloud, Local and the demo agree). */
export async function contentHash(content: ProgramContent) {
  const bytes = new TextEncoder().encode(stableJson(content));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

const PLACEHOLDER = /\[[^\]\n]{2,}\]/;

/**
 * What the automatic field check found (2026-10-06), in three kinds kept apart on the page:
 * - MISSING: base data the programme needs and does not have (activity types, ERE, who is responsible, competence),
 * - TEMPLATE: template text still to be replaced or read through,
 * - REMINDER: ordinary reminders (an empty section, an old registration check, a role without description).
 * It only checks that fields are filled in. It is never a legal review or an approval, and it never blocks (beslut 2).
 */
export type CheckKind = "MISSING" | "TEMPLATE" | "REMINDER";
export type ProgramCheck = { kind: CheckKind; text: string; /** The part of the document it concerns, for "Gå till". */ anchor?: string };
export const CHECK_KINDS: Record<CheckKind, { label: string; description: string }> = {
  MISSING: { label: "Grunduppgifter saknas", description: "Uppgifter som programmet behöver för att beskriva verksamheten." },
  TEMPLATE: { label: "Malltext kvar", description: "Text från mallen som ska ersättas eller läsas igenom." },
  REMINDER: { label: "Påminnelser", description: "Sådant som är bra att se över." },
};
export const CHECK_DISCLAIMER = "Kontrollen ser bara om fält är ifyllda. Den är ingen juridisk granskning och inget godkännande – företaget ansvarar för att programmet uppfyller kraven.";

/** Anchors in the document view, shared by the checks, the contents list and the editor. */
export const ANCHORS = { facts: "si-facts", roles: "si-roles", people: "si-people", history: "si-history", section: (index: number) => `si-section-${index}` } as const;

/** The roles whose people are responsible for the programme: the programme administrator, else the roles that approve it. */
export function responsibleRoles<T extends Pick<ProgramRole, "key" | "isEre" | "capabilities">>(roles: readonly T[]) {
  const admin = roles.filter((role) => role.key === "program_admin");
  return admin.length ? admin : roles.filter((role) => !role.isEre && role.capabilities.includes("approve"));
}

/**
 * Every person in the programme – with a role or with competence data – and what the programme says they may do. `level`
 * is the highest level among the roles (0 when the person has no role, or the roles come from a version approved before
 * levels existed).
 */
export type PersonOverview = { personId: string; name: string; roles: string[]; capabilities: RoleCapability[]; isEre: boolean; competence: PersonCompetence | null; level: number;
  /** The reader may not see this person's competence (2026-10-09: a member sees only their own) – never read as "missing". */
  competenceHidden: boolean };
export function peopleOverview(content: Pick<ProgramContent, "roles" | "people"> & Pick<ContentView, "peopleShownFor">): PersonOverview[] {
  const byId = new Map<string, PersonOverview>();
  for (const role of content.roles) for (const member of role.members) {
    const person = byId.get(member.personId) ?? { personId: member.personId, name: member.name, roles: [], capabilities: [], isEre: false, competence: null, level: 0, competenceHidden: false };
    person.name ||= member.name;
    person.roles.push(role.name);
    person.isEre ||= role.isEre;
    if (role.level) person.level = Math.max(person.level, role.level);
    for (const key of role.capabilities) if (!person.capabilities.includes(key)) person.capabilities.push(key);
    byId.set(member.personId, person);
  }
  for (const competence of content.people ?? []) {
    const person = byId.get(competence.personId) ?? { personId: competence.personId, name: competence.name, roles: [], capabilities: [], isEre: false, competence: null, level: 0, competenceHidden: false };
    person.name ||= competence.name;
    person.competence = competence;
    byId.set(competence.personId, person);
  }
  const order = (key: RoleCapability) => CAPABILITY_KEYS.indexOf(key);
  const shownFor = content.peopleShownFor;
  return [...byId.values()].map((person) => ({ ...person, capabilities: person.capabilities.sort((a, b) => order(a) - order(b)),
    competenceHidden: shownFor !== undefined && person.personId !== shownFor }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "sv"));
}

/** The draft's checks. Names should already be resolved (the view does it). */
export function programChecks(program: DraftProgram, today = swedishDayKey(new Date()), template?: readonly { key: string; body: string }[]): ProgramCheck[] {
  const checks: ProgramCheck[] = [];
  const add = (kind: CheckKind, text: string, anchor?: string) => checks.push({ kind, text, anchor });
  const sections = [...program.sections].sort((a, b) => a.sortOrder - b.sortOrder);
  const anchorOf = (key: string) => { const index = sections.findIndex((section) => section.key === key); return index < 0 ? undefined : ANCHORS.section(index); };
  const groups = new Set(program.activityTypes.map((key) => ACTIVITY_TYPES.find((type) => type.key === key)?.group));
  if (!program.activityTypes.length) add("MISSING", "Inga verksamhetstyper är valda (3 kap. 4 §).", ANCHORS.facts);
  const onlyCable = program.activityTypes.length > 0 && program.activityTypes.every((key) => key === "CABLE_LAYING");
  const eres = program.roles.filter((role) => role.isEre).flatMap((role) => role.members);
  if (!onlyCable && !eres.length) add("MISSING", "Ingen elinstallatör för regelefterlevnad är utsedd (3 kap. 6 §).", ANCHORS.roles);
  if (eres.length > 1 && !eres.some((member) => member.registered)) add("MISSING", "Flera elinstallatörer för regelefterlevnad är utsedda – markera vem som står i registreringen.", ANCHORS.roles);
  for (const group of groups) {
    if (!group || group === "SPECIAL") continue;
    const levels = ERE_LEVELS[group];
    const known = eres.filter((member) => member.authorizationLevel);
    if (known.length && !known.some((member) => levels.includes(member.authorizationLevel as AuthorizationLevel)))
      add("MISSING", `${ACTIVITY_GROUPS.find((item) => item.key === group)?.label}: elinstallatören för regelefterlevnad behöver auktorisation ${levels.join(" eller ")}.`, ANCHORS.roles);
  }
  if (!responsibleRoles(program.roles).some((role) => role.members.length)) add("MISSING", "Ingen ansvarig för programmet är utsedd (rollen Administratör för egenkontrollprogrammet).", ANCHORS.roles);
  if (!program.registrationCheckedAt) add("MISSING", "Ange när registreringen hos Elsäkerhetsverket senast kontrollerades.", ANCHORS.facts);
  // 3 kap. 5 och 9 §§: who does or inspects the work needs documented competence.
  const doers = peopleOverview({ roles: program.roles, people: program.people }).filter((person) => person.capabilities.some((key) => key === "perform" || key === "inspect"));
  const undocumented = doers.filter((person) => !person.competence?.assessment.trim());
  if (undocumented.length) add("MISSING", `Kompetensbedömning saknas för ${undocumented.map((person) => person.name || "en person").join(", ")} (3 kap. 5 och 9 §§).`, ANCHORS.people);
  for (const [index, section] of sections.entries()) {
    if (!section.body.trim()) add("REMINDER", `Avsnittet ”${section.title}” är tomt.`, ANCHORS.section(index));
    else if (PLACEHOLDER.test(section.body)) add("TEMPLATE", `Avsnittet ”${section.title}” har kvar platshållare inom [ ].`, ANCHORS.section(index));
  }
  if (template) {
    const original = new Map(template.map((item) => [item.key, item.body.trim()]));
    const untouched = sections.filter((section) => section.key && original.get(section.key) === section.body.trim() && !PLACEHOLDER.test(section.body));
    if (untouched.length) add("TEMPLATE", `${untouched.length === 1 ? "Ett avsnitt är" : `${untouched.length} avsnitt är`} oförändrade från mallen – läs igenom att texten stämmer för företaget: ${untouched.map((section) => section.title).join(", ")}.`, anchorOf(untouched[0].key));
  }
  for (const role of program.roles) if (!role.description.trim()) add("REMINDER", `Rollen ”${role.name}” saknar beskrivning.`, ANCHORS.roles);
  if (program.registrationCheckedAt && program.registrationCheckedAt < addMonths(today, -REVIEW_INTERVAL_MONTHS)) add("REMINDER", "Registreringen kontrollerades för mer än ett år sedan.", ANCHORS.facts);
  return checks;
}
/** The checks as plain lines (the approve dialog and older callers). */
export function programWarnings(program: DraftProgram, today = swedishDayKey(new Date())): string[] {
  return programChecks(program, today).map((check) => check.text);
}

/**
 * The minimum contents of a programme (ELSÄK-FS 2017:3 3 kap. 2–13 §§, consolidated with ELSÄK-FS 2021:5, checked
 * 2026-10-06 and again 2026-10-09: still in force and not replaced; ELSÄK-FS 2022:3 is about an owner's control of an
 * installation, not about installation companies), each in our own words, and apart from it what Workflow offers as
 * practical support – which no regulation asks for. A section covers a paragraph when its reference names it; that is all
 * the check can see.
 */
export const PROGRAM_REQUIREMENTS = [
  { paragraph: 2, ref: "3 kap. 2 §", requirement: "Programmet beskriver organisationen, systemen och rutinerna som gör att arbetet följer reglerna, omfattar hela den verksamhet företaget avser att bedriva, är dokumenterat och finns på ett språk som de som arbetar förstår.", support: "Versioner med kontrollsumma, Jag har läst per person." },
  { paragraph: 4, ref: "3 kap. 4 §", requirement: "Verksamheten: verksamhetstyper, vilka slags arbeten inom dem och om arbete görs på annans anläggning.", support: "Verksamhetstyperna som val i programmets uppgifter." },
  { paragraph: 5, ref: "3 kap. 5 §", requirement: "Kompetenskrav, vem som får göra vad eller hur kunskap bedöms, och en plan för att behålla och utveckla kompetensen.", support: "Personer och kompetens med arbeten, bedömning och begränsningar." },
  { paragraph: 6, ref: "3 kap. 6 §", requirement: "Vilka elinstallatörer för regelefterlevnad som utsetts; vid flera hur uppdraget fördelas och vem som står i registreringen.", support: "Rollen med markering för regelefterlevnad och registrering." },
  { paragraph: 7, ref: "3 kap. 7 §", requirement: "Organisationen för elinstallationsarbetet och egenkontrollen, minst de funktioner eller personer som har uppgifter i programmet.", support: "Organisationsschema och rollbeskrivningar ur rollerna." },
  { paragraph: 8, ref: "3 kap. 8 §", requirement: "Anläggningskännedom och kravbestämning inför varje arbete, och ny kravbestämning när förutsättningarna ändras.", support: "Projekt och arbetsorder som planeringens ram." },
  { paragraph: 9, ref: "3 kap. 9 §", requirement: "Att den som utför arbetet är auktoriserad eller omfattas av programmet och har den kompetens som behövs.", support: "Roller, Jag har läst och kompetens per person." },
  { paragraph: 10, ref: "3 kap. 10 §", requirement: "Kontrollens omfattning bestäms inför varje arbete.", support: "Valbara moment i protokollen." },
  { paragraph: 11, ref: "3 kap. 11 §", requirement: "Arbetet kontrolleras så som bestämts, och fel och brister hanteras och följs upp.", support: "Protokoll i Workflow och avvikelseloggen med handlingsplan." },
  { paragraph: 12, ref: "3 kap. 12 §", requirement: "Uppföljning som visar att rutinerna fungerar och att egenkontrollen räcker, och hur den görs.", support: "Avvikelseloggen, handlingsplanen och den årliga översynen." },
  { paragraph: 13, ref: "3 kap. 13 §", requirement: "Programmet uppdateras när något som har betydelse för egenkontrollen ändras och ses över minst en gång per år, med kontroll av att registreringen är aktuell.", support: "Årlig översyn med påminnelse i klockan; varje ändring fastställs som en ny version." },
] as const;

/** The paragraphs of ELSÄK-FS 2017:3 3 kap. a reference names ("3 kap. 10–11 §§", "3 kap. 8 och 9 §§"). */
export function referencedParagraphs(legalRef: string): number[] {
  const found = new Set<number>();
  for (const part of legalRef.split(/[;\n]/)) {
    if (!/2017:3/.test(part)) continue;
    const start = part.search(/\b3 kap\./);
    if (start < 0) continue;
    let rest = part.slice(start + "3 kap.".length);
    const next = rest.search(/\b\d+\s*kap\./);
    if (next >= 0) rest = rest.slice(0, next);
    for (const match of rest.matchAll(/(\d+)(?:\s*[–-]\s*(\d+))?/g)) {
      const from = Number(match[1]);
      const to = match[2] ? Number(match[2]) : from;
      for (let value = from; value <= to && value - from < 20; value++) found.add(value);
    }
  }
  return [...found].sort((a, b) => a - b);
}

export type RequirementCoverage = (typeof PROGRAM_REQUIREMENTS)[number] & { sections: { title: string; anchor: string }[] };
export function requirementCoverage(sections: readonly { title: string; legalRef: string }[]): RequirementCoverage[] {
  const refs = sections.map((section, index) => ({ title: section.title, anchor: ANCHORS.section(index), paragraphs: referencedParagraphs(section.legalRef) }));
  return PROGRAM_REQUIREMENTS.map((item) => ({ ...item, sections: refs.filter((ref) => ref.paragraphs.includes(item.paragraph)).map(({ title, anchor }) => ({ title, anchor })) }));
}

/** A calendar day moved whole months, kept on the month's last day when the day does not exist (31 → 30). */
export function addMonths(dayKey: string, months: number) {
  const [year, month, date] = dayKey.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}
const dayNumber = (key: string) => Date.parse(`${key}T00:00:00.000Z`) / 86_400_000;

/** A competence card is kept this many months after the person left the company, then deleted by the nightly job (2026-10-07). */
export const CREDENTIAL_RETENTION_MONTHS = 3;
/** The last day the card of a person who left on `leftAt` is kept – "Sparas till" – counted in Swedish days. */
export function credentialSavedUntil(leftAt: string | Date) {
  return addMonths(swedishDayKey(typeof leftAt === "string" ? new Date(leftAt) : leftAt), CREDENTIAL_RETENTION_MONTHS);
}
/** Whether the time to keep the card of a person who left has run out (the card is hidden at once and deleted that night). */
export const credentialExpired = (leftAt: string | Date, today = swedishDayKey(new Date())) => credentialSavedUntil(leftAt) < today;

// ---------- kompetenskort v2: the card's content, versions and who reads them ----------

/** What a card is made of, as Cloud reads it from its tables and Local from the document. */
export type CardSource = {
  trainings: { title: string; provider?: string; issuedAt: string | null; validUntil: string | null; note?: string; files?: readonly string[] }[];
  groups: readonly string[]; licenceClasses: readonly string[]; licenceValidUntil: string | null; languages: readonly { language: string; level: LanguageLevel }[];
};
const licenceOrder = (value: string) => { const index = (LICENCE_CLASSES as readonly string[]).indexOf(value); return index < 0 ? 99 : index; };
/** The card in a fixed order, so the same card always reads – and compares – the same. */
export function cardContent(source: CardSource): CardContent {
  return {
    trainings: source.trainings.map((item) => ({ title: item.title, provider: item.provider ?? "", issuedAt: item.issuedAt, validUntil: item.validUntil, note: item.note ?? "", files: [...(item.files ?? [])].sort() }))
      .sort((a, b) => a.title.localeCompare(b.title, "sv") || (a.issuedAt ?? "").localeCompare(b.issuedAt ?? "") || (a.validUntil ?? "").localeCompare(b.validUntil ?? "")),
    groups: [...source.groups].sort((a, b) => a.localeCompare(b, "sv")),
    licenceClasses: [...new Set(source.licenceClasses)].sort((a, b) => licenceOrder(a) - licenceOrder(b)),
    licenceValidUntil: source.licenceValidUntil,
    languages: source.languages.map(({ language, level }) => ({ language, level })),
  };
}
/** Whether a save changed the card; an unchanged save keeps no new version. */
export const cardChanged = (previous: CardContent | null | undefined, next: CardContent) => !previous || stableJson(cardContent(previous)) !== stableJson(cardContent(next));
/** The card of one person in the document (Local and the demo). */
export function documentCardContent(doc: Pick<SelfInspectionDocument, "credentials" | "competenceCards" | "competenceGroups">, personId: string): CardContent {
  const card = (doc.competenceCards ?? []).find((item) => item.personId === personId);
  const groups = new Map((doc.competenceGroups ?? []).map((group) => [group.id, group.name]));
  return cardContent({
    trainings: (doc.credentials ?? []).filter((item) => item.personId === personId).map((item) => ({ ...item, files: item.files.map((file) => file.filename) })),
    groups: (card?.groupIds ?? []).flatMap((groupId) => groups.has(groupId) ? [groups.get(groupId)!] : []),
    licenceClasses: card?.licenceClasses ?? [], licenceValidUntil: card?.licenceValidUntil ?? null, languages: card?.languages ?? [],
  });
}
/** Versions a Local file keeps per person (the oldest go first); Cloud keeps every version and reads the latest 50. */
export const LOCAL_CARD_VERSIONS = 100;
export const CARD_HISTORY_LIMIT = 50;
/**
 * Who reads a card and its history: the company's admins every card, also one kept after the person left; the person
 * their own card while a member. Nobody else – the card is personal data.
 */
export const mayReadCard = (viewer: { id: string; admin: boolean }, personId: string, leftAt: string | Date | null | undefined) => viewer.admin || (viewer.id === personId && !leftAt);
/** The history of a card, newest first, for a reader who may read it (otherwise empty: nothing says whether a card exists). */
export function cardHistory(doc: Pick<SelfInspectionDocument, "cardVersions" | "competenceCards" | "credentials">, personId: string, viewer: { id: string; admin: boolean }, names: ReadonlyMap<string, string> = new Map(), today = swedishDayKey(new Date())): CardVersion[] {
  const left = (doc.competenceCards ?? []).find((item) => item.personId === personId)?.leftAt ?? (doc.credentials ?? []).find((item) => item.personId === personId && item.leftAt)?.leftAt ?? null;
  if (!mayReadCard(viewer, personId, left) || (left && credentialExpired(left, today))) return [];
  return (doc.cardVersions ?? []).filter((item) => item.personId === personId).sort((a, b) => b.number - a.number).slice(0, CARD_HISTORY_LIMIT)
    .map((item) => ({ ...item, savedByName: names.get(item.savedById) || item.savedByName }));
}
/** The languages as stored (Cloud keeps them as JSON); anything that does not read is left out. */
export function cardLanguages(value: unknown): { language: string; level: LanguageLevel }[] {
  const parsed = z.array(languageSchema).max(20).safeParse(value);
  return parsed.success ? parsed.data : [];
}
/** The driving licence classes as stored; an unknown designation is left out. */
export const cardLicenceClasses = (value: readonly string[] | null | undefined) => (value ?? []).filter((item): item is LicenceClass => (LICENCE_CLASSES as readonly string[]).includes(item));
/** "B, BE · giltigt till 2030-05-01" – a driving licence in one line. */
export function licenceText(card: Pick<CompetenceCard, "licenceClasses" | "licenceValidUntil">) {
  if (!card.licenceClasses.length && !card.licenceValidUntil) return "";
  return [card.licenceClasses.join(", ") || "Behörighet inte angiven", card.licenceValidUntil ? `giltigt till ${card.licenceValidUntil}` : ""].filter(Boolean).join(" · ");
}

export type ReviewState = { lastReviewedAt: string | null; nextDue: string | null; status: "NONE" | "OK" | "DUE_SOON" | "OVERDUE" };
/** The yearly review: due a year after the latest review, or after the first approved version when none is made yet. */
export function reviewState(doc: Pick<SelfInspectionDocument, "versions" | "reviews">, today = swedishDayKey(new Date())): ReviewState {
  const first = [...doc.versions].sort((a, b) => a.number - b.number)[0];
  const last = [...doc.reviews].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))[0];
  if (!first) return { lastReviewedAt: last?.reviewedAt ?? null, nextDue: null, status: "NONE" };
  const anchor = last?.reviewedAt ?? swedishDayKey(new Date(first.approvedAt));
  const nextDue = addMonths(anchor, REVIEW_INTERVAL_MONTHS);
  const left = dayNumber(nextDue) - dayNumber(today);
  return { lastReviewedAt: last?.reviewedAt ?? null, nextDue, status: left < 0 ? "OVERDUE" : left <= REVIEW_REMINDER_DAYS ? "DUE_SOON" : "OK" };
}

export const latestVersion = (doc: Pick<SelfInspectionDocument, "versions">) => doc.versions.reduce<ProgramVersion | null>((latest, version) => !latest || version.number > latest.number ? version : latest, null);

// ---------- what a reader sees ----------

export type Person = { id: string; name: string };
/**
 * A version as one reader sees it. `peopleShownFor` is set on a member's view (2026-10-09): the people's competence
 * data is then only the reader's own row. It is never stored or hashed – the version itself keeps everyone's.
 */
export type ContentView = ProgramContent & { peopleShownFor?: string };
export type VersionView = Omit<ProgramVersion, "content"> & { content: ContentView; approvedByName: string };
/**
 * Who reads a person's competence assessment in the programme – the work, the assessment, limitations and supervision
 * (2026-10-09): the company's admins, who keep the programme, everyone's; anyone else only their own. Decided on the
 * server; Cloud, Local, the demo, the PDF and the tools all read the view this decides.
 */
export const mayReadCompetence = (viewer: { id: string; admin: boolean }, personId: string) => viewer.admin || viewer.id === personId;
/**
 * The linked work order as the log shows it (2026-10-10): its title and status only for a reader who may read work
 * orders (`readable`); anyone else reads "Arbetsorder kopplad".
 */
export type DeviationOrderView = { id: string; title: string; status: string; readable: boolean };
/** `canHandle`: the reader may mark it done, open it again, investigate it and mark it reported (./incidents.ts). */
export type DeviationView = ProgramDeviation & { mine: boolean; workOrder?: DeviationOrderView | null; canHandle?: boolean };
export type SelfInspectionView = {
  canEdit: boolean;
  canApprove: boolean;
  me: Person;
  company: string;
  /** People who can be given a role (admins only). */
  people: Person[];
  /** The draft (admins only), with the automatic field check and whether it differs from the latest version. */
  program: (DraftProgram & { warnings: string[]; checks: ProgramCheck[]; changedSinceApproval: boolean }) | null;
  hasProgram: boolean;
  current: VersionView | null;
  versions: VersionView[];
  myConfirmation: string | null;
  confirmations: { personId: string; name: string; confirmedAt: string | null }[] | null;
  review: ReviewState;
  reviews: ProgramReview[];
  deviations: DeviationView[];
  /** Avvikelse ↔ arbetsorder (2026-10-10): the reader may make a work order from an entry (the right to create work orders). */
  canCreateWorkOrder?: boolean;
  /** The entry a report just made (so its photos can be sent); only in the answer to that report. */
  createdDeviationId?: string;
  /** Photos can be added (Cloud; a Local file and the demo keep none). */
  photos?: boolean;
  /** Lagringstid (Cloud; ./retention.ts): the log shows its rule, and how many the reader may read reach a step within the warning time. */
  deviationRetention?: { soon: number };
  /** Who may be Ansvarig for a near miss or an accident (admins and Teamet, ./incidents.ts); absent = no limit known (Local's owner). */
  incidentResponsibleIds?: string[];
  /** Competence cards: every card for admins, a member's own otherwise (personal data). A card of a person who left is kept three months. */
  credentials: CredentialView[];
  /** Kompetenskort v2: the rest of the cards, read like the lines (admins all, a member their own while a member). */
  competenceCards: CompetenceCardView[];
  /** The company's competence groups: admins all of them, a member the ones on their own card. */
  competenceGroups: CompetenceGroup[];
  /** The instrument register: everyone reads it (to choose in a protocol), admins keep it. */
  instruments: InstrumentView[];
  /** Roles with levels and the company's risk classes (2026-10-07): the reader's own level, everyone's, and the classes set. */
  levels: LevelsView;
};

/** When a training runs out or an instrument is due for calibration: soon is within 30 days. */
export const DUE_REMINDER_DAYS = 30;
export type DueState = "NONE" | "OK" | "DUE_SOON" | "OVERDUE";
export function dueState(dueDay: string | null, today = swedishDayKey(new Date())): DueState {
  if (!dueDay) return "NONE";
  const left = dayNumber(dueDay) - dayNumber(today);
  return left < 0 ? "OVERDUE" : left <= DUE_REMINDER_DAYS ? "DUE_SOON" : "OK";
}
/** `savedUntil`: the day a card of a person who left is kept until (null for a person who is still a member). */
export type CredentialView = Credential & { state: DueState; savedUntil: string | null };
/** A card's groups by name and its driving licence's state (the bell reminds 30 days before, like a training). */
export type CompetenceCardView = CompetenceCard & { groupNames: string[]; licenceState: DueState; savedUntil: string | null };
/** The cards a reader sees, with the same rule as the lines (a card past its three months is hidden at once). */
export function visibleCards(doc: Pick<SelfInspectionDocument, "competenceCards" | "competenceGroups">, viewer: { id: string; admin: boolean }, nameOf: (personId: string, kept: string) => string, today = swedishDayKey(new Date())): CompetenceCardView[] {
  const groups = new Map((doc.competenceGroups ?? []).map((group) => [group.id, group.name]));
  return (doc.competenceCards ?? []).filter((card) => mayReadCard(viewer, card.personId, card.leftAt) && !(card.leftAt && credentialExpired(card.leftAt, today)))
    .map((card) => ({ ...card, name: nameOf(card.personId, card.name), groupNames: card.groupIds.flatMap((groupId) => groups.has(groupId) ? [groups.get(groupId)!] : []).sort((a, b) => a.localeCompare(b, "sv")),
      licenceState: dueState(card.licenceValidUntil, today), savedUntil: card.leftAt ? credentialSavedUntil(card.leftAt) : null }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
}
export type InstrumentView = Instrument & { state: DueState };
/**
 * The instrument register on its own page (2026-10-07): everyone reads it, admins keep it. `protocolsReadable`
 * (plan 1L, 2026-10-11): whether the person may read protocols at all, so "Protokoll med detta instrument" is offered.
 */
export type InstrumentsView = { canEdit: boolean; instruments: InstrumentView[]; protocolsReadable?: boolean };
/** Instrumentkoppling (2026-10-11): the protocols that chose an instrument from the register, newest first. */
export type InstrumentProtocolsView = { protocols: { id: string; title: string; status: string; updatedAt: string; completedAt: string | null }[] };

/**
 * The reader's view of the document. Members get the current version, their own confirmation and the deviations they
 * reported or are responsible for; admins everything. Names come from `people` when known (Cloud), otherwise from what the record kept.
 */
export async function selfInspectionView(doc: SelfInspectionDocument, viewer: { me: Person; admin: boolean; company: string; people: Person[]; activePeople?: Person[];
  /** The Teamet right (team:read): a near miss or an accident is seen by its reporter, admins and this (./incidents.ts). */
  team?: boolean;
  /** Cloud reads who has which level from the tables; Local and the demo derive it from the document. */
  levels?: LevelDirectory }, today = swedishDayKey(new Date())): Promise<SelfInspectionView> {
  const names = new Map(viewer.people.map((person) => [person.id, person.name]));
  const nameOf = (personId: string | null, fallback = "") => (personId && names.get(personId)) || fallback || "";
  // A version shows the names it froze, also of a person who has left or been erased since (2026-10-09: the names
  // stay in approved versions for traceability, as the programme itself says). Only a version from before names were
  // frozen reads today's name.
  const frozen = (personId: string, kept: string) => kept || nameOf(personId);
  const reader = { id: viewer.me.id, admin: viewer.admin };
  const withNames = (version: ProgramVersion): VersionView => ({
    ...version, approvedByName: version.approvedByName || nameOf(version.approvedById),
    content: {
      ...version.content,
      roles: version.content.roles.map((role) => ({ ...role, members: role.members.map((member) => ({ ...member, name: frozen(member.personId, member.name) })) })),
      // A member reads only their own competence assessment, admins everyone's (2026-10-09).
      ...(version.content.people ? { people: version.content.people.filter((person) => mayReadCompetence(reader, person.personId)).map((person) => ({ ...person, name: frozen(person.personId, person.name) })) } : {}),
      ...(viewer.admin ? {} : { peopleShownFor: viewer.me.id }),
    },
  });
  const latest = latestVersion(doc);
  const current = latest ? withNames(latest) : null;
  const confirmed = (personId: string) => latest ? doc.confirmations.find((item) => item.versionId === latest.id && item.personId === personId)?.confirmedAt ?? null : null;
  let program: SelfInspectionView["program"] = null;
  if (viewer.admin && doc.program) {
    const named = {
      ...doc.program,
      roles: doc.program.roles.map((role) => ({ ...role, members: role.members.map((member) => ({ ...member, name: nameOf(member.personId, member.name) })) })),
      people: (doc.program.people ?? []).map((person) => ({ ...person, name: nameOf(person.personId, person.name) })),
    };
    const checks = programChecks(named, today, TEMPLATE_SECTIONS);
    program = { ...named, checks, warnings: checks.map((check) => check.text),
      changedSinceApproval: latest ? (await changeFingerprint(programContent(named))) !== (await changeFingerprint(latest.content)) : true };
  }
  const deviationViewer: DeviationViewer = { id: viewer.me.id, admin: viewer.admin, team: viewer.admin || Boolean(viewer.team) };
  const deviations = doc.deviations.filter((item) => mayReadDeviation(deviationViewer, item)).sort((a, b) => b.number - a.number)
    .map((item) => ({ ...item, responsibleName: nameOf(item.responsibleId, item.responsibleName), reportedByName: nameOf(item.reportedById, item.reportedByName), mine: item.reportedById === viewer.me.id,
      ...(item.reportedToAuthorityById ? { reportedToAuthorityByName: nameOf(item.reportedToAuthorityById, item.reportedToAuthorityByName) } : {}), canHandle: mayHandleDeviation(deviationViewer, item) }));
  return {
    canEdit: viewer.admin, canApprove: viewer.admin, me: viewer.me, company: viewer.company,
    people: viewer.admin ? viewer.activePeople ?? viewer.people : [],
    program, hasProgram: Boolean(doc.program), current,
    versions: viewer.admin ? [...doc.versions].sort((a, b) => b.number - a.number).map(withNames) : [],
    myConfirmation: confirmed(viewer.me.id),
    confirmations: viewer.admin && latest ? (viewer.activePeople ?? viewer.people).map((person) => ({ personId: person.id, name: person.name, confirmedAt: confirmed(person.id) })) : null,
    review: reviewState(doc, today),
    reviews: viewer.admin ? [...doc.reviews].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || b.createdAt.localeCompare(a.createdAt)).map((item) => ({ ...item, reviewedByName: nameOf(item.reviewedById, item.reviewedByName) })) : [],
    deviations,
    // A card of a person who left stays three months (the nightly job deletes it); after that it is not shown even if the job has not run yet.
    // (A person who left reads nothing: the card is the company's to keep.)
    credentials: (doc.credentials ?? []).filter((item) => (viewer.admin || (item.personId === viewer.me.id && !item.leftAt)) && !(item.leftAt && credentialExpired(item.leftAt, today)))
      .map((item) => ({ ...item, name: nameOf(item.personId, item.name), state: dueState(item.validUntil, today), savedUntil: item.leftAt ? credentialSavedUntil(item.leftAt) : null }))
      .sort((a, b) => a.name.localeCompare(b.name, "sv") || a.title.localeCompare(b.title, "sv")),
    competenceCards: visibleCards(doc, { id: viewer.me.id, admin: viewer.admin }, (personId, kept) => nameOf(personId, kept), today),
    competenceGroups: (() => {
      const groups = [...(doc.competenceGroups ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "sv"));
      if (viewer.admin) return groups;
      const own = new Set((doc.competenceCards ?? []).find((card) => card.personId === viewer.me.id && !card.leftAt)?.groupIds ?? []);
      return groups.filter((group) => own.has(group.id));
    })(),
    instruments: [...(doc.instruments ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "sv")).map((item) => ({ ...item, state: item.active ? dueState(item.nextCalibrationAt, today) : "NONE" })),
    levels: levelsView(viewer.levels ?? documentLevels(doc, names), viewer.me.id, doc.riskClasses ?? {}),
  };
}

/**
 * Who has which level, from the draft's roles and the people's supervision flag (Local, the demo and the work context).
 * `ownerId`: the owner of a Local file is its only user and the programme's administrator, so the owner counts as level 3
 * there whether or not the owner is named in a role – the people named in the file are checked, the owner is not locked out.
 */
export function documentLevels(doc: Pick<SelfInspectionDocument, "program">, names: ReadonlyMap<string, string> = new Map(), ownerId?: string): LevelDirectory {
  const program = doc.program;
  const directory = levelDirectory(program?.roles ?? [], (program?.people ?? []).filter((person) => person.supervised).map((person) => person.personId), names);
  if (!ownerId) return directory;
  const owner = directory.people.find((person) => person.personId === ownerId);
  return { enforced: directory.enforced, people: owner
    ? directory.people.map((person) => person.personId === ownerId ? { ...person, level: 3, supervised: false } : person)
    : [...directory.people, { personId: ownerId, name: names.get(ownerId) ?? "", level: 3, supervised: false, roles: [], inspects: false }] };
}

/** The bell's reminders straight from the document (no hashing), for the notification route, Local and the demo. */
export function documentReminders(doc: SelfInspectionDocument, viewer: { me: Person; admin: boolean; team?: boolean }, today = swedishDayKey(new Date())) {
  const latest = latestVersion(doc);
  return selfInspectionReminders({
    canEdit: viewer.admin, me: viewer.me, team: viewer.team,
    current: latest ? { ...latest, approvedByName: latest.approvedByName } : null,
    myConfirmation: latest ? doc.confirmations.find((item) => item.versionId === latest.id && item.personId === viewer.me.id)?.confirmedAt ?? null : null,
    review: reviewState(doc, today),
    deviations: doc.deviations.filter((item) => mayReadDeviation({ id: viewer.me.id, admin: viewer.admin, team: viewer.team }, item)).map((item) => ({ ...item, mine: item.reportedById === viewer.me.id })),
    // No reminders for a person who has left the company.
    credentials: (doc.credentials ?? []).filter((item) => !item.leftAt && (viewer.admin || item.personId === viewer.me.id)).map((item) => ({ ...item, state: dueState(item.validUntil, today), savedUntil: null })),
    competenceCards: visibleCards(doc, { id: viewer.me.id, admin: viewer.admin }, (_personId, kept) => kept, today).filter((card) => !card.leftAt),
    instruments: viewer.admin ? (doc.instruments ?? []).filter((item) => item.active).map((item) => ({ ...item, state: dueState(item.nextCalibrationAt, today) })) : [],
  }, today).map((item) => ({ ...item, kind: "SELF_INSPECTION" as const }));
}

/**
 * One entry in the deviation log (Avvikelse ↔ arbetsorder, 2026-10-10). A reminder about a deviation opens that entry, not
 * only the log's first page (dashboard etapp 3, 2026-10-28) – on a phone too, where it is a screen of its own.
 */
export const deviationHref = (id: string) => `/?view=deviations&deviation=${encodeURIComponent(id)}`;

/**
 * The deviation log's filters (dashboard etapp 3, 2026-10-28), also from the address (`&filter=`): open entries, the
 * open ones past their Klart senast (the reminders' "OVERDUE"), the open ones I am responsible for, or every entry.
 */
export const DEVIATION_FILTERS = ["open", "overdue", "mine", "all"] as const;
export type DeviationFilter = (typeof DEVIATION_FILTERS)[number];
export const DEVIATION_FILTER_LABEL: Record<DeviationFilter, string> = { open: "Öppna", overdue: "Förfallna", mine: "Mina", all: "Alla" };
export const isDeviationOverdue = (item: { status: string; dueDate?: string | null }, today: string) => item.status !== "DONE" && Boolean(item.dueDate) && item.dueDate! < today;
/**
 * The desktop's filter row (2026-10-31, "mer som" Uppgifter and Offerter): Mina | Alla as its own choice (`&scope=`), then
 * the status chips; the old `filter=mine` (dashboard links, the phone) reads as Mina + Öppna.
 */
export const DEVIATION_SCOPES = ["mine", "all"] as const;
export type DeviationScope = (typeof DEVIATION_SCOPES)[number];
export const DEVIATION_STATUS_FILTERS = ["open", "overdue", "all"] as const satisfies readonly DeviationFilter[];
export const deviationInScope = (item: { responsibleId?: string | null }, scope: DeviationScope, meId: string) => scope === "all" || (Boolean(meId) && item.responsibleId === meId);
/** Free-text search in the log: number, heading, text, action and responsible. */
export function deviationSearchMatches(item: { number?: number | string | null; title?: string | null; description?: string | null; action?: string | null; responsibleName?: string | null }, query: string) {
  const words = query.trim().toLocaleLowerCase("sv").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [item.number, item.title, item.description, item.action, item.responsibleName].filter(Boolean).join(" ").toLocaleLowerCase("sv");
  return words.every((word) => text.includes(word));
}
/** The type filter beside them (2026-10-30): every type, or one. */
export const DEVIATION_TYPE_FILTERS = ["any", "SELF_INSPECTION", "RISK_OBSERVATION", "NEAR_MISS", "ACCIDENT"] as const;
export type DeviationTypeFilter = (typeof DEVIATION_TYPE_FILTERS)[number];
export const DEVIATION_TYPE_FILTER_LABEL: Record<DeviationTypeFilter, string> = { any: "Alla typer", ...DEVIATION_TYPES };
export const deviationTypeMatches = (item: { type?: string | null }, filter: DeviationTypeFilter) => filter === "any" || (item.type ?? "SELF_INSPECTION") === filter;
export function deviationMatches(item: { status: string; dueDate?: string | null; responsibleId?: string | null }, filter: DeviationFilter, input: { meId: string; today: string }) {
  switch (filter) {
    case "open": return item.status !== "DONE";
    case "overdue": return isDeviationOverdue(item, input.today);
    case "mine": return item.status !== "DONE" && Boolean(input.meId) && item.responsibleId === input.meId;
    case "all": return true;
  }
}

/** Reminders for the bell: the yearly review (admins), an unread current version, and overdue actions. */
export type SelfInspectionReminder = { id: string; title: string; label?: string; detail?: string; href: string; dueDate: string; deadline: "OVERDUE" | "DUE_SOON" | null; needsAction: boolean; audience?: "mine" | "team"; selfReported?: boolean };
export function selfInspectionReminders(view: Pick<SelfInspectionView, "canEdit" | "current" | "myConfirmation" | "review" | "deviations" | "me"> & Partial<Pick<SelfInspectionView, "credentials" | "instruments" | "competenceCards">> & { /** The Teamet right (team:read). */ team?: boolean }, today = swedishDayKey(new Date())): SelfInspectionReminder[] {
  const items: SelfInspectionReminder[] = [];
  // Anmälningspliktigt (användartest 2026-10-31, fel 3): a near miss or an accident to report to the authority the same day
  // is told to the company's admins and to those with the Teamet right – who may mark it reported – first and as needing
  // action, until someone marks it reported or it is done. Its Allvarlighetsgrad is left as the person chose.
  if (view.canEdit || view.team) for (const item of view.deviations) {
    if (item.status === "DONE" || !awaitsAuthorityReport(item)) continue;
    items.push({ id: `self-inspection:reportable:${item.id}`, label: "Avvikelse", title: `${REPORTABLE_LABEL}: ${DEVIATION_TYPES[deviationType(item.type)]} ${item.number}: ${item.title}`, detail: SERIOUS_NOTICE,
      href: deviationHref(item.id), dueDate: "", deadline: null, needsAction: true });
    if (items.length >= 10) break;
  }
  const typeWord = (item: SelfInspectionView["deviations"][number]) => item.kind === "IMPROVEMENT" ? DEVIATION_KINDS.IMPROVEMENT : DEVIATION_TYPES[deviationType(item.type)];
  // Kräver åtgärd (beslut 4, 2026-11-01; replaces TE7's "until someone is responsible"): an entry of the grade Hög or Akut stands
  // here until it is done – for those who oversee the log (admins and the Teamet right, within what they may read) and for the
  // person responsible for it. Someone who reported it and has no such right has done their part; the one who reported it and
  // does oversee it sees the row but is not mailed about it. Local has one user, who is never told what they reported themselves.
  // The row's date stays empty, so that a changed date is not a new notice: the date is in the text.
  const severeShown = (item: SelfInspectionView["deviations"][number]) => items.some((shown) => shown.id === `self-inspection:severe:${item.id}`);
  const reportableShown = (item: SelfInspectionView["deviations"][number]) => items.some((shown) => shown.id === `self-inspection:reportable:${item.id}`);
  for (const item of view.deviations) {
    if (item.status === "DONE" || (item.severity !== "HIGH" && item.severity !== "ACUTE") || reportableShown(item)) continue;
    const mine = item.responsibleId === view.me.id;
    const selfReported = item.reportedById === view.me.id;
    if (selfReported ? !view.team : !(view.canEdit || view.team || mine)) continue;
    const about = item.responsibleId ? item.action : "Ny avvikelse utan ansvarig.";
    items.push({ id: `self-inspection:severe:${item.id}`, label: mine ? "Tilldelad dig" : "Avvikelse", title: `${DEVIATION_SEVERITIES[item.severity]}: ${typeWord(item)} ${item.number}: ${item.title}`,
      detail: [about, item.dueDate ? `Klart senast ${item.dueDate}.` : ""].filter(Boolean).join(" ") || undefined,
      href: deviationHref(item.id), dueDate: "", deadline: null, needsAction: true, audience: mine ? "mine" : "team", ...(selfReported ? { selfReported: true } : {}) });
    if (items.length >= 10) break;
  }
  // An open entry made someone's, as "Tilldelad dig", until they start on it (TE7, användartest 2026-10-31).
  const assignedOpen = (item: SelfInspectionView["deviations"][number]) => item.status === "OPEN" && item.responsibleId === view.me.id && item.reportedById !== view.me.id;
  for (const item of view.deviations) {
    if (!assignedOpen(item) || reportableShown(item) || severeShown(item)) continue;
    items.push({ id: `self-inspection:assigned:${item.id}`, label: "Tilldelad dig", title: `${typeWord(item)} ${item.number}: ${item.title}`, detail: item.action || undefined,
      href: deviationHref(item.id), dueDate: item.dueDate, deadline: isDeviationOverdue(item, today) ? "OVERDUE" : null, needsAction: false });
    if (items.length >= 12) break;
  }
  if (view.canEdit && (view.review.status === "DUE_SOON" || view.review.status === "OVERDUE"))
    items.push({ id: "self-inspection:review", title: "Årlig översyn av egenkontrollprogrammet", detail: "Gå igenom programmet, avvikelserna och registreringen hos Elsäkerhetsverket.",
      href: "/?view=self_inspection&tab=review", dueDate: view.review.nextDue ?? "", deadline: view.review.status, needsAction: false });
  if (view.current && !view.myConfirmation)
    items.push({ id: `self-inspection:read:${view.current.number}`, title: `Läs egenkontrollprogrammet, version ${view.current.number}`, detail: "Bekräfta med knappen Jag har läst när du har tagit del av det.",
      href: "/?view=self_inspection", dueDate: "", deadline: null, needsAction: true });
  const soon = new Date((dayNumber(today) + 7) * 86_400_000).toISOString().slice(0, 10);
  for (const item of view.deviations) {
    if (item.status === "DONE" || !item.dueDate || item.dueDate > soon || reportableShown(item) || severeShown(item) || items.some((shown) => shown.id === `self-inspection:assigned:${item.id}`)) continue;
    if (!view.canEdit && item.responsibleId !== view.me.id) continue;
    if (view.canEdit && item.responsibleId && item.responsibleId !== view.me.id && item.dueDate >= today) continue;
    items.push({ id: `self-inspection:deviation:${item.id}`, label: "Avvikelse", title: `${DEVIATION_KINDS[item.kind]} ${item.number}: ${item.title}`, detail: item.action || undefined,
      href: deviationHref(item.id), dueDate: item.dueDate, deadline: isDeviationOverdue(item, today) ? "OVERDUE" : "DUE_SOON", needsAction: false });
    if (items.length >= 12) break;
  }
  // Etapp 3: a training or certificate that runs out within 30 days (the person's own, or everyone's for admins) and
  // an instrument due for calibration (admins).
  for (const item of view.credentials ?? []) {
    if ((item.state !== "DUE_SOON" && item.state !== "OVERDUE") || item.leftAt) continue;
    const own = item.personId === view.me.id;
    items.push({ id: `self-inspection:credential:${item.id}`, title: `${item.state === "OVERDUE" ? "Har gått ut" : "Går ut snart"}: ${item.title}${own ? "" : ` (${item.name || "en person"})`}`,
      detail: "Kompetenskortet i egenkontrollen.", href: "/?view=self_inspection&tab=competence", dueDate: item.validUntil ?? "", deadline: item.state, needsAction: false });
    if (items.length >= 20) return items;
  }
  // Kompetenskort v2 (2026-10-08): a driving licence that runs out within 30 days, and – for admins – a person's suggestion.
  for (const card of view.competenceCards ?? []) {
    if (card.leftAt) continue;
    const own = card.personId === view.me.id;
    if ((card.licenceState === "DUE_SOON" || card.licenceState === "OVERDUE") && (own || view.canEdit))
      items.push({ id: `self-inspection:licence:${card.personId}`, title: `${card.licenceState === "OVERDUE" ? "Har gått ut" : "Går ut snart"}: körkort${own ? "" : ` (${card.name || "en person"})`}`,
        detail: "Kompetenskortet i egenkontrollen.", href: "/?view=self_inspection&tab=competence", dueDate: card.licenceValidUntil ?? "", deadline: card.licenceState, needsAction: false });
    if (view.canEdit && card.suggestion.trim())
      items.push({ id: `self-inspection:card-suggestion:${card.personId}:${card.suggestedAt ?? ""}`, title: `Förslag till kompetenskortet: ${card.name || "en person"}`, detail: card.suggestion.slice(0, 160),
        href: "/?view=self_inspection&tab=competence", dueDate: "", deadline: null, needsAction: true });
    if (items.length >= 20) return items;
  }
  for (const item of view.instruments ?? []) {
    if (!item.active || (item.state !== "DUE_SOON" && item.state !== "OVERDUE")) continue;
    items.push({ id: `self-inspection:instrument:${item.id}`, title: `Kalibrering: ${item.name}${item.serialNumber ? ` (S/N ${item.serialNumber})` : ""}`,
      detail: "Instrumentregistret.", href: "/?view=instruments", dueDate: item.nextCalibrationAt ?? "", deadline: item.state, needsAction: false });
    if (items.length >= 20) return items;
  }
  return items;
}
