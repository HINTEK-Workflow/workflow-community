"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api } from "@/features/kfid/api";
import { isCalculatorKey } from "@/lib/calculators/company-data";
import type { CompanyValue, CompanyValueInput } from "@/lib/workflow/company-values";

/**
 * Where the Räkneverktyg get the company's own values (2026-10-07). Cloud and the demo read them from
 * /api/calculator-values, which applies the same rule as the values themselves; Local keeps them in the open file, so
 * the Local workspace (which is mounted all the time and holds the file) publishes them here and the page reads them
 * from this small store. Without an open file the tools still work with the person's own values.
 *
 * Saving (2026-10-12, the phone's screen Företagets värden): the same write as Inställningar → Värden och
 * referenser, /api/company-values, where the server checks that the person administers the company. In Local the
 * workspace publishes, with the values, the same write to the file as that settings page (only for the company's
 * administrator); without it the values are read only.
 */
export type LocalCompanyValues = {
  /** Every value in the open file; the calculators read the `kabel.` ones. */
  values: readonly CompanyValue[];
  /** Writes the rows to the open file and returns the file's values afterwards; null when the person may not change them. */
  save: ((inputs: CompanyValueInput[]) => Promise<readonly CompanyValue[]>) | null;
};
let fileSource: LocalCompanyValues | null = null;
const listeners = new Set<() => void>();
/** Called by the Local workspace when a file is opened, after every change to it, and with null when it is closed. */
export function publishLocalCompanyValues(source: LocalCompanyValues | null) {
  if (fileSource === source || (fileSource && source && fileSource.values === source.values && fileSource.save === source.save)) return;
  fileSource = source;
  listeners.forEach((listener) => listener());
}
export const localCompanyValuesSnapshot = () => fileSource;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export type CompanyValuesState = {
  status: "loading" | "ready" | "unavailable" | "closed";
  values: readonly CompanyValue[];
  /** The person may change the values (a company administrator; in Local the administrator with the file open). */
  canEdit: boolean;
  /** Why the company's values are not there, in words for the page. */
  message: string;
  /** Writes the changed rows and reads the Kalkylator's values back; throws with the server's words when refused. */
  save: (inputs: CompanyValueInput[]) => Promise<void>;
};
type Loaded = Omit<CompanyValuesState, "save">;
const LOADING: Loaded = { status: "loading", values: [], canEdit: false, message: "" };
const NO_VALUES: readonly CompanyValue[] = [];
const CLOSED_MESSAGE = "Öppna den lokala arbetsytan så används också företagets egna värden.";
const READ_ONLY_MESSAGE = "Företagets värden ändras av en företagsadministratör.";

/** What the calculators get in Local: the open file's calculator values, or "closed" when no file is open. */
export function localCalcValuesState(source: LocalCompanyValues | null): Loaded {
  if (!source) return { status: "closed", values: NO_VALUES, canEdit: false, message: CLOSED_MESSAGE };
  return { status: "ready", values: source.values.filter((value) => isCalculatorKey(value.key)), canEdit: Boolean(source.save), message: "" };
}

/** The Kalkylator's save in Local: through the open file's writer, refused in words when there is none. */
export async function saveLocalCalcValues(source: LocalCompanyValues | null, inputs: CompanyValueInput[]) {
  if (!source) throw new Error(CLOSED_MESSAGE);
  if (!source.save) throw new Error(READ_ONLY_MESSAGE);
  await source.save(inputs);
}

export function useCompanyCalcValues(local: boolean): CompanyValuesState {
  const file = useSyncExternalStore(subscribe, localCompanyValuesSnapshot, () => null);
  const fileState = useMemo(() => localCalcValuesState(file), [file]);
  const [remote, setRemote] = useState<Loaded>(LOADING);
  useEffect(() => {
    if (local) return;
    let cancelled = false;
    api<{ canEdit: boolean; values: CompanyValue[] }>("/api/calculator-values", { cache: "no-store" })
      .then((data) => { if (!cancelled) setRemote({ status: "ready", values: data.values, canEdit: data.canEdit, message: "" }); })
      .catch((error: Error) => { if (!cancelled) setRemote({ status: "unavailable", values: NO_VALUES, canEdit: false, message: error.message }); });
    return () => { cancelled = true; };
  }, [local]);
  const save = useCallback(async (inputs: CompanyValueInput[]) => {
    // Local: the open file's writer; the workspace publishes the file's new values after the write.
    if (local) return saveLocalCalcValues(localCompanyValuesSnapshot(), inputs);
    const data = await api<{ values: CompanyValue[] }>("/api/company-values", { method: "POST", body: JSON.stringify({ values: inputs }) });
    setRemote((current) => ({ ...current, values: data.values.filter((value) => isCalculatorKey(value.key)) }));
  }, [local]);
  return { ...(local ? fileState : remote), save };
}
