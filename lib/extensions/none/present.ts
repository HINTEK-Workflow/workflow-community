// Without ee/ (Fas 2): see lib/extensions/types.ts.
export const EE_PRESENT = false;

/**
 * The installation's legal documents (2026-09-30): each page shows the operator's own text from legal/<key>.md,
 * or a short description of what the document is for (lib/legal/installation-documents.ts).
 */
export const LEGAL_LINKS = [
  { key: "terms", label: "Tjänstevillkor" },
  { key: "privacy", label: "Integritetspolicy" },
  { key: "dpa", label: "DPA" },
] as const;

/** Workflow's own information pages (sub-processors, support) are in ee/; an installation without it has none. */
export const LEGAL_INFO_PAGES: readonly { key: string; label: string }[] = [];

/** Rapportera fel eller förslag is Workflow's own (ee/): no form, so no link to one. */
export const REPORT_PATH: string | null = null;
