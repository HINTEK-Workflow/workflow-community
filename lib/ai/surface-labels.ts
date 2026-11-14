// Where in Workflow an AI run was made, in the words the person saw there. Shared by the superadmin's usage page and
// the company's credit history.
export const AI_SURFACE_LABELS: Record<string, string> = { chat: "Chatten", "chat-page": "Chatten på en sida", tip: "Fråga Workflow AI från ett tips", summary: "Skriv med AI (sammanfattning)", import: "Import", "proposal-work-order": "Föreslå arbetsorder", "proposal-risk-measures": "Föreslå åtgärder", "proposal-planning": "Föreslå planering", review: "Granska med AI", digest: "Dagsammanställning", "post-series": "Innehållsserie (utkast till inlägg)", "azure-probe": "Prov av EU-leverantören (Workflow)" };
export const AI_AGENT_LABELS: Record<string, string> = { "workflow-assistant": "Chatten (äldre körningar)", "document-import": "Import (äldre körningar)", "kfid-control-review": "Kontrollgranskning" };

type ReservedRun = { status: string; surface: string | null; agentId: string };

/**
 * The line in the credit history. An AI reservation is written before the answer with the most it may cost; once the
 * run is done that row is the charge, so it says what the credits went to instead of "reserverad maxkostnad" (data
 * check 2026-10-04: a completed review still read as a reservation).
 */
export function creditEntryDescription(entry: { kind: string; description: string; aiReservations?: ReservedRun[] }) {
  const run = entry.aiReservations?.[0];
  if (entry.kind === "AI_RELEASE") return "Workflow AI – överskottet återfört";
  if (entry.kind !== "AI_RESERVATION" || !run) return entry.description;
  const place = (run.surface && AI_SURFACE_LABELS[run.surface]) || AI_AGENT_LABELS[run.agentId] || "AI-svar";
  if (run.status === "COMPLETED") return `Workflow AI – ${place}`;
  if (run.status === "FAILED" || run.status === "CANCELED") return `Workflow AI – ${place} (avbrutet, krediterna återförda)`;
  return `Workflow AI – ${place} (pågår, reserverat)`;
}
