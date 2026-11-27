/**
 * Tillbud och olycksfall i avvikelseloggen (2026-10-30). The rules as pure functions, so Cloud
 * (lib/self-inspection/server.ts and every route that reads the log), Local (the .hwf file) and the demo decide alike:
 * 1. Every entry has a type: Elinstallation (SELF_INSPECTION, the default, everything from before), Riskobservation, Tillbud or Olycksfall.
 * 2. Tillbud and Olycksfall are seen only by their reporter, the company's admins and members with the Teamet right
 *    (team:read). Egenkontroll and Riskobservation keep the log's rule: admins all, others what they reported or answer for.
 * 3. Tillbud and Olycksfall need when it happened, Vad hände, Varför and Åtgärd before they can be marked done.
 * 4. Allvarligt: Workflow shows where to report it and keeps who marked it reported; it never sends anything itself.
 * No database code here; no text, form or table from any authority – only links to their own pages.
 */

// SELF_INSPECTION is shown as Elinstallation (2026-10-30): a deviation in the electrical installation work; "Egenkontroll" alone was too broad.
export const DEVIATION_TYPES = { SELF_INSPECTION: "Elinstallation", RISK_OBSERVATION: "Riskobservation", NEAR_MISS: "Tillbud", ACCIDENT: "Olycksfall" } as const;
export type DeviationType = keyof typeof DEVIATION_TYPES;
export const DEVIATION_TYPE_KEYS = Object.keys(DEVIATION_TYPES) as [DeviationType, ...DeviationType[]];
/** The types only a few may see (rule 2). */
export const INCIDENT_TYPES = ["NEAR_MISS", "ACCIDENT"] as const satisfies readonly DeviationType[];
/** The types that keep the log's own rule. */
export const OPEN_TYPES = ["SELF_INSPECTION", "RISK_OBSERVATION"] as const satisfies readonly DeviationType[];
export const isIncidentType = (type: string | null | undefined): boolean => type === "NEAR_MISS" || type === "ACCIDENT";
export const deviationType = (type: string | null | undefined): DeviationType => type && type in DEVIATION_TYPES ? type as DeviationType : "SELF_INSPECTION";

/** Photos on an entry: taken when it is reported (Före) or when it is marked done (Efter). */
export const DEVIATION_PHOTO_PHASES = { BEFORE: "Före", AFTER: "Efter" } as const;
export type DeviationPhotoPhase = keyof typeof DEVIATION_PHOTO_PHASES;
/** At most this many photos per entry (both phases together). */
export const DEVIATION_PHOTO_LIMIT = 20;

/** Links to the authorities' own pages (never their text). */
export const WORK_INJURY_REPORT_URL = "https://www.anmalarbetsskada.se";
export const ELECTRICAL_ACCIDENT_REPORT_URL = "https://www.elsakerhetsverket.se/om-oss/kontakta-oss/gor-en-anmalan";
export const SERIOUS_NOTICE = "Ska anmälas till Arbetsmiljöverket samma dag.";
/**
 * Anmälningspliktig (2026-10-31: "per definition så man inte anmäler för mindre saker"): the mark is set only for what
 * the law requires reported (arbetsmiljölagen 3 kap. 3 a §), said in our own words; the employer decides, Workflow never sends.
 * A minor injury is an accident with a low Allvarlighetsgrad, not reportable.
 */
export const REPORTABLE_LABEL = "Anmälningspliktig";
export const REPORTABLE_HINT = "Dödsfall, svår personskada, skada på flera samtidigt eller tillbud med allvarlig fara för liv eller hälsa. Inte mindre skador som ett skärsår. Arbetsgivaren avgör.";
/** Arbetsmiljöverket's own page on what is reported (a link, never its text). */
export const REPORTABLE_GUIDE_URL = "https://www.av.se/arbetsmiljoarbete-och-inspektioner/arbetsgivarens-ansvar-for-arbetsmiljon/anmal-arbetsskada-dodsfall-och-allvarliga-tillbud-till-arbetsmiljoverket/";

