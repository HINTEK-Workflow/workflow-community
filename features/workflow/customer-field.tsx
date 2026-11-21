"use client";

import { useRef, useState } from "react";
import { useDetailLevel } from "./use-detail-level";
import { useModuleOn } from "./use-modules";
import { useRouter } from "next/navigation";
import { Pencil, UserPlus } from "lucide-react";
import { CustomerSearchBox } from "@/features/kfid/customer-search-box";
import { CustomerQuickDialog, type ReadCustomer, type SaveCustomer } from "@/features/kfid/customer-form-dialog";
import type { CustomerItem } from "@/features/kfid/types";
import { placeAfterCustomerChange, placeChoiceHint } from "@/lib/workflow/customer-place";
import { announce } from "@/lib/workflow/toast";
import { confirmLeave } from "@/lib/workflow/leave-guard";
import { saveReturnDrafts } from "@/lib/workflow/return-draft";
import { withReturn } from "@/lib/workflow/return-link";
import { usePicked } from "@/features/kfid/use-return-to";
import { PlacePicker, type SavePlace } from "./place-picker";
import { isOwnCompany, OWN_COMPANY_LABEL } from "@/lib/workflow/own-company";
import { IconButton } from "@/components/ui/icon-button";
import { customerTitle } from "@/lib/kfid/customer-name";
import { customerLine } from "@/lib/kfid/customer-name";

/** The quick links beside the customer choice; without rights (or in a preview) they are not shown. */
export type CustomerQuickLinks = { save: SaveCustomer; read?: ReadCustomer; canCreate: boolean; canEdit: boolean;
  /**
   * Kunduppgifter redigeras i kundregistret (2026-10-09): the links lead to the register's own page with the way
   * back, and a new customer is chosen on return. Where the open work cannot be left (an unsaved form in a view, Local
   * without a register page) the form opens over the work instead.
   */
  register?: boolean;
  /**
   * The host keeps what is typed when the person leaves and comes back (plan 1O, 2026-10-11): then display level 2 (tablet,
   * and a phone at level 2–3) goes to the register page as well, and only a computer (level 3) gets the small dialog.
   */
  returnable?: boolean };
export type CustomerPlaceChange = { customerId: string | null; facilityId: string | null; customer: CustomerItem | null; changed: "customer" | "place" };

/**
 * Kund och plats (2026-10-08, "krånga inte till det"): one field pair for work orders, tasks, projects and
 * rounds. The customer is chosen first, then one of that customer's places – the only one is chosen at once, several are
 * picked, none asks for nothing – and a new customer never keeps the old customer's place (lib/workflow/customer-place.ts).
 * "Lägg till kund" and "Redigera kund" open the customer in the customer register (2026-10-09) and lead back to
 * the same work, where a new customer is chosen; where the work cannot be left they open the form over it instead. Returns the two fields as siblings, for the caller's grid.
 */
