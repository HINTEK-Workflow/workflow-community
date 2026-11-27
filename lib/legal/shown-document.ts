import { LEGAL_INFO_PAGES, LEGAL_LINKS } from "@ee/present";
import { serverExtensions } from "@/lib/extensions/server";
import { INSTALLATION_DOCUMENTS, isInstallationDocument, readInstallationDocument } from "@/lib/legal/installation-documents";

export type ShownLegalDocument =
  | { kind: "text"; title: string; version: string | null; content: string }
  | { kind: "purpose"; title: string; purpose: readonly string[]; file: string };

/**
 * The legal documents (2026-09-30): Workflow's published texts come from ee/; any other installation shows its
 * own file from legal/<key>.md, or a short description of what the document is for until the operator has added it.
 * Shared by the page (app/(public)/legal/[document]) and the sitemap, which lists only documents with a text.
 */
export async function shownLegalDocument(key: string): Promise<ShownLegalDocument | null> {
  // The information pages (sub-processors, support) come only from ee/: an installation without it has no such page.
  if (!LEGAL_LINKS.some((link) => link.key === key) && !LEGAL_INFO_PAGES.some((page) => page.key === key)) return null;
  const hintek = await serverExtensions.legalDocument(key);
  if (hintek) return { kind: "text", ...hintek };
  if (!isInstallationDocument(key)) return null;
  const entry = INSTALLATION_DOCUMENTS[key];
  const own = await readInstallationDocument(key);
  return own ? { kind: "text", title: entry.title, version: null, content: own }
    : { kind: "purpose", title: entry.title, purpose: entry.purpose, file: `legal/${key}.md` };
}

/** The keys of the legal documents that have a text (a page with only the purpose is not worth a search hit). */
export async function legalKeysWithText(): Promise<string[]> {
  const keys = [...LEGAL_LINKS, ...LEGAL_INFO_PAGES].map((link) => link.key);
  const shown = await Promise.all(keys.map(async (key): Promise<string | null> => ((await shownLegalDocument(key))?.kind === "text" ? key : null)));
  return shown.filter((key): key is string => key !== null);
}
