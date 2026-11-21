"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDetailLevel, useNativeMode } from "@/features/workflow/use-detail-level";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { usePageActionsSlot } from "@/components/page-shell";
import { useRegisterEditorActions } from "@/components/workspace-actions";
import { customerHasAddress, firstPlaceFailed } from "@/lib/kfid/customer-first-place";
import { announce } from "@/lib/workflow/toast";
import { DISCARD_QUESTION, useConfirm } from "./confirm";
import { DiscardContext } from "./ui";
import { DialogPage } from "./dialog-page";
import {
  blankCustomerForm, cloudReadCustomer, cloudSaveCustomer, CustomerForm, customerFormOf,
  type CustomerFormLayout, type CustomerFormValue, type ReadCustomer, type SaveCustomer, type SavedCustomer,
} from "./customer-form-dialog";
import { DUPLICATE_CUSTOMER_QUESTION, findDuplicateCustomer } from "./customer-options";
import { customerCardHref } from "./customer-register-layout";
import type { CustomerItem } from "./types";

/**
 * Ny kund in the customer register (plan 1Q, 2026-10-11): the size of "Lägg till instrument" decides, the display
 * decides how – size "form" is a popup on display 3 (computer), a page on display 2 (tablet, or a phone that chose 2) and a
 * screen at level 1. The few important fields come first and the rest sit under "Fler uppgifter" in the popup; the page
 * has every field in folded sections (Kontakt open). Same fields, rules and save as the customer's edit.
 */
export function CustomerCreateDialog({ open, onOpenChange, save = cloudSaveCustomer, onSaved, idPrefix = "customer", submitLabel = "Spara kund", title = "Ny kund", message = "Kunden är skapad." }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  save?: SaveCustomer;
  onSaved: (customer: SavedCustomer) => void;
  /** The fields' ids (`customer-name`, `local-customer-name`, …). */
  idPrefix?: string;
  submitLabel?: string;
  title?: string;
  message?: string;
}) {
  return <DialogPage open={open} onOpenChange={onOpenChange} pageKey="ny-kund" title={title} panelTitle="Kunduppgifter" size="form"
    description="Kundens uppgifter används i alla projekt, arbetsordrar och protokoll där kunden är vald.">
    <CustomerCreateForm save={save} onSaved={onSaved} onClose={() => onOpenChange(false)} idPrefix={idPrefix} submitLabel={submitLabel} message={message} />
  </DialogPage>;
}

function CustomerCreateForm({ save, onSaved, onClose, idPrefix, submitLabel, message }: { save: SaveCustomer; onSaved: (customer: SavedCustomer) => void; onClose: () => void; idPrefix: string; submitLabel: string; message: string }) {
  const native = useNativeMode();
  const level = useDetailLevel();
  const layout: CustomerFormLayout = native ? "full" : level === 2 ? "sections" : "compact";
  const [value, setValue] = useState<CustomerFormValue>(blankCustomerForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // "Skapa en plats med samma adress" (2026-10-10): on from the start, shown once an address is written.
  const [firstPlace, setFirstPlace] = useState(true);
  const router = useRouter();
  const [confirm, confirmElement] = useConfirm();
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const duplicate = save === cloudSaveCustomer ? await findDuplicateCustomer(value.name, value.company) : null;
      if (duplicate) {
        const answer = await confirm({ title: "Kunden finns redan", message: DUPLICATE_CUSTOMER_QUESTION, confirmLabel: "Skapa ändå", alternative: { label: "Öppna den som finns" } });
        if (answer === "alternative") { onClose(); router.push(customerCardHref(duplicate.id)); return; }
        if (!answer) return;
      }
      const customer = await save(value, null, { firstPlace: firstPlace && customerHasAddress(value) });
      if (customer.firstPlaceError) announce(firstPlaceFailed(customer.firstPlaceError), true);
      else announce(message);
      onSaved(customer);
      onClose();
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };
  return <><CustomerForm idPrefix={idPrefix} layout={layout} value={value} onChange={setValue} busy={busy} error={error} submitLabel={submitLabel} onSubmit={submit} onCancel={onClose}
    firstPlace={{ checked: firstPlace, onChange: setFirstPlace }} />{confirmElement}</>;
}

/**
 * Redigera kund on the same page (plan 1Q, 2026-10-11): the customer's form folds out in the register's row or on
 * the customer card with the same Avbryt and Spara, no popup and no page of its own. Every field, as in the register's
 * old edit page. The customer is read again first, so the version is the current one. Unsaved changes are asked about when
 * the page is left, like on every other form.
 */
export function CustomerInlineEdit({ customerId, read = cloudReadCustomer, save = cloudSaveCustomer, onClose, onSaved, idPrefix = "customer", submitLabel = "Spara kund", message = "Kunden är uppdaterad." }: {
  customerId: string;
  read?: ReadCustomer;
  save?: SaveCustomer;
  /** Avbryt, or after a successful save. */
  onClose: () => void;
  onSaved?: (customer: SavedCustomer) => void;
  idPrefix?: string;
  submitLabel?: string;
  message?: string;
}) {
  const [existing, setExisting] = useState<CustomerItem | null>(null);
  const [value, setValue] = useState<CustomerFormValue>(blankCustomerForm);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, confirmElement] = useConfirm();
  const root = useRef<HTMLDivElement | null>(null);
  // The reader may be made new on every render (Local): only the customer decides when it is read.
  const reader = useRef(read);
  useEffect(() => { reader.current = read; });
  useEffect(() => {
    let current = true;
    reader.current(customerId)
      .then((customer) => { if (current) { setExisting(customer); setValue(customerFormOf(customer)); setLoaded(true); } })
      .catch((issue: Error) => { if (current) { setError(issue.message); setLoaded(true); } });
    return () => { current = false; };
  }, [customerId]);
  // Brought into view when it folds out.
  useEffect(() => { root.current?.scrollIntoView?.({ block: "nearest" }); }, [loaded]);
  useUnsavedGuard(dirty && !busy, confirm);
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const saved = await save(value, existing, {});
      setDirty(false);
      announce(message);
      onSaved?.(saved);
      onClose();
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };
  // The bottom bar's Spara and the floating navigation's Avbryt/Spara (2026-10-27) press the form's own buttons – in the page
  // header's slot on the customer card, in the form itself in the register's row – so its checks and question hold.
  const slot = usePageActionsSlot()?.slot ?? null;
  const press = (role: "primary" | "cancel") => (slot ?? root.current)?.querySelector<HTMLButtonElement>(`[data-dialog-role="${role}"]`)?.click();
  useRegisterEditorActions({ save: () => press("primary"), canSave: loaded && Boolean(existing) && !busy, busy, dirty, cancel: () => press("cancel") });
  // Avbryt asks when something is changed (2026-10-13), through the form's own buttons (DialogActions).
  const mayDiscard = async () => !dirty || confirm(DISCARD_QUESTION);
  return <DiscardContext.Provider value={mayDiscard}><div ref={root} className="min-w-0" data-testid="customer-inline-edit">
    {confirmElement}
    {!loaded ? <p role="status" className="text-sm text-muted-foreground">Hämtar kunden…</p>
      : !existing ? <p role="alert" className="text-sm text-destructive">{error || "Kunden hittades inte."}</p>
      : <CustomerForm idPrefix={idPrefix} layout="full" value={value} onChange={(next) => { setValue(next); setDirty(true); }} busy={busy} error={error}
        submitLabel={submitLabel} onSubmit={submit} onCancel={() => { setDirty(false); onClose(); }} />}
  </div></DiscardContext.Provider>;
}
