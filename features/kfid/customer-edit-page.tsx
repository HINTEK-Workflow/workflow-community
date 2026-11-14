"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StandardPage, usePageTrail } from "@/components/page-shell";
import { previousEntryUrl, returnToOrigin } from "@/components/history-nav";
import { useRegisterEditorActions } from "@/components/workspace-actions";
import { NativeLead } from "@/components/native/screen";
import { useNativeTopBar } from "@/components/native/top-bar";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { safeReturnTo } from "@/lib/workflow/navigation";
import { returnWithPick } from "@/lib/workflow/return-link";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { announce } from "@/lib/workflow/toast";
import { DiscardContext, Panel } from "./ui";
import { DISCARD_QUESTION, useConfirm } from "./confirm";
import { blankCustomerForm, cloudReadCustomer, cloudSaveCustomer, CustomerForm, customerFormOf, type CustomerFormValue } from "./customer-form-dialog";
import type { CustomerItem } from "./types";
import { customerHasAddress, firstPlaceFailed } from "@/lib/kfid/customer-first-place";

/**
 * Kunduppgifter redigeras i kundregistret (2026-10-09). From plan 1Q (2026-10-11) this page is only the way out and
 * back: level 1's form screen, and "Redigera kund" or "Lägg till kund" from a work order, a protocol or another form on
 * display 2 (the work is left and comes back with its draft). In the register and on the customer card the form folds out
 * in place (customer-register-forms.tsx); a new customer there is a popup (display 3) or a page (display 2). With
 * `returnTo` (the work it was opened from) Spara and Avbryt lead back there: a step back in the history when that is
 * where the person came from, so the work keeps its scroll and draft; a new customer is chosen there on return.
 * Nivå 1 på mobil (2026-10-10) it is a form screen: Avbryt and Spara in the top bar, the fields as the phone's grouped
 * list, no page heading or panel frame. On phone and tablet the bottom bar's Spara saves it (Editor mode).
 */
export function CustomerEditPage({ customerId, returnTo: requested }: { customerId: string | null; returnTo: string | null }) {
  const router = useRouter();
  const returnTo = safeReturnTo(requested);
  const [existing, setExisting] = useState<CustomerItem | null>(null);
  const [value, setValue] = useState<CustomerFormValue>(blankCustomerForm);
  const [loaded, setLoaded] = useState(!customerId);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // "Skapa en plats med samma adress" (2026-10-10): only for a new customer, on from the start.
  const [firstPlace, setFirstPlace] = useState(true);
  const [confirm, confirmElement] = useConfirm();
  usePageTrail({ customer: existing?.name });
  useEffect(() => {
    if (!customerId) return;
    let current = true;
    cloudReadCustomer(customerId)
      .then((customer) => { if (current) { setExisting(customer); setValue(customerFormOf(customer)); setLoaded(true); } })
      .catch((issue: Error) => { if (current) { setError(issue.message); setLoaded(true); } });
    return () => { current = false; };
  }, [customerId]);
  // Unsaved changes are asked about on every way out, like an editor's (lib/workflow/use-unsaved-guard.ts).
  const releaseBack = useUnsavedGuard(dirty && !busy, confirm, undefined, { browserBack: true });
  // Avbryt asks when something is changed (2026-10-13), through the form's own buttons (DialogActions).
  const mayDiscard = useCallback(async () => !dirty || confirm(DISCARD_QUESTION), [dirty, confirm]);
  const leave = (saved: CustomerItem | null) => {
    if (returnTo) {
      // Samband (2026-10-26): back one step to the job as it was; a new customer is chosen there (pickCustomer). The
      // form's own visit is stepped past, so Bakåt from the job never lands on the filled-in form again (2026-10-13).
      returnToOrigin(returnTo, router.push, { then: saved && !customerId ? returnWithPick(returnTo, "Customer", saved.id) : undefined, replace: (href) => router.replace(href, { scroll: false }) });
      return;
    }
    // Avbryt goes back to where the person was (like Ny uppgift and Nytt projekt), not always to the register.
    if (!saved && previousEntryUrl()) { window.history.back(); return; }
    const id = saved?.id ?? customerId;
    // After Spara the form's address is replaced by the customer's: "‹ Kunder" then leads to the register, never back to a
    // blank Ny kund (2026-10-13).
    const next = id ? `/?view=customers&customerId=${encodeURIComponent(id)}` : "/?view=customers";
    if (saved) router.replace(next); else router.push(next);
  };
  const submit = async () => {
    // Off the browser-back entry first, so the saved customer takes the form's own entry in the history.
    await releaseBack();
    setBusy(true); setError("");
    try {
      const saved = await cloudSaveCustomer(value, existing, { firstPlace: !customerId && firstPlace && customerHasAddress(value) });
      setDirty(false);
      if (saved.firstPlaceError) announce(firstPlaceFailed(saved.firstPlaceError), true);
      else announce(customerId ? "Kunden är uppdaterad." : returnTo ? "Kunden är skapad och vald." : "Kunden är skapad.");
      leave(saved);
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };
  const title = customerId ? "Redigera kund" : "Ny kund";
  const native = useNativeMode();
  const page = useRef<HTMLDivElement | null>(null);
  // The form's own Spara and Avbryt (DialogActions), pressed from the top bar or the bottom bar, so its checks hold.
  const press = (role: "primary" | "cancel") => page.current?.querySelector<HTMLButtonElement>(`[data-dialog-role="${role}"]`)?.click();
  const ready = loaded && (!customerId || Boolean(existing));
  useRegisterEditorActions({ save: () => press("primary"), canSave: ready && !busy, busy, dirty, cancel: () => press("cancel") });
  useNativeTopBar(native ? { title, cancel: { onClick: () => press("cancel") }, save: { label: "Spara", busy, disabled: !ready, onClick: () => press("primary") } } : null);
  const panel = <Panel title={existing?.name || (customerId ? "Kund" : "Kunduppgifter")}>
    {!loaded ? <p role="status" className="text-sm text-muted-foreground">Hämtar kunden…</p>
      : customerId && !existing ? <p role="alert" className="text-sm text-destructive">{error || "Kunden hittades inte."}</p>
      : <CustomerForm layout={customerId || native ? "full" : "sections"} value={value} onChange={(next) => { setValue(next); setDirty(true); }} busy={busy} error={error}
        submitLabel={returnTo ? (customerId ? "Spara och gå tillbaka" : "Spara och välj kunden") : "Spara kund"} onSubmit={submit}
        onCancel={() => { setDirty(false); leave(null); }} firstPlace={customerId ? undefined : { checked: firstPlace, onChange: setFirstPlace }} />}
  </Panel>;
  return <DiscardContext.Provider value={mayDiscard}><div ref={page} className={native ? "native-screen native-bar-actions" : "mx-auto w-full"} data-testid="customer-edit-page">
    {confirmElement}
    {/* The standard top (2026-10-26): the form's Avbryt and Spara stand top right and stay in sight, as on every form page. */}
    {native ? <NativeLead>{panel}</NativeLead> : <StandardPage title={title} description={returnTo ? "Ändringen gäller kunden överallt." : "Används i alla projekt, arbetsordrar och protokoll med kunden."}>
      {panel}
    </StandardPage>}
  </div></DiscardContext.Provider>;
}
