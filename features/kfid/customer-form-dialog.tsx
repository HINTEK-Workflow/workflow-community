"use client";

import { useState } from "react";
import { useDetailLevel, useNativeMode } from "@/features/workflow/use-detail-level";
import { AddressSearchField, useAddressLookupStatus } from "@/features/workflow/address-search-field";
import { CheckField, CollapsibleSection, DialogActions, Field, Modal, useInsideView } from "./ui";
import { action, api } from "./api";
import { addCustomerOption, DUPLICATE_CUSTOMER_QUESTION, findDuplicateCustomer, invalidateCustomerOptions } from "./customer-options";
import { useConfirm } from "./confirm";
import type { CustomerItem } from "./types";
import { CUSTOMER_TYPE_LABELS, CUSTOMER_TYPES, customerTypeOf, type CustomerType } from "@/lib/kfid/customer-schema";
import { customerHasAddress, FIRST_PLACE_HELP, FIRST_PLACE_LABEL, firstPlaceFailed, firstPlaceOf } from "@/lib/kfid/customer-first-place";
import type { FacilityItem } from "@/lib/workflow/customer-facility";
import { announce } from "@/lib/workflow/toast";

/**
 * The customer form (Kundtyp, Namn, Företag, kontakt, adress, anteckningar, Särskilda krav): one form for the customer
 * register, the Local register and the quick links "Lägg till kund" / "Redigera kund" beside a customer choice (
 * 2026-10-08). Kundtyp (2026-10-10): Företag or Privatperson, which a new quote for the customer starts with.
 */
export const blankCustomerForm: {
  name: string; company: string; address: string; postalCode: string; city: string; email: string; phone: string; mobile: string;
  lat: string; lng: string; notes: string; specialRequirements: string; customerType: CustomerType; accountingCustomerNumber: string;
} = {
  name: "",
  company: "",
  address: "",
  postalCode: "",
  city: "",
  email: "",
  phone: "",
  mobile: "",
  lat: "",
  lng: "",
  notes: "",
  specialRequirements: "",
  customerType: "COMPANY",
  accountingCustomerNumber: "",
};
export type CustomerFormValue = typeof blankCustomerForm;

export const customerFormOf = (customer: CustomerItem): CustomerFormValue => ({
  name: customer.name,
  company: customer.company,
  address: customer.address,
  postalCode: customer.postalCode,
  city: customer.city,
  email: customer.email,
  phone: customer.phone,
  mobile: customer.mobile,
  lat: customer.lat == null ? "" : String(customer.lat),
  lng: customer.lng == null ? "" : String(customer.lng),
  notes: customer.notes,
  specialRequirements: customer.specialRequirements ?? "",
  customerType: customerTypeOf(customer.customerType),
  accountingCustomerNumber: customer.accountingCustomerNumber ?? "",
});

/**
 * What the customer form sends. The special requirements are left out when the record the form started from did not carry
 * them and the field was not filled in, so they are never emptied by mistake.
 */
export const customerPayload = (form: CustomerFormValue, from: CustomerItem | null) => {
  // A Privatperson has no Företag field: text typed there before the type was switched is not kept, while a value the
  // customer already had is sent back as it is (Fas 2, 2026-10-11).
  const typed = form.customerType === "PRIVATE" && form.company && !from?.company ? { ...form, company: "" } : form;
  return from && from.specialRequirements === undefined && !typed.specialRequirements ? Object.fromEntries(Object.entries(typed).filter(([key]) => key !== "specialRequirements")) : typed;
};

const FIELDS: { key: Exclude<keyof CustomerFormValue, "customerType" | "accountingCustomerNumber">; label: string }[] = [
  { key: "name", label: "Namn / kontaktperson" },
  { key: "company", label: "Företag" },
  { key: "email", label: "E-post" },
  { key: "phone", label: "Telefon" },
  { key: "mobile", label: "Mobil" },
  { key: "address", label: "Adress" },
  { key: "postalCode", label: "Postnummer" },
  { key: "city", label: "Ort" },
];
const FIRST_FIELDS: (typeof FIELDS)[number]["key"][] = ["name", "company", "email", "phone"];
// No latitude/longitude on the customer (2026-10-10): positions belong to the customer's places, where the map
// pin and the address lookup are. A stored value is kept as it is (the form sends it back unchanged).

