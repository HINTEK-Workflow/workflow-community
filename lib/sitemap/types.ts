/**
 * Webbplatskartan (2026-10-24): the data scripts/sitemap/generate.cjs works out of the repository at build time and
 * app/api/superadmin/sitemap serves to the superadmin alone. Types only, so the page and the tests read the same shape.
 */

/** Who reaches a box or a line: the product owner, a customer company's admin, a member (preset Utföra arbete). */
export const SITEMAP_ROLES = ["superadmin", "admin", "member"] as const;
export type SitemapRole = (typeof SITEMAP_ROLES)[number];

export type SitemapRef = { file: string; line: number | null; text?: string };

export type SitemapNodeKind = "view" | "variant" | "group" | "entry" | "popup" | "public" | "step" | "section" | "modal" | "dead" | "service";

export type SitemapNode = {
  id: string;
  kind: SitemapNodeKind;
  label: string;
  level: number;
  parent: string | null;
  /** The function colour (--type-*). */
  type: string;
  view?: string;
  address?: string;
  note?: string;
  cond?: string;
  valid?: boolean;
  inDemo?: boolean;
  phoneHidden?: boolean;
  reach?: string;
  dead?: boolean;
  step?: string;
  section?: string;
  old?: boolean;
  /** A single item (a job, a customer …) and what hangs under it; hidden by default. */
  item?: boolean;
  roles: SitemapRole[];
  /** Provat i appen (scripts/sitemap/observed.json): the robot's runs ("admin-phone" …) that reached the box; empty = only in the code. */
  tested?: string[];
  /** A box the robot reached that the code's map did not know. */
  robotOnly?: boolean;
  /** The roles the robot actually met (QA's roles): Visa som follows them where the robot tried. */
  appRoles?: SitemapRole[];
  /** The robot's verdict per role: visas, nekas, pekar om, bara adressen, inte i menyn. */
  probe?: Partial<Record<SitemapRole, string>>;
  /** An outside service (kind "service", lib/integrations/external-services.ts): what it is for and whose key it uses. */
  service?: SitemapService;
  refs: SitemapRef[];
};

/** Externa tjänster (2026-10-25): names, purposes and where things are administered – never a key value or hint. */
export type SitemapService = {
  purpose: string;
  direction: "out" | "in" | "both";
  directionLabel: string;
  owner: "central" | "company" | "issued" | "none";
  ownerLabel: string;
  /** What the key is, in words. */
  key: string;
  /** The central keys' names (lib/secrets/central-fields.ts). */
  fields?: string[];
  /** The company key's provider (IntegrationKey). */
  company?: string;
  admin: string[];
  usedBy: string[];
  incoming: string[];
  hosts: string[];
  via?: string;
  modules: string[];
};

export type SitemapServiceOwner = { key: SitemapService["owner"]; label: string; note: string; type: string };

export type SitemapEdge = {
  from: string;
  to: string;
  cat: string;
  label?: string;
  cond?: string;
  device?: "desktop" | "phone" | "both";
  dead?: boolean;
  reason?: string;
  shared?: boolean;
  always?: boolean;
  also?: string[];
  roles: SitemapRole[];
  /** The robot's runs that followed the line; empty = only in the code. */
  tested?: string[];
  /** A way the robot followed that the code does not have (the line kind "robot"). */
  robotOnly?: boolean;
  appRoles?: SitemapRole[];
  refs: SitemapRef[];
};

export type SitemapCat = { key: string; label: string; color: string; on: boolean; dash: string };

type Anomaly = { id: string; note: string; refs?: SitemapRef[] };
export type SitemapAnomalies = {
  noIncoming: Anomaly[];
  multiMenu: { id: string; device: string; ways: string[]; byDefault: boolean }[];
  oneDevice: { id: string; device: string; note: string }[];
  dead: { from: string; to: string; reason: string; refs?: SitemapRef[] }[];
  oldAddress: { from: string; to: string; refs?: SitemapRef[] }[];
  sameName?: Anomaly[];
  /** Provat i appen: the robot's findings (rättat/öppet/avfärdat), ways and boxes only it found, roles that disagree, Bakåt. */
  observed?: SitemapObservation[];
};

export type SitemapObservation = {
  id: string;
  to?: string;
  kind: "finding" | "robotNode" | "robotEdge" | "roleMap" | "back";
  /** The finding's own kind: h1, axe, http, console, role, search, ui, back. */
  sub?: string;
  title: string;
  status: string;
  commit?: string;
  note?: string;
  runs: string[];
  address?: string;
  also?: string[];
};

export type SitemapObserved = {
  date: string | null;
  commit: string | null;
  target: string | null;
  runs: { run: string; role: SitemapRole; device: "desktop" | "phone"; pages: number; links: number; popups: number }[];
  back: { checks: number; ok: number; notTried: number; wrong: number } | null;
  counts: { boxes: number; boxesTested: number; pages: number; pagesTested: number; edges: number; edgesTested: number; robotNodes: number; robotEdges: number; findings: number; fixed: number; open: number; dismissed: number };
  byRole: Record<SitemapRole, number>;
};

export type SitemapData = {
  generated: string;
  version: string;
  repo: string;
  branch: string;
  commit: string;
  cats: SitemapCat[];
  roles: SitemapRole[];
  nodes: SitemapNode[];
  edges: SitemapEdge[];
  anomalies: SitemapAnomalies;
  /** The click robot's round, when scripts/sitemap/observed.json is there. */
  observed?: SitemapObserved;
  /** The legend for whose key an outside service uses (when the map has services). */
  serviceOwners?: SitemapServiceOwner[];
  stats: { views: number; pages: number; nodes: number; edges: number; modals: number; dynamicLinks: number; scannedFiles: number; services?: number; byRole: Record<SitemapRole, number> };
};
