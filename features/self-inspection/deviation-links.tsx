"use client";

import { ClipboardList } from "lucide-react";
import { ListRow } from "@/components/native";
import type { EditorFact } from "@/features/workflow/editor-header";
import { deviationClosedText, deviationHref, deviationLinkText } from "@/lib/self-inspection/deviation-link";
import { DEVIATION_KINDS, DEVIATION_STATUSES } from "@/lib/self-inspection/model";
import type { WorkContext } from "@/lib/self-inspection/work";

/**
 * Avvikelse ↔ arbetsorder on the work order's page (2026-10-10): the log entries the order fixes, as links to the
 * entry in Egenkontroll → Avvikelser. Only the entries the reader may read come from the server (the log's own rule), so
 * someone who may not read the log sees nothing here.
 */
type OrderDeviation = NonNullable<WorkContext["orderDeviations"]>[number];
const entriesOf = (context: WorkContext | null | undefined): OrderDeviation[] => context?.orderDeviations ?? [];

/**
 * The page: one fact per entry beside "Från …" in the header ("Avvikelse 3 i avvikelseloggen · Pågår"). Kept at level 1
 * as well (a phone on its side shows the page, where the header's minor facts are hidden; 2026-10-11).
 */
export const deviationFacts = (context: WorkContext | null | undefined): EditorFact[] =>
  entriesOf(context).map((entry) => ({ icon: ClipboardList, label: deviationLinkText(entry), href: deviationHref(entry.id), iconClassName: "text-muted-foreground", keep: true }));

/** Level 1 on a phone: the same entries as rows in the job's menu, under Uppdraget. */
export function NativeDeviationRows({ context }: { context: WorkContext | null | undefined }) {
  return <>{entriesOf(context).map((entry) => <ListRow key={entry.id} type="risk" icon={ClipboardList} title={`${DEVIATION_KINDS[entry.kind]} ${entry.number} i avvikelseloggen`}
    subtitle={deviationClosedText(entry) || undefined} pill={{ label: DEVIATION_STATUSES[entry.status], tone: entry.status === "DONE" ? "success" : entry.status === "IN_PROGRESS" ? "info" : "warning" }}
    href={deviationHref(entry.id)} testId="native-job-deviation" />)}</>;
}
