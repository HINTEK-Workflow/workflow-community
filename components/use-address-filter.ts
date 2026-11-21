"use client";

import { useSearchParams } from "next/navigation";
import { useEntryState } from "./history-nav";

/**
 * A list's filter that an address may choose (dashboard etapp 3, 2026-10-28; keys in lib/url-filters.ts), kept per
 * history entry like the list's other filters (useEntryState). A value in the address that the list allows wins once – when
 * the visit starts, or when the address brings a new value – and the person's own choice on the visit wins after that, so
 * Bakåt from a row shows what was chosen, not what the key figure asked for. A missing or unknown value leaves the list as
 * it would have started. `parse` returns null for a value the list does not allow.
 */
export function useAddressEntryState<T>(name: string, key: string, parse: (raw: string) => T | null, initial: T): [T, (value: T | ((current: T) => T)) => void] {
  const address = useSearchParams();
  const raw = address.get(key);
  const fromAddress = raw === null ? null : parse(raw);
  const seed = fromAddress === null ? "" : raw!;
  const [value, setValue] = useEntryState<T>(name, fromAddress ?? initial);
  const [seeded, setSeeded] = useEntryState<string>(`${name}.@address`, seed);
  // A new value in the address while the list is shown (React's "adjust state when a value changes", set while rendering).
  if (seed && seed !== seeded) { setSeeded(seed); setValue(fromAddress as T); }
  return [value, setValue];
}
