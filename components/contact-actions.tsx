"use client";

import { MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListGroup, ListRow } from "@/components/native";
import { callTargets, destinationText, navigateHref, type Destination } from "@/lib/workflow/contact-links";

/**
 * Ring och Navigera (2026-10-12): "Ring <namn>" (tel:-länk) per telefonnummer som finns och "Navigera" (kartlänk till
 * platsens adress eller position). Bara det som finns ger en knapp; finns inget ritas ingenting. Visning 1 ritar rader i
 * en grupp (ListRow, 44 px), visning 2–3 vanliga knappar. Länkar bara – ingen data hämtas och inget nytt anrop görs.
 */
export function ContactActions({ name, phone, mobile, destination, native = false, testId = "contact-actions" }: {
  name?: string | null; phone?: string | null; mobile?: string | null; destination?: Destination | null; native?: boolean; testId?: string;
}) {
  const calls = callTargets({ name, phone, mobile });
  const navigate = navigateHref(destination);
  if (!calls.length && !navigate) return null;
  const where = destination ? destinationText(destination) : "";
  if (native) return <ListGroup testId={testId}>
    {/* A call goes to the phone's own app; the map opens beside Workflow. */}
    {calls.map((call) => <ListRow key={call.key} type="customer" icon={Phone} title={call.label} subtitle={call.number} href={call.href} testId={`contact-call-${call.key}`} />)}
    {navigate ? <ListRow type="customer" icon={MapPin} title="Navigera" subtitle={where || "Till platsen"} onClick={() => window.open(navigate, "_blank", "noopener")} testId="contact-navigate" /> : null}
  </ListGroup>;
  // A long name ("Ring <kund>") is cut with … inside the button instead of pushing the page sideways on a phone.
  return <div className="flex min-w-0 flex-wrap gap-2" data-testid={testId}>
    {calls.map((call) => <Button key={call.key} asChild variant="outline" className="min-w-0 max-w-full"><a href={call.href} title={call.label} data-testid={`contact-call-${call.key}`}><Phone /><span className="truncate">{call.label}</span></a></Button>)}
    {navigate ? <Button asChild variant="outline"><a href={navigate} target="_blank" rel="noopener noreferrer" data-testid="contact-navigate"><MapPin />Navigera</a></Button> : null}
  </div>;
}
