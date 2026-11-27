"use client";

import { useEffect, useState } from "react";
import { FileText, Receipt } from "lucide-react";
import { NativeSegmentedLinks } from "@/components/native/list";
import { api } from "@/features/kfid/api";

/**
 * The small, shared parts of invoicing that both lists need (Fakturor and Fakturaunderlag) – kept apart from the list itself,
 * which is loaded only where it is shown (lib/extensions/core-client.tsx).
 */

/** Whether the company invoices (on), may make invoices (canEdit), and – when off – may turn it on (offer). */
export function useInvoicingState() {
  const [on, setOn] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ canEdit?: boolean }>("/api/customer-invoices?state=1", { cache: "no-store" }, { change: false }).then((state) => { if (live) { setOn(true); setCanEdit(state.canEdit === true); } }).catch(() => {
      if (!live) return;
      setOn(false);
      api<{ canTurnOn: boolean }>("/api/customer-invoices?offer=1", { cache: "no-store" }, { change: false }).then((next) => { if (live) setOffer(next.canTurnOn); }).catch(() => undefined);
    });
    return () => { live = false; };
  }, []);
  return { on, canEdit, offer };
}

/** In the app (mobilresan 2026-11-18): Fakturor | Fakturaunderlag as the app's segmented control, as Kunder | Alla objekt. */
export function InvoicingSwitch({ current }: { current: "invoices" | "bases" }) {
  return <NativeSegmentedLinks label="Fakturering" testId="invoicing-switch" options={[
    { href: "/?view=customer_invoices", label: "Fakturor", icon: Receipt, current: current === "invoices", testId: "customer-invoices-link" },
    { href: "/?view=invoice_bases", label: "Fakturaunderlag", icon: FileText, current: current === "bases", testId: "customer-invoices-bases-link" },
  ]} />;
}

/** A basis without a job or project, the start of an invoice from nothing (2026-11-05): the customer and the title may come later. */
export const createStandalone = (input: { customerId: string | null; title: string }) =>
  api<{ id: string; label: string }>("/api/customer-invoices", { method: "POST", body: JSON.stringify({ action: "standalone", invoice: input }) });
