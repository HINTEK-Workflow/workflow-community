import type { ControlData } from "@/lib/kfid/model";
import type { ProjectStatus } from "@/lib/workflow/project-status";
export type ControlItem = {
  id: string;
  number?: number;
  title: string;
  project: string;
  performer: string;
  date: string;
  status: string;
  version: number;
  deletedAt: string | null;
  updatedAt: string;
  postedAt: string | null;
  customerId: string | null;
  projectId?: string | null;
  siteId?: string | null;
  departmentId?: string | null;
  lastOpenedAt: string | null;
  createdByName?: string;
  updatedByName?: string;
  siteName?: string | null;
  departmentName?: string | null;
  completion?: {
    complete: boolean;
    errors: number;
    warnings: number;
    percent: number;
  };
};
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
  customerId: string | null;
  /** Linked customer facility (decision 11). */
  facilityId?: string | null;
  facility?: { id: string; name: string; address: string; postalCode: string; city: string } | null;
  updatedAt: string;
  responsibleUserId?: string | null;
  responsibleName?: string;
  timeBudgetMinutes?: number;
  archivedAt?: string | null;
  closedAt?: string | null;
  /** Reported minutes whose Swedish day lies outside the project's frame. */
  outsideFrameMinutes?: number;
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
  version: number;
  deletedAt: string | null;
  /** The customer's facilities (decision 11), active and paused. */
  facilities?: FacilityItem[];
};
import type { FacilityItem } from "@/lib/workflow/customer-facility";
import type { Preferences } from "@/lib/kfid/preferences";
export type { Preferences } from "@/lib/kfid/preferences";
export { defaultPreferences } from "@/lib/kfid/preferences";
export type Overview = {
  reports: {
    id: string;
    controlId: string;
    kind: string;
    createdAt: string;
  }[];
  globalSuggestions: Record<string, string[]>;
  /** Only the most recently changed control, for the editor's shortcut; lists are read separately and paged. */
  controls: ControlItem[];
  projects: ProjectItem[];
  wallet: { balance: number; testMode: boolean };
  entries: {
    id: string;
    amount: number;
    description: string;
    createdAt: string;
  }[];
  entryCount?: number;
  settings: {
    companyName: string;
    contactEmail: string;
    logoPath: string | null;
    themePrimary: string | null;
    reportPrimary: string;
    reportAccent: string;
    reportSoft: string;
    suggestions: Record<string, string[]>;
  } | null;
  preferences: Partial<Preferences>;
  organization: {
    id: string;
    name: string;
    slug: string;
    domain: string | null;
    storageMode: "LOCAL" | "HINTEK_CLOUD";
  };
  admin: boolean;
  canDeleteControls: boolean;
  workflowPermissions: import("@/lib/workflow/permissions").WorkflowPermissionProfile;
  testAdmin: boolean;
  aiEnabled: boolean;
  aiConfigured: boolean;
  paymentsEnabled: boolean;
  paymentSandbox: boolean;
  legalRequired: boolean;
};
export type AttachmentItem = {
  id: string;
  filename: string;
  mimeType: string;
  section: string;
  rowId: string | null;
  url?: string;
};
export type LoadedControl = ControlItem & {
  data: ControlData;
  attachments: AttachmentItem[];
  revisions: { id: string; version: number; createdAt: string }[];
  /** Reported time and the caller's own running timer (Cloud; Local reads them from the file). */
  totalDurationSec?: number;
  timerRunning?: boolean;
};
