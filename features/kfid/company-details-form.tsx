"use client";

import { useState } from "react";
import { AddressSearchField, useAddressLookupStatus } from "@/features/workflow/address-search-field";
import { isMaskedNumber, looksLikePersonalNumber, normalizePartyNumber, partyNumberLabel, type CompanyType } from "@/lib/kfid/org-number";
import { ChoiceCard } from "@/components/ui/choice-card";
import { vatNumberHint, companyProfileSchema } from "@/lib/kfid/company";
import { cn } from "@/lib/utils";
import { CheckField, Field } from "./ui";
import { ScbLookupButton } from "./scb-lookup";

/**
 * Företagsuppgifter, one set of fields for every way a company's details are written (2026-11-04): Skapa konto,
 * Kom igång, Företagsuppgifter, and a customer company under Installation (prepare and edit). What a field asks, how
 * the organisation number fetches name and address from SCB and how the street searches Lantmäteriet's addresses is decided
 * here once. Both are helpers: without a key or an answer the fields are plain text and a short line says so.
 */
export type CompanyDetailsValue = {
  /** Aktiebolag eller annat företag, or enskild firma (2026-11-04). A sole trader's `organizationNumber` is its personal number. */
  companyType: CompanyType;
  name: string; organizationNumber: string; vatNumber: string; fSkatt: boolean;
  address: string; postalCode: string; city: string;
  contactName: string; email: string; phone: string; billingEmail: string;
  registeredOffice: string; bankgiro: string; plusgiro: string;
};
export const blankCompanyDetails: CompanyDetailsValue = {
  companyType: "company", name: "", organizationNumber: "", vatNumber: "", fSkatt: false, address: "", postalCode: "", city: "",
  contactName: "", email: "", phone: "", billingEmail: "", registeredOffice: "", bankgiro: "", plusgiro: "",
};

/** The form's value from a company's name and its saved profile (a profile from before has empty new fields). */
export function companyDetailsOf(name: string, profile: unknown): CompanyDetailsValue {
  const parsed = companyProfileSchema.safeParse(profile ?? {});
  const p = parsed.success ? parsed.data : companyProfileSchema.parse({});
  return {
    companyType: p.companyType, name, organizationNumber: p.organizationNumber, vatNumber: p.vatNumber, fSkatt: p.fSkatt, address: p.address, postalCode: p.postalCode, city: p.city,
    contactName: p.contactName, email: p.email, phone: p.phone, billingEmail: p.billingEmail,
    registeredOffice: p.registeredOffice, bankgiro: p.bankgiro, plusgiro: p.plusgiro,
  };
}

export type CompanyDetailsGroup = "company" | "address" | "contact" | "documents";

/** The street with Lantmäteriet's search where the installation offers it; a plain field otherwise (one hook, only where it is asked). */
function StreetField({ id, value, onChange, onPick, label }: { id: string; value: string; onChange: (value: string) => void; onPick: (choice: { address: string; postalCode: string; city: string }) => void; label: string }) {
  const available = useAddressLookupStatus();
  return <AddressSearchField id={id} label={label} value={value} onChange={onChange} onPick={onPick} available={available} testId="company-address-search" />;
}