export function CustomerField({ id, customers: allCustomers, customerId, facilityId, onChange, disabled = false, locked = false, lockedNote = "", customerLabel, placeLabel = "Plats (valfritt)", placeNote = "",
  savePlace, quick: quickLinks, search = false, autoPlace = true, placeOpenRequest = 0, noPlace = false, customerTestId }: {
  /** Prefix for the fields' ids (`${id}-customer`, `${id}-place`). */
  id: string;
  customers: CustomerItem[];
  customerId: string | null;
  facilityId: string | null;
  onChange: (next: CustomerPlaceChange) => void;
  disabled?: boolean;
  /** The customer follows something else (the project): the choice is shown but cannot be changed here. */
  locked?: boolean;
  /** Where a locked customer comes from, under the field ("Följer projektet …"). */
  lockedNote?: string;
  customerLabel?: string;
  placeLabel?: string;
  /** Where the place comes from, under the place field. */
  placeNote?: string;
  savePlace?: SavePlace;
  quick?: CustomerQuickLinks;
  /** The server search for companies with more customers than the list holds (Cloud only). */
  search?: boolean;
  /** Choose the customer's only place by itself (off where a typed text would otherwise be replaced). */
  autoPlace?: boolean;
  placeOpenRequest?: number;
  /** Only the customer: the document has no place (an inköp, Lika är rätt 2026-11-14). */
  noPlace?: boolean;
  customerTestId?: string;
}) {
  // Företagets moduler (0.39.0): with Kunder off the choice is Eget företag or none, and what the job already has stays shown. No new customer.
  const customersOn = useModuleOn("customers");
  const customers = customersOn ? allCustomers : allCustomers.filter((customer) => isOwnCompany(customer) || customer.id === customerId);
  const quick = customersOn ? quickLinks : undefined;
  const [dialog, setDialog] = useState<{ editing: CustomerItem | null; key: number } | null>(null);
  const router = useRouter();
  const level = useDetailLevel();
  const register = Boolean(quick?.register) || (Boolean(quick?.returnable) && level === 2);
  /** To the register, with this very page as the way back (also an unsaved new task: its draft comes back). */
  const openRegister = (customerId: string | null) => {
    const here = `${window.location.pathname}${window.location.search}`;
    const target = withReturn(`/?view=customers&${customerId ? `customerId=${encodeURIComponent(customerId)}&edit=1` : "new=1"}`, here);
    // The open editor saves first (or asks), exactly as for a link (lib/workflow/leave-guard.ts).
    // A host that keeps what is typed (returnable) leaves without asking: the values come back with the person.
    if (quick?.returnable) { saveReturnDrafts(here); router.push(target); return; }
    void confirmLeave().then((ok) => { if (ok) { saveReturnDrafts(here); router.push(target); } });
  };
  const opened = useRef(0);
  const current = customers.find((customer) => customer.id === customerId) ?? null;
  const placesOf = (customer: CustomerItem | null) => customer?.facilities ?? [];
  const chooseCustomer = (customer: CustomerItem | null) => {
    const nextId = customer?.id ?? null;
    onChange({ customerId: nextId, facilityId: placeAfterCustomerChange(placesOf(customer), nextId, facilityId, { auto: autoPlace }), customer, changed: "customer" });
  };
  const choosePlace = (placeId: string | null, owner: string | null) => {
    // Picking a place of another customer (only possible while no customer is chosen) chooses that customer too.
    const ownerId = !locked && owner ? owner : customerId;
    onChange({ customerId: ownerId, facilityId: placeId, customer: customers.find((customer) => customer.id === ownerId) ?? null, changed: "place" });
  };
  const openEdit = async () => {
    if (!current || !quick) return;
    try { setDialog({ editing: quick.read ? { ...(await quick.read(current.id)), facilities: current.facilities } : current, key: ++opened.current }); }
    catch (issue) { announce((issue as Error).message, true); }
  };
  // Back from the register with a new customer (samband, lib/workflow/return-link.ts): it is chosen here once, and the
  // marker leaves the address; while the customer list is still read it waits.
  usePicked("Customer", (picked) => {
    const customer = customers.find((item) => item.id === picked);
    if (!customer) return false;
    if (customer.id !== customerId) chooseCustomer(customer);
  }, register && !locked && !disabled);
  const label = customerLabel ?? (locked ? "Kund (från projektet)" : "Kund (valfritt)");
  // A locked document asks for no choice (kundresa 2026-11-07, L65).
  const hint = disabled || noPlace ? "" : placeChoiceHint(placesOf(current), customerId, facilityId);
  const shownId = customerId ?? "";
  return <>
    {/* The label is a block with the shared 6 px step to the field (QA 2026-10-10: an inline label took no space-y margin,
        so Kund stood 6 px higher than Rubrik and Projekt in the same row). */}
    <div className="space-y-1.5 text-xs font-medium text-muted-foreground" data-testid="customer-field">
      <label htmlFor={`${id}-customer`} className="block">{label}</label>
      <div className="flex gap-2">
        <select id={`${id}-customer`} data-testid={customerTestId} className="form-select min-w-0 flex-1" value={shownId} disabled={disabled || locked} title={locked ? lockedNote || "Kunden följer projektet." : undefined}
          onChange={(event) => chooseCustomer(customers.find((customer) => customer.id === event.target.value) ?? null)}>
          <option value="">Ingen kund</option>
          {/* Customer choices are read on demand; keep the current value visible meanwhile. */}
          {shownId && !current ? <option value={shownId}>Hämtar kund…</option> : null}
          {customers.filter((customer) => !customer.deletedAt || customer.id === shownId).map((customer) => <option key={customer.id} value={customer.id}>{isOwnCompany(customer) ? OWN_COMPANY_LABEL : customerLine(customer)}</option>)}
        </select>
        {/* Eget företag is changed under Företaget, not as a customer (2026-10-24). */}
        {quick?.canEdit && current && !isOwnCompany(current) && !disabled ? <IconButton label="Redigera kund" title={`Redigera ${customerTitle(current)}`} variant="outline" size="icon-lg" className="shrink-0" data-testid="customer-edit" onClick={() => { if (register && current) openRegister(current.id); else void openEdit(); }}><Pencil /></IconButton> : null}
        {quick?.canCreate && !locked && !disabled ? <IconButton label="Lägg till kund" variant="outline" size="icon-lg" className="shrink-0" data-testid="customer-add" onClick={() => { if (register) openRegister(null); else setDialog({ editing: null, key: ++opened.current }); }}><UserPlus /></IconButton> : null}
      </div>
      {locked && lockedNote ? <p className="font-normal" data-testid="customer-source">{lockedNote}</p> : null}
    </div>
    {search && customersOn && !locked && !disabled ? <CustomerSearchBox onPick={chooseCustomer} /> : null}
    {noPlace ? null : <div className="space-y-1">
      <PlacePicker id={`${id}-place`} label={placeLabel} customers={customers} customerId={customerId} value={facilityId} onChange={choosePlace} disabled={disabled} savePlace={savePlace} openRequest={placeOpenRequest} />
      {placeNote ? <p className="text-xs text-muted-foreground" data-testid="place-source">{placeNote}</p> : hint ? <p className="text-xs text-muted-foreground" data-testid="place-choice-hint">{hint}</p> : null}
    </div>}
    {dialog && quick ? <CustomerQuickDialog key={dialog.key} editing={dialog.editing} open onOpenChange={(open) => { if (!open) setDialog(null); }} save={quick.save}
      onSaved={(customer) => {
        // A new customer is chosen; an edited one stays chosen (its places and the place already chosen are kept).
        if (!dialog.editing) chooseCustomer(customer);
        announce(dialog.editing ? "Kunden är uppdaterad." : "Kunden är skapad och vald.");
      }} /> : null}
  </>;
}
