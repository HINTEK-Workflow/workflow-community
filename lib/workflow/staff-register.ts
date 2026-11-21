import { z } from "zod";

/**
 * Personalliggare, steg 0 (2026-10-08, docs/proposals/personalliggare-regler-2026-10-08.md): the project records
 * that the building site keeps a staff register and where staff check in; Workflow reminds the person who starts time.
 * Steg 1 (2026-10-09, docs/proposals/personalliggare-krav-2026-10-11.md): "Personalliggaren förs i Workflow"
 * turns on Workflow's own register for the project (lib/staff-register/), with check-in, Kontrollvy and export.
 */
export type StaffRegister = {
  /** "Personalliggare krävs" on the building site. */
  required: boolean;
  /** "Personalliggaren förs i Workflow" (steg 1); otherwise the staff check in in the system on site. Cloud only. */
  inWorkflow: boolean;
  /** "Byggarbetsplatsens id-nummer", given by the tax agency when the byggherre registers the site. */
  siteId: string;
  /** "Byggherre", free text. */
  builder: string;
  /** "System på plats", e.g. the main contractor's system, free text. */
  system: string;
};

export const EMPTY_STAFF_REGISTER: StaffRegister = { required: false, inWorkflow: false, siteId: "", builder: "", system: "" };
export const STAFF_REGISTER_SITE_ID_MAX = 40;
export const STAFF_REGISTER_TEXT_MAX = 200;
export const STAFF_REGISTER_SITE_ID_ERROR = "Byggarbetsplatsens id-nummer får bara innehålla bokstäver, siffror och bindestreck.";
/** Short help in the project form; no legal advice beyond this (2026-10-08). */
export const STAFF_REGISTER_HELP = "Personalen checkar in i byggherrens system på plats, eller i Workflow om liggaren förs här. Workflow påminner den som startar tid i projektet.";
export const STAFF_REGISTER_IN_WORKFLOW_HELP = "Personalen checkar in och ut på projektets sida. Kontrollvyn visar vem som är på plats vid ett kontrollbesök.";
export const STAFF_REGISTER_SITE_ID_NEEDED = "Ange byggarbetsplatsens id-nummer. Det ska stå i personalliggaren.";
/**
 * 2026-10-09 evening: "Elinstallation kan omfattas. Låt ansvarig aktivera personalliggaren per byggarbetsplats,
 * eftersom undantag finns. Aktivera den inte automatiskt för alla projekt." One neutral line, no quoted law text.
 */
export const STAFF_REGISTER_SCOPE_HINT = "Företaget avgör om arbetet på byggarbetsplatsen omfattas av kravet på personalliggare.";
export const STAFF_REGISTER_ACTIVATION_DENIED = "Bara projektansvarig eller en företagsadministratör kan slå på eller av personalliggaren i Workflow.";

/** Without the requirement nothing else is kept, so a switched-off register leaves no names behind. */
function normalize(value: StaffRegister): StaffRegister {
  if (!value.required) return { ...EMPTY_STAFF_REGISTER };
  // The system on site is the alternative to Workflow's own register, so it is not kept beside it.
  return value.inWorkflow ? { ...value, system: "" } : value;
}

/** What the project form, the API, Local and the demo accept. */
export const staffRegisterInputSchema = z.object({
  required: z.boolean().default(false),
  inWorkflow: z.boolean().default(false),
  siteId: z.string().trim().max(STAFF_REGISTER_SITE_ID_MAX, `Byggarbetsplatsens id-nummer får vara högst ${STAFF_REGISTER_SITE_ID_MAX} tecken.`).regex(/^[\p{L}\p{N} -]*$/u, STAFF_REGISTER_SITE_ID_ERROR).default(""),
  builder: z.string().trim().max(STAFF_REGISTER_TEXT_MAX, `Byggherre får vara högst ${STAFF_REGISTER_TEXT_MAX} tecken.`).default(""),
  system: z.string().trim().max(STAFF_REGISTER_TEXT_MAX, `System på plats får vara högst ${STAFF_REGISTER_TEXT_MAX} tecken.`).default(""),
}).refine((value) => !value.required || !value.inWorkflow || value.siteId.length > 0, { message: STAFF_REGISTER_SITE_ID_NEEDED, path: ["siteId"] }).transform(normalize);

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

/** Reads a stored value leniently (the database column, an older .hwf file without the field, an import). */
export function staffRegisterOf(value: unknown): StaffRegister {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_STAFF_REGISTER };
  const record = value as Record<string, unknown>;
  return normalize({
    required: record.required === true,
    inWorkflow: record.inWorkflow === true,
    siteId: text(record.siteId, STAFF_REGISTER_SITE_ID_MAX),
    builder: text(record.builder, STAFF_REGISTER_TEXT_MAX),
    system: text(record.system, STAFF_REGISTER_TEXT_MAX),
  });
}

