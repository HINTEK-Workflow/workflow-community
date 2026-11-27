import { companySenderOf } from "@/lib/kfid/company";
import type { KitIdentity } from "@/lib/workflow/report-kit";
import type { Overview } from "./types";

/**
 * The company's name, report colours, logo and sender for a PDF drawn in the browser (Local), read from the same settings
 * as Cloud's workflowReportIdentity (lib/workflow/report-server.ts): Företagsinställningar and Företagsuppgifter. The logo is
 * fetched from /api/files/logo, the same file the shell shows; one that cannot be read is left out (PDF review 2026-11-03,
 * finding 1). `fallbackName` is the open file's company name, used when no settings are saved.
 */
export async function localReportIdentity(overview: Pick<Overview, "settings">, fallbackName: string): Promise<KitIdentity> {
  const settings = overview.settings;
  const logoBytes = settings?.logoPath
    ? await fetch("/api/files/logo", { cache: "no-store" }).then(async (response) => response.ok ? new Uint8Array(await response.arrayBuffer()) : null).catch(() => null)
    : null;
  return {
    company: settings?.companyName || fallbackName,
    branding: settings ? { primary: settings.reportPrimary, accent: settings.reportAccent, soft: settings.reportSoft } : null,
    logoBytes,
    sender: companySenderOf(settings?.profile),
  };
}
