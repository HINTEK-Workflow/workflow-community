"use client";

import { useRef, useState } from "react";
import { usePageActionsSlot } from "@/components/page-shell";
import { useRegisterEditorActions } from "@/components/workspace-actions";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { announce } from "@/lib/workflow/toast";
import { DISCARD_QUESTION, useConfirm } from "./confirm";
import { DialogActions, DiscardContext, Field } from "./ui";
import { api } from "./api";
import { CompanyDetailsFields, companyDetailsOf, type CompanyDetailsValue } from "./company-details-form";
import { MACHINE_CAP_DEFAULT, PLACE_CAP_DEFAULT } from "@/lib/maintenance/caps";

/** What the edit starts from: the product administration's list item (company metadata only, never the company's work). */
export type EditableCustomerCompany = {
  id: string; name: string; isActive: boolean; storageMode: "LOCAL" | "HINTEK_CLOUD";
  organizationNumber: string; companyType?: "company" | "soleTrader"; vatNumber?: string; fSkatt?: boolean; address?: string; postalCode?: string; city: string;
  contactName: string; contactEmail: string; billingEmail: string; phone?: string; registeredOffice?: string; bankgiro?: string; plusgiro?: string;
  machineDailyOrderCap?: number;
  /** Justerbart tak i Underhåll (0.92.0): null or missing = förvalet. */
  maintenanceMachineCap?: number | null; maintenancePlaceCap?: number | null;
};

/** An empty box is the default (null); anything else is sent as a number and checked by the server. */
const capValue = (text: string) => text.trim() === "" ? null : Number(text.trim().replace(/\s/g, ""));

const startOf = (company: EditableCustomerCompany): CompanyDetailsValue => companyDetailsOf(company.name, {
  companyType: company.companyType ?? "company", organizationNumber: company.organizationNumber, vatNumber: company.vatNumber ?? "", fSkatt: company.fSkatt ?? false, address: company.address ?? "", postalCode: company.postalCode ?? "", city: company.city,
  contactName: company.contactName, email: company.contactEmail, phone: company.phone ?? "", billingEmail: company.billingEmail, registeredOffice: company.registeredOffice ?? "", bankgiro: company.bankgiro ?? "", plusgiro: company.plusgiro ?? "",
});

/**
 * Redigera kundföretag, the same way as Redigera kund (2026-11-04): the company's page, its card folds out into the form
 * with the shared Företagsuppgifter fields, and Avbryt and Spara stand top right in the page's header (the parent gives the slot).
 * Unsaved changes are asked about on every way out. Pausa, kreditregel and radering stay where they were. The form carries
 * the company's details and settings only; the server checks again that the caller is the superadmin and never reads work data.
 */