export type DeviationViewer = { id: string; admin: boolean; /** The Teamet right (team:read); admins have it anyway. */ team?: boolean };
export type DeviationAccessEntry = { type?: string | null; reportedById: string; responsibleId?: string | null };

/** Rule 2: who reads an entry (the list, one entry, counts, reminders, photos, tools – everything that reads the log). */
export function mayReadDeviation(viewer: DeviationViewer, entry: DeviationAccessEntry): boolean {
  if (viewer.admin || entry.reportedById === viewer.id) return true;
  if (isIncidentType(entry.type)) return Boolean(viewer.team);
  return Boolean(entry.responsibleId) && entry.responsibleId === viewer.id;
}

/**
 * Who handles an entry – Markera klar, Öppna igen, the investigation and Markera som anmäld: an admin, the person
 * responsible for it, and for a near miss or an accident also whoever has the Teamet right. Always someone who may read it.
 */
export function mayHandleDeviation(viewer: DeviationViewer, entry: DeviationAccessEntry): boolean {
  if (!mayReadDeviation(viewer, entry)) return false;
  return viewer.admin || (Boolean(entry.responsibleId) && entry.responsibleId === viewer.id) || (isIncidentType(entry.type) && Boolean(viewer.team));
}

/**
 * Rule 2 as a database filter on SelfInspectionDeviation (Prisma `where`, combined with AND by the caller): admins every
 * entry; anyone else the open types they reported or answer for, and the incidents they reported – or all of them with Teamet.
 */
export function deviationReadWhere(viewer: DeviationViewer) {
  if (viewer.admin) return {};
  return {
    OR: [
      { type: { in: [...OPEN_TYPES] }, OR: [{ reportedById: viewer.id }, { responsibleUserId: viewer.id }] },
      { type: { in: [...INCIDENT_TYPES] }, ...(viewer.team ? {} : { reportedById: viewer.id }) },
    ],
  };
}

export type InvestigationFields = { type?: string | null; occurredAt?: string | null; whatHappened?: string | null; cause?: string | null; action: string };

/** What is missing in a near miss's or an accident's investigation (rule 3); empty for the other types. */
export function missingInvestigation(entry: InvestigationFields): string[] {
  if (!isIncidentType(entry.type)) return [];
  return [
    entry.occurredAt ? "" : "när det hände",
    entry.whatHappened?.trim() ? "" : "vad som hände",
    entry.cause?.trim() ? "" : "varför",
    entry.action.trim() ? "" : "åtgärd",
  ].filter(Boolean);
}

/**
 * Markera klar with what is missing filled in there (2026-11-02): what the dialog sends is laid over the entry; a field left out
 * or empty keeps what is stored, so a close can never empty the investigation. An entry that is not a near miss or an accident ignores it.
 */
export type CloseInvestigation = { occurredAt?: string | null; whatHappened?: string; cause?: string; plan?: string };
export function closedInvestigation<T extends InvestigationFields>(entry: T, sent: CloseInvestigation | undefined): T {
  if (!sent || !isIncidentType(entry.type)) return entry;
  return {
    ...entry,
    occurredAt: sent.occurredAt || entry.occurredAt,
    whatHappened: sent.whatHappened?.trim() || entry.whatHappened,
    cause: sent.cause?.trim() || entry.cause,
    action: sent.plan?.trim() || entry.action,
  };
}