/**
 * The customer form itself (2026-10-09: one form, edited in the customer register). Three layouts, the same fields,
 * rules and save (plan 1Q, 2026-10-11):
 * - "full": every field in the order of FIELDS – expanded in place in the register and on the customer card, and display
 *   level 1's form screen.
 * - "compact": the popup (display 3, the size of "Lägg till instrument"): Kundtyp, Namn, Företag, E-post and Telefon first,
 *   everything else under "Fler uppgifter".
 * - "sections": a page of its own (display 2): Kontakt, Adress, Bokföring and Anteckningar as folded sections, Kontakt open.
 * The actions row is the shared DialogActions, so a view offers Avbryt and Spara in the bottom bar instead of twice.
 */
export type CustomerFormLayout = "full" | "compact" | "sections";
export function CustomerForm({ idPrefix = "customer", value, onChange, busy, submitLabel = "Spara kund", error, onSubmit, onCancel, firstPlace, compact = false, layout: layoutProp }: {
  idPrefix?: string;
  /** Shorthand for layout "compact" (a small dialog on top of a view, simulation 0.6.4). */
  compact?: boolean;
  layout?: CustomerFormLayout;
  value: CustomerFormValue;
  onChange: (value: CustomerFormValue) => void;
  busy?: boolean;
  submitLabel?: string;
  error?: string;
  onSubmit: () => void | Promise<void>;
  onCancel?: () => void;
  /**
   * "Skapa en plats med samma adress" (2026-10-10): given only for a new customer, by a form that can save a place;
   * the tick box is shown once an address is written.
   */
  firstPlace?: { checked: boolean; onChange: (checked: boolean) => void };
}) {
  const layout: CustomerFormLayout = layoutProp ?? (compact ? "compact" : "full");
  const [missing, setMissing] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ contact: true });
  const addressLookup = useAddressLookupStatus();
  const set = (key: keyof CustomerFormValue, next: string) => { if (key === "name" && next.trim()) setMissing(""); onChange({ ...value, [key]: next }); };
  // The app's own message, never the browser's bubble (simulation 0.6.3: "Please fill out this field"): the form is
  // checked here, the message is told where the person is and the name field gets focus.
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); event.stopPropagation();
    if (!value.name.trim()) {
      const text = "Ange kundens namn först.";
      setMissing(text);
      announce(text, true);
      event.currentTarget.querySelector<HTMLInputElement>(`#${CSS.escape(`${idPrefix}-name`)}`)?.focus();
      return;
    }
    void onSubmit();
  };
  const field = (key: (typeof FIELDS)[number]["key"]) => {
    const spec = FIELDS.find((item) => item.key === key)!;
    // Privatperson has no Företag field (2026-10-11); a value already written is kept and sent back as it is.
    if (key === "company" && value.customerType === "PRIVATE") return null;
    // Adressökning (2026-10-15): the address searches Lantmäteriet's addresses like a place's street does; choosing
    // one fills Adress, Postnummer and Ort. Typing freely (a box address, an address abroad) works as before.
    if (key === "address") return <AddressSearchField key={key} id={`${idPrefix}-${key}`} label={spec.label} value={value.address} onChange={(next) => set("address", next)}
      onPick={(choice) => onChange({ ...value, address: choice.address, postalCode: choice.postalCode, city: choice.city })} available={addressLookup} testId="customer-address-search" />;
    return <Field key={key} id={`${idPrefix}-${key}`} label={spec.label} required={key === "name"} type={key === "email" ? "email" : "text"} value={value[key]} onChange={(next) => set(key, next)} />;
  };
  // Kundtyp (2026-10-10): what a new quote for the customer starts with; it can still be changed on the quote.
  const typeField = <Field id={`${idPrefix}-customer-type`} label="Kundtyp" value={value.customerType} options={[...CUSTOMER_TYPES]} optionLabels={CUSTOMER_TYPE_LABELS}
    onChange={(next) => onChange({ ...value, customerType: customerTypeOf(next) })} help="Förval på nya offerter till kunden." />;
  const grid = (keys: (typeof FIELDS)[number]["key"][], withType = false) => <div className="grid gap-4 sm:grid-cols-2">{withType ? typeField : null}{keys.map(field)}</div>;
  // Kundnummer i bokföringen (2026-10-11, plan 1L): the Fortnox sending uses it. One line of help (2026-10-13).
  const accountingField = <Field id={`${idPrefix}-accounting-number`} label="Kundnummer i bokföringen" value={value.accountingCustomerNumber} onChange={(next) => set("accountingCustomerNumber", next.slice(0, 60))}
    help="Används när offert eller fakturaunderlag skickas till bokföringen." />;
  const accounting = <div className="sm:max-w-xs">{accountingField}</div>;
  const firstPlaceBox = firstPlace && customerHasAddress(value) ? <CheckField id={`${idPrefix}-first-place`} label={FIRST_PLACE_LABEL} description={FIRST_PLACE_HELP}
    checked={firstPlace.checked} onChange={firstPlace.onChange} testId="customer-first-place" /> : null;
  const notes = <Field id={`${idPrefix}-notes`} label="Anteckningar" multiline value={value.notes} onChange={(next) => set("notes", next)} />;
  // Särskilda krav (2026-10-07): whoever may edit customers writes them; they are shown in the customer's projects and tasks.
  const requirements = <Field id={`${idPrefix}-special-requirements`} label="Särskilda krav" multiline value={value.specialRequirements} onChange={(next) => set("specialRequirements", next)}
    help="Särskilda krav från kunden. Visas i kundens projekt och uppgifter." />;
  const section = (key: string, title: string, summary: string, children: React.ReactNode) =>
    <CollapsibleSection key={key} title={title} summary={summary} open={Boolean(open[key])} onOpenChange={(next) => setOpen((current) => ({ ...current, [key]: next }))} testId={`customer-section-${key}`}>
      <div className="space-y-5">{children}</div>
    </CollapsibleSection>;
  const address = [value.address, value.postalCode, value.city].filter(Boolean).join(", ");
  const body = layout === "compact" ? <>
    {grid(FIRST_FIELDS, true)}
    <CollapsibleSection title="Fler uppgifter" summary="Mobil, adress, kundnummer, anteckningar och särskilda krav" open={moreOpen} onOpenChange={setMoreOpen} testId="customer-more">
      <div className="space-y-5">{grid(["mobile", "address", "postalCode", "city"])}{accounting}{firstPlaceBox}{notes}{requirements}</div>
    </CollapsibleSection>
  </> : layout === "sections" ? <>
    {section("contact", "Kontakt", "", grid(["name", "company", "email", "phone", "mobile"], true))}
    {section("address", "Adress", address, <>{grid(["address", "postalCode", "city"])}{firstPlaceBox}</>)}
    {section("accounting", "Bokföring", value.accountingCustomerNumber, accounting)}
    {section("notes", "Anteckningar", [value.notes, value.specialRequirements].filter(Boolean).join(" · "), <>{notes}{requirements}</>)}
  </> : <>
    {/* The fields in ordered pairs (2026-10-13, ui-system 1): Kundtyp · Kundnummer, Namn · Företag, E-post · Telefon,
        Mobil · Adress, Postnummer · Ort; the texts of several lines in the whole width under them. */}
    <div className="grid gap-4 sm:grid-cols-2">{typeField}{accountingField}{(["name", "company", "email", "phone", "mobile", "address", "postalCode", "city"] as const).map(field)}</div>
    {firstPlaceBox}{notes}{requirements}
  </>;
  return <form className="space-y-5" data-testid="customer-form" data-layout={layout} noValidate onSubmit={submit}>
    {body}
    {missing || error ? <p role="alert" className="text-sm text-destructive" data-testid="customer-form-error">{missing || error}</p> : null}
    <DialogActions cancel={onCancel ? { onClick: onCancel } : null} primary={{ label: submitLabel, type: "submit", busy, busyLabel: "Sparar…", testId: "customer-form-save" }} />
  </form>;
}

