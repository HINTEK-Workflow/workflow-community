"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { CustomerItem } from "./types";

/**
 * Customer choices with their facilities for the project form, the task editor, the link guide and the round schedule.
 * Read from /api/workspace?action=customers only while such a view is shown (Daniel 2026-09-26: fetch only what is
 * shown), shared between components and read again after `invalidateCustomerOptions`, for example when a customer is
 * saved. Bounded (2026-09-30): at most CUSTOMER_OPTION_LIMIT are read; a company with more gets a search next to the
 * choice (`CustomerSearchBox`) that asks the server and adds the picked customer to the options.
 */
export const CUSTOMER_OPTION_LIMIT = 300;

let cached: Promise<CustomerItem[]> | null = null;
let truncated = false;
let added: CustomerItem[] = [];
let generation = 0;
const listeners = new Set<() => void>();
const notify = () => { generation += 1; listeners.forEach((listener) => listener()); };

export function invalidateCustomerOptions() {
  cached = null;
  added = [];
  notify();
}

function load() {
  cached ??= api<{ customers: CustomerItem[] }>(`/api/workspace?action=customers&limit=${CUSTOMER_OPTION_LIMIT + 1}`).then((result) => {
    truncated = result.customers.length > CUSTOMER_OPTION_LIMIT;
    return result.customers.slice(0, CUSTOMER_OPTION_LIMIT);
  }).catch((error) => { cached = null; throw error; });
  return cached;
}

/** A customer found by the search joins the options (so a select can show it as chosen). */
export function addCustomerOption(customer: CustomerItem) {
  if (added.some((item) => item.id === customer.id)) return;
  added = [...added, customer];
  notify();
}

export async function searchCustomerOptions(query: string) {
  const result = await api<{ customers: CustomerItem[] }>(`/api/workspace?action=customers&q=${encodeURIComponent(query)}&limit=25`);
  return result.customers.filter((customer) => !customer.deletedAt);
}

function useGeneration() {
  const [version, setVersion] = useState(generation);
  useEffect(() => {
    const listener = () => setVersion(generation);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return version;
}

export function useCustomerOptions(enabled: boolean) {
  const [state, setState] = useState<{ generation: number; customers: CustomerItem[] } | null>(null);
  const version = useGeneration();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const current = version;
    load().then((customers) => { if (active) setState({ generation: current, customers }); }).catch(() => { if (active) setState({ generation: current, customers: [] }); });
    return () => { active = false; };
  }, [enabled, version]);
  const loaded = state?.customers ?? [];
  return added.length ? [...loaded, ...added.filter((item) => !loaded.some((customer) => customer.id === item.id))] : loaded;
}

/** Whether the company has more customers than the options hold (then the search is shown). */
export function useCustomerOptionsTruncated() {
  useGeneration();
  const [value, setValue] = useState(truncated);
  useEffect(() => { let active = true; void load().then(() => { if (active) setValue(truncated); }).catch(() => undefined); return () => { active = false; }; }, []);
  return value;
}
