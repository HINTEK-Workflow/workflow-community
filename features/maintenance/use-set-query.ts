"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * The page's place is in the address (`&tab=store`, `&place=`, `&part=`, `&store=`, `&article=`, `&item=`), so a link, a reload and
 * Bakåt open the same thing: choosing replaces the entry, opening something of its own adds one (as the customer card opens a place).
 */
export function useSetQuery() {
  const router = useRouter();
  return useCallback((patch: Record<string, string | null>, push = false) => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(patch)) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
    const next = `${url.pathname}?${url.searchParams}`;
    if (push) router.push(next, { scroll: false }); else router.replace(next, { scroll: false });
  }, [router]);
}