export function CustomerFormDialog({ open, onOpenChange, title, idPrefix = "customer", value, onChange, busy, submitLabel = "Spara kund", error, onSubmit, firstPlace }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The fields' ids (`customer-name`, `local-customer-name`, …), so each register keeps its own. */
  idPrefix?: string;
  value: CustomerFormValue;
  onChange: (value: CustomerFormValue) => void;
  busy?: boolean;
  submitLabel?: string;
  error?: string;
  onSubmit: () => void | Promise<void>;
  firstPlace?: { checked: boolean; onChange: (checked: boolean) => void };
}) {
  // The size of "Lägg till instrument" (plan 1Q, 2026-10-11): size "form" is a popup on display 3, a page on display 2
  // and a screen at level 1; the few fields first and the rest under "Fler uppgifter" – except on level 1's screen, which has
  // every field, unless it lies over another screen (then a small dialog).
  const insideView = useInsideView();
  const native = useNativeMode();
  const level = useDetailLevel();
  const layout: CustomerFormLayout = native && !insideView ? "full" : level === 2 ? "sections" : "compact";
  return <Modal open={open} onOpenChange={onOpenChange} title={title} size={native && insideView ? "compact" : "form"}>
    <CustomerForm idPrefix={idPrefix} value={value} onChange={onChange} busy={busy} submitLabel={submitLabel} error={error} onSubmit={onSubmit} onCancel={() => onOpenChange(false)} firstPlace={firstPlace} layout={layout} />
  </Modal>;
}

