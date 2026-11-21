"use client";

import { useEffect, useRef, useState } from "react";
import { clearReturnDraft, readReturnDraft, registerReturnDraft } from "@/lib/workflow/return-draft";

/**
 * A form that can be left for a register page and come back (lib/workflow/return-draft.ts), in two calls:
 * `useReturnDraft(name)` before the form's own state is made – its values are the state's starting values
 * (`draft?.name ?? ""`), so a chosen post that arrives with the return (pickCustomer) is applied on top of them – and
 * `useReturnDraftValues(name, values)` after it, which hands the current values over when the person leaves.
 */
export function useReturnDraft<T>(name: string): T | null {
  const [draft] = useState<T | null>(() => (typeof window === "undefined" ? null : readReturnDraft<T>(name)));
  // Used once: a later visit to the form starts fresh again.
  useEffect(() => { if (draft) clearReturnDraft(name); }, [draft, name]);
  return draft;
}

export function useReturnDraftValues<T>(name: string, values: T) {
  const latest = useRef(values);
  useEffect(() => { latest.current = values; });
  useEffect(() => registerReturnDraft(name, () => latest.current), [name]);
}