/** The toast shown after Starta tid on a task in a project that requires a staff register; null otherwise. */
export function staffRegisterReminder(project: { staffRegister?: unknown } | null | undefined): string | null {
  const register = staffRegisterOf(project?.staffRegister);
  if (!register.required) return null;
  if (register.inWorkflow) return "Checka in i personalliggaren.";
  const details = [register.siteId ? `Byggarbetsplatsens id-nr: ${register.siteId}.` : "", register.system ? `System på plats: ${register.system}.` : ""].filter(Boolean);
  return ["Checka in i personalliggaren på plats.", ...details].join(" ");
}

/** The site id row for the project fields shown in tasks and printed in report headers (kept minimal). */
export function staffRegisterSiteRow(project: { staffRegister?: unknown }): readonly [string, string] | null {
  const register = staffRegisterOf(project.staffRegister);
  return register.required && register.siteId ? ["Byggarbetsplatsens id-nr", register.siteId] as const : null;
}

/** Every row for the project's own "Om projektet" panel. */
export function staffRegisterRows(project: { staffRegister?: unknown }): (readonly [string, string])[] {
  const register = staffRegisterOf(project.staffRegister);
  if (!register.required) return [];
  return ([
    ["Personalliggare", register.inWorkflow ? "Förs i Workflow" : "Krävs på byggarbetsplatsen"],
    ["Byggarbetsplatsens id-nr", register.siteId],
    ["Byggherre", register.builder],
    ["System på plats", register.system],
  ] as const).filter(([, value]) => value);
}

/** The project keeps Workflow's own register (steg 1): check-in, Kontrollvy and export are offered. */
export function keepsWorkflowRegister(project: { staffRegister?: unknown } | null | undefined) {
  const register = staffRegisterOf(project?.staffRegister);
  return register.required && register.inWorkflow;
}

/**
 * Whether a save switches Workflow's own register on or off for the project (null: unchanged). The register is never
 * switched on by itself: a project starts without it and only an explicit choice in the project form changes it.
 */
export function staffRegisterActivationChange(before: unknown, after: unknown): "on" | "off" | null {
  const was = keepsWorkflowRegister({ staffRegister: before });
  const is = keepsWorkflowRegister({ staffRegister: after });
  return was === is ? null : is ? "on" : "off";
}

/**
 * The register an import (.hwf to Cloud) writes: an import never switches Workflow's register on, and a project that
 * already keeps it keeps it unchanged (switching on or off is the responsible person's own choice in the project form).
 */
export function importedStaffRegister(incoming: unknown, current?: unknown): StaffRegister {
  if (keepsWorkflowRegister({ staffRegister: current })) return staffRegisterOf(current);
  return staffRegisterOf({ ...staffRegisterOf(incoming), inWorkflow: false });
}

/**
 * Who may switch Workflow's register on or off for a building site (2026-10-09 evening): a company admin, or the
 * project's responsible member who may edit (for a new project: create) projects. Being responsible alone grants nothing.
 */
export function canSwitchStaffRegister(input: { admin: boolean; userId: string; responsibleUserId: string | null | undefined; canEditProjects: boolean }) {
  return input.admin || (input.canEditProjects && Boolean(input.responsibleUserId) && input.responsibleUserId === input.userId);
}

/**
 * Checka in här / Checka ut on a job (2026-10-12). Shown only when the job's project keeps Workflow's own register
 * and the project is open; it only reads the state and calls the same check-in as the project page. It never switches the
 * register on and grants nothing: the server decides every right again.
 */
export type JobCheckInState = { kind: "IN" | "OUT"; label: string; sinceAt: string | null; needsIdNumber: boolean };

export function jobCheckIn(
  project: { staffRegister?: unknown; archivedAt?: string | null; closedAt?: string | null } | null | undefined,
  status: { access: { self: boolean }; writable?: boolean; me: { person: unknown; onSite: boolean; since: string | null } } | null | undefined,
): JobCheckInState | null {
  if (!project || !status || !keepsWorkflowRegister(project) || project.archivedAt || project.closedAt) return null;
  if (!status.access.self || status.writable === false) return null;
  const onSite = status.me.onSite;
  return { kind: onSite ? "OUT" : "IN", label: onSite ? "Checka ut" : "Checka in här", sinceAt: onSite ? status.me.since : null, needsIdNumber: !status.me.person };
}

/** The status line next to the button: "Incheckad 07:12" or "Inte incheckad". */
export function jobCheckInText(state: JobCheckInState, formatTime: (value: string) => string) {
  return state.kind === "OUT" ? (state.sinceAt ? `Incheckad ${formatTime(state.sinceAt)}` : "Incheckad") : "Inte incheckad";
}