/**
 * Saves a customer from a quick link and returns it as the choice lists hold it; `existing` is the one being edited.
 * `firstPlace` (a new customer only, 2026-10-10) also saves the customer's first place with the same address
 * through the ordinary place rules; when that fails the customer is still saved and `firstPlaceError` says why.
 */
export type SavedCustomer = CustomerItem & { firstPlaceError?: string };
export type SaveCustomer = (value: CustomerFormValue, existing: CustomerItem | null, options?: { firstPlace?: boolean }) => Promise<SavedCustomer>;
/** Reads the customer as it is now before it is edited (its version and every field); Local already has it. */
export type ReadCustomer = (id: string) => Promise<CustomerItem>;

/** Cloud and the demo: the customer register's own API. The choice lists are read again and hold the customer at once. */
export const cloudSaveCustomer: SaveCustomer = async (value, existing, options) => {
  const saved = await action<{ id: string }>({ action: "customer_save", id: existing?.id, version: existing?.version, data: customerPayload(value, existing) });
  const customer = await api<CustomerItem>(`/api/workspace?action=customer&id=${encodeURIComponent(existing?.id ?? saved.id)}`);
  // The first place goes through the customer card's place API, with its rights and its duplicate rule.
  const place = !existing && options?.firstPlace ? firstPlaceOf(value) : null;
  let facilities = existing?.facilities ?? [];
  let firstPlaceError: string | undefined;
  if (place) {
    try {
      const created = await api<{ id: string }>("/api/customer-card", { method: "POST", body: JSON.stringify({ action: "facility_save", customerId: customer.id, facility: place }) });
      facilities = [firstPlaceItem(created.id, customer.id, place)];
    } catch (issue) { firstPlaceError = (issue as Error).message; }
  }
  invalidateCustomerOptions();
  // The places are not part of the single read; an edited customer keeps the ones the list had until it is read again.
  addCustomerOption({ ...customer, facilities });
  return { ...customer, facilities, ...(firstPlaceError ? { firstPlaceError } : {}) };
};
/** The new first place as the choice lists hold a place, so the work it was added from can choose it at once. */
export const firstPlaceItem = (id: string, customerId: string, place: NonNullable<ReturnType<typeof firstPlaceOf>>): FacilityItem => ({
  id, customerId, parentId: null, kind: "FACILITY", latitude: null, longitude: null, name: place.name, address: place.address ?? "", postalCode: place.postalCode ?? "", city: place.city ?? "", description: "", isActive: true,
});
export const cloudReadCustomer: ReadCustomer = (id) => api<CustomerItem>(`/api/workspace?action=customer&id=${encodeURIComponent(id)}`);

/**
 * "Lägg till kund" and "Redigera kund" from a customer choice (2026-10-08): the form opens over the page, so what
 * is typed in the open work order or project stays; after saving, the saved customer is handed back to be chosen.
 */
export function CustomerQuickDialog({ editing, open, onOpenChange, save, onSaved }: {
  /** The customer being edited, or null for a new one. */
  editing: CustomerItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  save: SaveCustomer;
  onSaved: (customer: CustomerItem) => void;
}) {
  const [value, setValue] = useState<CustomerFormValue>(() => editing ? customerFormOf(editing) : blankCustomerForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // "Skapa en plats med samma adress" is on from the start for a new customer (it is shown once an address is written).
  const [firstPlace, setFirstPlace] = useState(true);
  const [confirm, confirmElement] = useConfirm();
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const duplicate = !editing && save === cloudSaveCustomer ? await findDuplicateCustomer(value.name, value.company) : null;
      if (duplicate) {
        const answer = await confirm({ title: "Kunden finns redan", message: DUPLICATE_CUSTOMER_QUESTION, confirmLabel: "Skapa ändå", alternative: { label: "Öppna den som finns" } });
        if (answer === "alternative") { onSaved(duplicate); onOpenChange(false); return; }
        if (!answer) return;
      }
      const customer = await save(value, editing, { firstPlace: !editing && firstPlace && customerHasAddress(value) });
      if (customer.firstPlaceError) announce(firstPlaceFailed(customer.firstPlaceError), true);
      onSaved(customer);
      onOpenChange(false);
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };
  return <><CustomerFormDialog open={open} onOpenChange={onOpenChange} title={editing ? "Redigera kund" : "Ny kund"} idPrefix="quick-customer" value={value} onChange={setValue} busy={busy} error={error}
    submitLabel={editing ? "Spara kund" : "Spara och välj kunden"} onSubmit={submit} firstPlace={editing ? undefined : { checked: firstPlace, onChange: setFirstPlace }} />{confirmElement}</>;
}