/** Rule 3: why an entry cannot be marked done now, or null. Checked on the server before every close. */
export function deviationCloseRefusal(entry: InvestigationFields): string | null {
  const missing = missingInvestigation(entry);
  if (!missing.length) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} och ${missing[missing.length - 1]}`;
  return `Fyll i ${list} innan ${DEVIATION_TYPES[deviationType(entry.type)].toLowerCase()}et markeras klart.`;
}

/**
 * Anmälningspliktig och inte markerad som anmäld (användartest 2026-10-31, fel 3): a serious near miss or accident that is
 * still open for the report – marked in the log's rows and on Översikt, and told to admins and Teamet in the bell. The
 * Allvarlighetsgrad is the person's own choice and is never changed by it.
 */
export function awaitsAuthorityReport(entry: { type?: string | null; serious?: boolean | null; reportedToAuthorityAt?: Date | string | null }): boolean {
  return isIncidentType(entry.type) && Boolean(entry.serious) && !entry.reportedToAuthorityAt;
}

/** awaitsAuthorityReport as a database filter on SelfInspectionDeviation (combined with the read rule by the caller). */
export const REPORTABLE_WHERE = { type: { in: [...INCIDENT_TYPES] }, serious: true, reportedToAuthorityAt: null };

/** Only a serious near miss or accident is marked reported to the authority. */
export function reportToAuthorityRefusal(entry: { type?: string | null; serious?: boolean | null; reportedToAuthorityAt?: string | null }): string | null {
  if (!isIncidentType(entry.type) || !entry.serious) return "Bara ett allvarligt tillbud eller olycksfall markeras som anmält.";
  if (entry.reportedToAuthorityAt) return "Det är redan markerat som anmält.";
  return null;
}

/** The incident fields as stored: only a near miss or an accident keeps them (another type stores them empty). */
export function incidentFields(value: { type?: string | null; occurredAt?: string | null; whatHappened?: string | null; cause?: string | null; serious?: boolean | null; personalInjury?: boolean | null; electrical?: boolean | null }) {
  const incident = isIncidentType(value.type);
  return {
    type: deviationType(value.type),
    occurredAt: incident ? value.occurredAt ?? null : null,
    whatHappened: incident ? value.whatHappened ?? "" : "",
    cause: incident ? value.cause ?? "" : "",
    serious: incident && Boolean(value.serious),
    personalInjury: incident && Boolean(value.personalInjury),
    electrical: incident && Boolean(value.electrical),
  };
}

/**
 * Ansvarig for a near miss or an accident (2026-10-30, privacy first): only an admin or someone with the Teamet
 * right, who may read it anyway – being responsible never opens an entry on its own. `person` is the chosen member's
 * rights (null when unknown). Null means allowed.
 */
export const INCIDENT_RESPONSIBLE_REFUSAL = "Ansvarig för ett tillbud eller olycksfall kan bara vara en administratör eller någon som får se Teamet.";
export function incidentResponsibleRefusal(type: string | null | undefined, responsibleId: string | null | undefined, person: { admin: boolean; team?: boolean } | null | undefined): string | null {
  if (!isIncidentType(type) || !responsibleId) return null;
  return person && (person.admin || person.team) ? null : INCIDENT_RESPONSIBLE_REFUSAL;
}

/**
 * Allvarlighetsgrad (2026-10-30, the field SelfInspectionDeviation.severity): Låg · Normal · Hög · Akut, chosen when
 * an entry is reported (Normal from the start). An older document or row without it is Normal. A Förbättring has none
 * (it is kept Normal and not shown). The step is the shared scale the list tints its cards with.
 */
export const DEVIATION_SEVERITIES = { LOW: "Låg", NORMAL: "Normal", HIGH: "Hög", ACUTE: "Akut" } as const;
export type DeviationSeverity = keyof typeof DEVIATION_SEVERITIES;
export const DEVIATION_SEVERITY_KEYS = Object.keys(DEVIATION_SEVERITIES) as [DeviationSeverity, ...DeviationSeverity[]];
export const DEFAULT_DEVIATION_SEVERITY: DeviationSeverity = "NORMAL";
/** The step on the yellow → orange → red scale (2026-10-30): Låg light yellow, Normal amber, Hög orange, Akut red. */
export const DEVIATION_SEVERITY_STEP = { LOW: 1, NORMAL: 2, HIGH: 3, ACUTE: 4 } as const satisfies Record<DeviationSeverity, 1 | 2 | 3 | 4>;
/** The stored value as a severity; anything else (an older row or file, an unknown word) is Normal. */
export const deviationSeverity = (value: string | null | undefined): DeviationSeverity => value && value in DEVIATION_SEVERITIES ? value as DeviationSeverity : DEFAULT_DEVIATION_SEVERITY;
