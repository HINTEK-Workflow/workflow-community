// Licensregeln (2026-11-02): what the lock file may hold. A strong copyleft licence or a package without a licence stops
// tests/license-policy.test.ts unless a person has looked at it and it is listed here with the reason. This is an engineering
// check of the licences the packages state, not a legal assessment: docs/drift/LICENSER_OCH_CRA.md has what lawyers must look at.

/** GPL, AGPL and SSPL. LGPL is not caught (the word boundary): the sharp packages' LGPL is documented in the notices and in the document above. */
export const STRONG_COPYLEFT = /(^|[^A-Za-z])(A?GPL|SSPL)([^A-Za-z]|$)/i;

/** Reviewed: a dual licence where the permissive choice is made. Exact version of the text, so a changed licence stops again. */
export const REVIEWED = {
  jszip: { licence: "(MIT OR GPL-3.0-or-later)", chosen: "MIT", why: "Dubbellicens; Workflow använder den under MIT. Följer med via exceljs." },
};

/**
 * Open questions: allowed for now only because they are written down here and in the document, and reported every time. An entry
 * here is no statement that the package is fine. Remove the entry when the package is replaced or its author has answered.
 */
export const OPEN_QUESTIONS = {
  // buffers@0.1.1 (no licence, via exceljs → unzipper 0.10 → binary) was the only entry until 2026-11-20; package.json now
  // makes exceljs use unzipper ^0.12, which does not depend on binary or buffers.
};

/** The edition's own licence (the root of a lock is the product, not a dependency). */
export const OWN_LICENCES = new Set([undefined, "AGPL-3.0-only"]);

const nameOf = (path, entry) => entry?.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);

/** → { problems: string[], reviewed: string[], open: string[] } for a parsed package-lock.json. */
export function licenceReport(lock) {
  const problems = [];
  const reviewed = [];
  const open = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path) {
      if (!OWN_LICENCES.has(entry.license)) problems.push(`Produkten anger licensen ${entry.license}.`);
      continue;
    }
    if (entry.link) continue;
    const name = nameOf(path, entry);
    const id = `${name}@${entry.version ?? ""}`;
    const licence = entry.license;
    const asked = OPEN_QUESTIONS[name];
    if (!licence) {
      if (asked && asked.version === entry.version) open.push(id);
      else problems.push(`${id}: ingen licens angiven`);
      continue;
    }
    if (STRONG_COPYLEFT.test(String(licence))) {
      if (REVIEWED[name]?.licence === licence) reviewed.push(id);
      else problems.push(`${id}: ${licence}`);
    }
  }
  return { problems, reviewed, open };
}