export function CompanyDetailsFields({ value, onChange, idPrefix = "company", groups = ["company", "address", "contact", "documents"], lookupEndpoint, autoLookup = false, typeChoice = true, addressSearch = true, billingEmail = true, nameRequired = true, nameLabel = "Företagets namn", disabled = false, className }: {
  value: CompanyDetailsValue;
  onChange: (value: CompanyDetailsValue) => void;
  /** The fields' ids are `${idPrefix}-organizationNumber`, `${idPrefix}-name`, … */
  idPrefix?: string;
  groups?: readonly CompanyDetailsGroup[];
  /** The sign-up's own SCB lookup when nobody is signed in; the administrators' by default. */
  lookupEndpoint?: string;
  /** Ask SCB at once for a new valid number (Skapa konto). Never for a sole trader: a personal number is not sent anywhere. */
  autoLookup?: boolean;
  /** The short choice between "Aktiebolag eller annat företag" and "Enskild firma". False where the kind is fixed (the product administration). */
  typeChoice?: boolean;
  /** False where nobody is signed in (Skapa konto): the street is a plain field, no question goes to Lantmäteriet. */
  addressSearch?: boolean;
  /** Faktura-e-post is asked only where Workflow sends invoices. */
  billingEmail?: boolean;
  nameRequired?: boolean;
  nameLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const set = <K extends keyof CompanyDetailsValue>(key: K, next: CompanyDetailsValue[K]) => onChange({ ...value, [key]: next });
  const soleTrader = value.companyType === "soleTrader";
  const digits = normalizePartyNumber(value.organizationNumber, value.companyType);
  // A sole trader's number shown masked (the product administration's view) cannot be edited here; the company changes it itself.
  const masked = soleTrader && isMaskedNumber(value.organizationNumber);
  const typed = value.organizationNumber.replace(/\D/g, "").length;
  const numberHelp = masked ? "Visas maskerat. Företaget ändrar det själv."
    : !soleTrader && looksLikePersonalNumber(value.organizationNumber) ? <span className="text-destructive">Det här är ett personnummer. Välj Enskild firma.</span>
    : typed >= 10 && !digits ? <span className="text-destructive">Numret stämmer inte. Kontrollera siffrorna.</span>
    : undefined;
  const [vatShown, setVatShown] = useState(false);
  const id = (key: string) => `${idPrefix}-${key}`;
  const has = (group: CompanyDetailsGroup) => groups.includes(group);
  const hint = digits ? vatNumberHint(digits) : "";
  return <div className={cn("grid gap-4 sm:grid-cols-2", className)} data-testid={`${idPrefix}-details`}>
    {has("company") ? <>
      {typeChoice ? <div className="col-span-full grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Typ av företag" data-testid={`${idPrefix}-type`}>
        <ChoiceCard name={id("type")} value="company" checked={!soleTrader} onChange={() => set("companyType", "company")} title="Aktiebolag eller annat företag" disabled={disabled} />
        <ChoiceCard name={id("type")} value="soleTrader" checked={soleTrader} onChange={() => set("companyType", "soleTrader")} title="Enskild firma" disabled={disabled} />
      </div> : null}
      <div className="grid min-w-0 content-start gap-1.5">
        <Field id={id("organizationNumber")} label={partyNumberLabel(value.companyType)} value={value.organizationNumber} onChange={(next) => set("organizationNumber", next)} placeholder={soleTrader ? "ÅÅMMDD-NNNN" : "NNNNNN-NNNN"} autoComplete="off" disabled={disabled || masked}
          help={numberHelp} />
        {soleTrader
          ? masked ? null : <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-scb-sole`}>Personnumret slås inte upp. Skriv namn och adress själv.</p>
          : <ScbLookupButton number={value.organizationNumber} testId={`${idPrefix}-scb`} endpoint={lookupEndpoint} auto={autoLookup}
            onFound={(found) => onChange({ ...value, name: found.name || value.name, address: found.address || value.address, postalCode: found.postalCode || value.postalCode, city: found.city || value.city })} />}
      </div>
      <Field id={id("name")} label={nameLabel} value={value.name} onChange={(next) => set("name", next)} required={nameRequired} autoComplete="organization" disabled={disabled} />
    </> : null}
    {has("address") ? <>
      {addressSearch
        ? <StreetField id={id("address")} label="Adress" value={value.address} onChange={(next) => set("address", next)} onPick={(choice) => onChange({ ...value, address: choice.address, postalCode: choice.postalCode, city: choice.city })} />
        : <Field id={id("address")} label="Adress" value={value.address} onChange={(next) => set("address", next)} autoComplete="street-address" disabled={disabled} />}
      <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-4 sm:col-span-1">
        <Field id={id("postalCode")} label="Postnummer" value={value.postalCode} onChange={(next) => set("postalCode", next)} autoComplete="postal-code" disabled={disabled} />
        <Field id={id("city")} label="Ort" value={value.city} onChange={(next) => set("city", next)} autoComplete="address-level2" disabled={disabled} />
      </div>
    </> : null}
    {has("contact") ? <>
      <Field id={id("contactName")} label="Kontaktperson" value={value.contactName} onChange={(next) => set("contactName", next)} autoComplete="name" disabled={disabled} />
      <Field id={id("email")} label="E-post" type="email" value={value.email} onChange={(next) => set("email", next)} autoComplete="email" disabled={disabled} />
      <Field id={id("phone")} label="Telefon" type="tel" value={value.phone} onChange={(next) => set("phone", next)} autoComplete="tel" disabled={disabled} />
      {billingEmail ? <Field id={id("billingEmail")} label="Faktura-e-post" type="email" value={value.billingEmail} onChange={(next) => set("billingEmail", next)} disabled={disabled} /> : null}
    </> : null}
    {has("documents") ? <>
      <Field id={id("registeredOffice")} label="Säte" value={value.registeredOffice} onChange={(next) => set("registeredOffice", next)} disabled={disabled} help="Kommunen där företaget har sitt säte. Står på offerter och fakturor." />
      <div className="grid min-w-0 content-start gap-1.5">
        <Field id={id("vatNumber")} label="Momsregistreringsnummer" value={value.vatNumber} onChange={(next) => set("vatNumber", next)} disabled={disabled} />
        {hint && !value.vatNumber && !vatShown ? <button type="button" className="w-fit text-xs font-medium text-primary underline underline-offset-4" onClick={() => { set("vatNumber", hint); setVatShown(true); }} data-testid={`${idPrefix}-vat-hint`}>Använd {hint}</button> : null}
      </div>
      <Field id={id("bankgiro")} label="Bankgiro" value={value.bankgiro} onChange={(next) => set("bankgiro", next)} placeholder="Till exempel 123-4567" disabled={disabled} />
      <Field id={id("plusgiro")} label="Plusgiro" value={value.plusgiro} onChange={(next) => set("plusgiro", next)} placeholder="Till exempel 12 34 56-7" disabled={disabled} />
      <CheckField className="sm:col-span-2" id={id("fSkatt")} label="Godkänd för F-skatt" description="Står i avsändarrutan på offerter, protokoll och andra kunddokument." checked={value.fSkatt} onChange={(next) => set("fSkatt", next)} disabled={disabled} testId={`${idPrefix}-fskatt`} />
    </> : null}
  </div>;
}

/** What the company's documents still lack, in one short line; nothing when nothing is missing. */
export function CompanyGapsNote({ gaps, testId = "company-gaps", className }: { gaps: readonly { label: string }[]; testId?: string; className?: string }) {
  if (!gaps.length) return null;
  return <p role="status" className={cn("rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground", className)} data-testid={testId}>
    <span className="font-medium text-foreground">Saknas på dokumenten:</span> {gaps.map((gap) => gap.label).join(", ")}.
  </p>;
}