export function CustomerCompanyInlineEdit({ company, billing, onClose, onSaved }: { company: EditableCustomerCompany; billing: boolean; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<CompanyDetailsValue>(() => startOf(company));
  const [storageMode, setStorageMode] = useState(company.storageMode);
  const [cap, setCap] = useState(String(company.machineDailyOrderCap ?? 20));
  const [machineCap, setMachineCap] = useState(company.maintenanceMachineCap == null ? "" : String(company.maintenanceMachineCap));
  const [placeCap, setPlaceCap] = useState(company.maintenancePlaceCap == null ? "" : String(company.maintenancePlaceCap));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, confirmElement] = useConfirm();
  const root = useRef<HTMLDivElement | null>(null);
  useUnsavedGuard(dirty && !busy, confirm);
  const submit = async () => {
    if (!value.name.trim()) { setError("Ange företagets namn."); return; }
    setBusy(true); setError("");
    try {
      await api("/api/superadmin/customer-companies", { method: "PATCH", body: JSON.stringify({
        action: "update_company", organizationId: company.id, name: value.name.trim(), isActive: company.isActive, storageMode,
        contactEmail: value.email.trim(), billingEmail: billing ? value.billingEmail.trim() : company.billingEmail,
        ...(value.companyType === "soleTrader" ? {} : { organizationNumber: value.organizationNumber.trim() }), vatNumber: value.vatNumber.trim(), fSkatt: value.fSkatt, address: value.address.trim(), postalCode: value.postalCode.trim(), city: value.city.trim(),
        contactName: value.contactName.trim(), phone: value.phone.trim(), registeredOffice: value.registeredOffice.trim(), bankgiro: value.bankgiro.trim(), plusgiro: value.plusgiro.trim(),
        machineDailyOrderCap: Number(cap),
        maintenanceMachineCap: capValue(machineCap), maintenancePlaceCap: capValue(placeCap),
      }) });
      setDirty(false);
      announce("Kundföretagets uppgifter är sparade.");
      onSaved();
      onClose();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  // Avbryt and Spara of the bottom bar and the floating navigation press the form's own buttons (in the header's slot), so its checks hold.
  const slot = usePageActionsSlot()?.slot ?? null;
  const press = (role: "primary" | "cancel") => (slot ?? root.current)?.querySelector<HTMLButtonElement>(`[data-dialog-role="${role}"]`)?.click();
  useRegisterEditorActions({ save: () => press("primary"), canSave: !busy, busy, dirty, cancel: () => press("cancel") });
  const mayDiscard = async () => !dirty || confirm(DISCARD_QUESTION);
  const changed = <T,>(setter: (next: T) => void) => (next: T) => { setter(next); setDirty(true); };
  return <DiscardContext.Provider value={mayDiscard}><div ref={root} className="min-w-0" data-testid="customer-company-edit">
    {confirmElement}
    <form className="space-y-5" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }} data-testid="customer-company-form">
      <CompanyDetailsFields idPrefix="customer-company" typeChoice={false} value={value} onChange={changed(setValue)} billingEmail={billing} />
      <fieldset className="field-group space-y-4 rounded-xl border p-4">
        <legend className="px-1 text-sm font-medium">Lagring, maskinlarm och tak</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="customer-company-storage" label="Lagring" value={storageMode} onChange={changed((next: string) => setStorageMode(next as "LOCAL" | "HINTEK_CLOUD"))}
            options={billing && company.storageMode === "LOCAL" ? ["LOCAL"] : ["LOCAL", "HINTEK_CLOUD"]} optionLabels={{ LOCAL: "Lokal lagring", HINTEK_CLOUD: billing ? "serverlagring" : "Lagring på servern" }}
            help={`${billing ? "Cloud kräver verifierad betalning. " : ""}Byte till lokal lagring kräver export.`} />
          <Field id="customer-company-machine-cap" label="Maskinlarm: arbetsordrar per dygn" type="number" value={cap} onChange={changed(setCap)} help="Högst så många automatiska arbetsordrar från maskinlarm per dygn. Förval 20." />
          <Field id="customer-company-maintenance-machines" label="Underhåll: högst antal maskiner" type="number" value={machineCap} placeholder={MACHINE_CAP_DEFAULT.toLocaleString("sv-SE")} onChange={changed(setMachineCap)}
            help={`Tomt betyder förvalet, ${MACHINE_CAP_DEFAULT.toLocaleString("sv-SE")}. Ett lägre tak stoppar bara nya maskiner; de som finns blir kvar.`} />
          <Field id="customer-company-maintenance-places" label="Underhåll: högst antal platser" type="number" value={placeCap} placeholder={PLACE_CAP_DEFAULT.toLocaleString("sv-SE")} onChange={changed(setPlaceCap)}
            help={`Tomt betyder förvalet, ${PLACE_CAP_DEFAULT.toLocaleString("sv-SE")}. Ett lägre tak stoppar bara nya platser; de som finns blir kvar.`} />
        </div>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-destructive" data-testid="customer-company-form-error">{error}</p> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…", testId: "customer-company-save" }} />
    </form>
  </div></DiscardContext.Provider>;
}
