import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * An installation's own legal documents (2026-09-30). Whoever runs Workflow is responsible for its terms, so the
 * community edition carries no terms of its own: each page shows the operator's text from legal/<key>.md in the
 * installation folder (LEGAL_DIR changes the folder), or – until that file exists – a few lines on what the document
 * is for and where to put it.
 */
export const INSTALLATION_DOCUMENTS = {
  terms: {
    title: "Tjänstevillkor",
    purpose: [
      "Tjänstevillkoren är avtalet mellan den som driver den här installationen och de företag och personer som använder den.",
      "De beskriver vad tjänsten omfattar, vad var och en ansvarar för, vad som gäller för data och säkerhet, eventuell betalning, uppsägning och vad som händer vid fel eller avbrott.",
    ],
  },
  privacy: {
    title: "Integritetspolicy",
    purpose: [
      "Integritetspolicyn talar om vilka personuppgifter som behandlas i den här installationen och varför.",
      "Den ska bland annat beskriva ändamål och rättslig grund, hur länge uppgifterna sparas, vilka som får ta del av dem och hur den registrerade utövar sina rättigheter enligt dataskyddsförordningen (GDPR), samt vem som är personuppgiftsansvarig och hur man kontaktar den.",
    ],
  },
  dpa: {
    title: "Personuppgiftsbiträdesavtal (DPA)",
    purpose: [
      "Personuppgiftsbiträdesavtalet reglerar hur den som driver installationen behandlar personuppgifter för kundföretagens räkning, enligt artikel 28 i dataskyddsförordningen.",
      "Det beskriver bland annat vilka uppgifter som behandlas, för vilket ändamål, vilka säkerhetsåtgärder som gäller, vilka underbiträden som anlitas och vad som händer med uppgifterna när avtalet upphör.",
    ],
  },
} as const;

export type InstallationDocumentKey = keyof typeof INSTALLATION_DOCUMENTS;

export const isInstallationDocument = (key: string): key is InstallationDocumentKey => key in INSTALLATION_DOCUMENTS;

/** The operator's own text, or null when the file is missing or empty. */
export async function readInstallationDocument(key: InstallationDocumentKey): Promise<string | null> {
  const folder = path.resolve(process.env.LEGAL_DIR?.trim() || path.join(process.cwd(), "legal"));
  try {
    const content = await readFile(path.join(folder, `${key}.md`), "utf8");
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}
