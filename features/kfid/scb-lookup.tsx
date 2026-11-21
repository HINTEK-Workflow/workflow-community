"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeCompanyOrgNumber } from "@/lib/kfid/org-number";

export type FoundCompany = { name: string; address: string; postalCode: string; city: string };

/**
 * "Hämta från SCB" beside an organisation number (2026-10-07): fills in the company's name and address from SCB's
 * register for an administrator. Without a key or an answer the person simply types the details.
 *
 * `endpoint` is the signed-out sign-up's own lookup (/api/register/lookup, open only while registration is open and limited per
 * address) or, by default, the administrators' (/api/company-lookup). `auto` asks once for every new valid number without a
 * click (Skapa konto, where the number comes first); the button stays for a second try. 2026-11-04.
 */
export function ScbLookupButton({ number, onFound, testId = "scb-lookup", endpoint = "/api/company-lookup", auto = false }: { number: string; onFound: (company: FoundCompany) => void; testId?: string; endpoint?: string; auto?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Only an organisation number is looked up; a personal number (enskild firma) is never sent (2026-11-04).
  const digits = normalizeCompanyOrgNumber(number);
  const foundRef = useRef(onFound);
  useEffect(() => { foundRef.current = onFound; });
  const lookUp = async (quiet = false) => {
    if (!digits) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${endpoint}?number=${digits}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as Partial<FoundCompany> & { available?: boolean; found?: boolean; error?: string };
      if (!response.ok) { if (!quiet) setMessage(data.error || "Uppslaget gick inte. Skriv uppgifterna själv."); }
      else if (data.available === false) { if (!quiet) setMessage("Företagsuppslaget är inte inställt. Skriv uppgifterna själv."); }
      else if (!data.found || !data.name) { if (!quiet) setMessage("SCB hittade inget företag med det numret."); }
      else {
        foundRef.current({ name: data.name, address: data.address ?? "", postalCode: data.postalCode ?? "", city: data.city ?? "" });
        setMessage(`Hämtat från SCB: ${data.name}.`);
      }
    } catch {
      if (!quiet) setMessage("Uppslaget gick inte. Skriv uppgifterna själv.");
    } finally {
      setBusy(false);
    }
  };
  // The number last asked about, so the same number is asked once.
  const asked = useRef("");
  useEffect(() => {
    if (!auto || !digits || digits === asked.current) return;
    asked.current = digits;
    void lookUp(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new number asks
  }, [auto, digits]);
  return <div className="space-y-1" data-testid={testId}>
    <Button type="button" variant="outline" disabled={busy || !digits} onClick={() => void lookUp()} title={digits ? undefined : "Skriv ett giltigt organisationsnummer först."} busy={busy} busyLabel="Hämtar…">
      <Search />Hämta från SCB
    </Button>
    {message ? <p className="text-xs text-muted-foreground" role="status">{message}</p> : null}
  </div>;
}
