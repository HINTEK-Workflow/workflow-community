"use client";

import { withReturn } from "@/lib/workflow/return-link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { invalidateCustomerOptions } from "@/features/kfid/customer-options";
import { OWN_COMPANY_PLACES_TITLE, ownCompanyPlacesHref } from "@/lib/workflow/own-company";

/**
 * Platser under Företaget (2026-10-24: "Bygg likadant"; the button beside Företagsuppgifter, "eftersom det hör ihop",
 * no card of its own): the way to the company's own places – the same page, tree, action card and information card as a
 * customer's places, chosen in a work order as Eget företag. The company's own record is made on the first visit (the server
 * decides who may: the company's admin).
 */
export function OwnCompanyPlacesButton({ size }: { size?: "sm" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    setBusy(true); setError("");
    try {
      const { id } = await api<{ id: string }>("/api/workspace", { method: "POST", body: JSON.stringify({ action: "own_company" }) });
      invalidateCustomerOptions();
      // Samband (2026-10-26): the page leads back to Företaget.
      router.push(withReturn(ownCompanyPlacesHref(id), `${window.location.pathname}${window.location.search}`));
    } catch (issue) { setError((issue as Error).message); setBusy(false); }
  };
  return <>
    <Button type="button" variant="outline" size={size} onClick={() => void open()} title={`${OWN_COMPANY_PLACES_TITLE}: verkstad, lager, fordon och andra egna objekt`} busy={busy} busyLabel="Öppnar…" data-testid="own-company-places-open"><MapPin />Platser</Button>
    {error ? <p role="alert" className="basis-full text-sm text-destructive" data-testid="own-company-places-error">{error}</p> : null}
  </>;
}
