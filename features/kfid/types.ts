import type { ProjectStatus } from "@/lib/workflow/project-status";
import type { StaffRegister } from "@/lib/workflow/staff-register";
export type ProjectItem = {
  id: string;
  name: string;
  description: string;
  dueDate: string;
  /** Project frame start (YYYY-MM-DD, or empty for older projects without a frame). */
  startDate?: string;
  client?: string;
  contactPerson?: string;
  reference?: string;
  workSite?: string;
  /** Personalliggare, steg 0 (2026-10-08): absent in older payloads, read as "not required". */
  staffRegister?: StaffRegister;
  customerId: string | null;
  /** Linked customer facility (decision 11). */
  facilityId?: string | null;
  facility?: { id: string; name: string; address: string; postalCode: string; city: string } | null;
  updatedAt: string;
  responsibleUserId?: string | null;
  responsibleName?: string;
  /** Ställföreträdare för bokningar (2026-10-09): may change others' bookings in the project, beside the responsible. */
  planningDelegateUserId?: string | null;
  timeBudgetMinutes?: number;
  archivedAt?: string | null;
  closedAt?: string | null;
  /** Reported minutes whose Swedish day lies outside the project's frame. */
  outsideFrameMinutes?: number;
  /** Projekttid (2026-10-26): the project's own reported time without a work order, in seconds. */
  projectTimeSec?: number;
  /** Computed by the shared project status function (Cloud: the server, Local: the open file). */
  status?: ProjectStatus;
  events?: ProjectHistoryItem[];
  eventCount?: number;
  /** The append-only decision log: Cloud sends the newest ten and a count; Local sends the whole file. */
  decisions?: ProjectDecisionItem[];
  decisionCount?: number;
  taskTypes?: ("WORK_ORDER" | "RISK_ASSESSMENT" | "COMMISSIONING_CONTROL")[];
  workMoments?: ("START_TIME" | "EXECUTION" | "SIGN_REPORT" | "CLOSE_ORDER")[];
};
export type ProjectDecisionItem = {
  id: string;
  /** The day the decision was made (YYYY-MM-DD). */
  decidedOn: string;
  text: string;
  decidedBy: string;
  /** Who entered it in Workflow. */
  actorName: string;
  createdAt: string;
};
export type ProjectHistoryItem = {
  id: string;
  kind: string;
  summary: string;
  taskId?: string | null;
  actorName: string;
  createdAt: string;
};
export type CustomerItem = {
  id: string;
  name: string;
  company: string;
  address: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  mobile: string;
  lat: number | null;
  lng: number | null;
  notes: string;
  /** Särskilda krav (2026-10-07): the customer's requirements beyond the ordinary way of working; absent in an older file. */
  specialRequirements?: string;
  /** Kundtyp (2026-10-10): Företag or Privatperson; absent in an older file, which reads as a company. */
  customerType?: "COMPANY" | "PRIVATE";
  /** Kundnummer i bokföringen (2026-10-11); absent in an older file. */
  accountingCustomerNumber?: string;
  /** Eget företag (2026-10-24): the company's own record for its own places; never in the register. */
  ownCompany?: boolean;
  version: number;
  deletedAt: string | null;
  /** The customer's facilities (decision 11), active and paused. */
  facilities?: FacilityItem[];
};
import type { FacilityItem } from "@/lib/workflow/customer-facility";
import type { Preferences } from "@/lib/kfid/preferences";
import type { CreditSummary } from "@/lib/credits/wallet-summary";
export type { Preferences } from "@/lib/kfid/preferences";
export { defaultPreferences } from "@/lib/kfid/preferences";
export type Overview = {
  projects: ProjectItem[];
  wallet: { balance: number; testMode: boolean };
  /** Usable credits and their validity (lib/credits/wallet-summary.ts, 2026-10-28); admins only, null otherwise. */
  credits?: CreditSummary | null;
  entries: {
    id: string;
    amount: number;
    description: string;
    createdAt: string;
  }[];
  entryCount?: number;
  /** Every project in the company; `projects` carries a bounded set of choices. */
  projectCount?: number;
  settings: {
    companyName: string;
    contactEmail: string;
    logoPath: string | null;
    /** Loggans varianter (2026-11-13), lib/kfid/logo-variants.ts. */
    logoOnDarkPath?: string | null;
    logoOnLightPath?: string | null;
    logoBlackPath?: string | null;
    themePrimary: string | null;
    reportPrimary: string;
    reportAccent: string;
    reportSoft: string;
    /** Underhåll (2026-10-06, B1); missing = off. */
    maintenance?: boolean;
    /** Arbetet är redan utfört i riskbedömningen (Arbetssätt): on unless turned off. */
    riskException?: boolean;
    /** The company's own details (Företagsuppgifter); the organisation number is shown in Ställ in Workflow. */
    profile?: { organizationNumber?: string; workAreas?: unknown } | null;
  } | null;
  preferences: Partial<Preferences>;
  organization: {
    id: string;
    name: string;
    slug: string;
    domain: string | null;
    storageMode: "LOCAL" | "HINTEK_CLOUD";
    /** Företagets moduler (0.39.0): the optional modules the company has turned off; missing = all on. */
    disabledModules?: string[];
  };
  admin: boolean;
  canDeleteControls: boolean;
  workflowPermissions: import("@/lib/workflow/permissions").WorkflowPermissionProfile;
  /** Priser på materialraden (2026-10-09): whether the person may see prices, and the company's markup; absent in Local and the demo. */
  prices?: { visible: boolean; markupPercent: string };
  testAdmin: boolean;
  aiEnabled: boolean;
  aiConfigured: boolean;
  paymentsEnabled: boolean;
  paymentSandbox: boolean;
  legalRequired: boolean;
};
