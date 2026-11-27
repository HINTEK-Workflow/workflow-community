"use client";

import { useCallback, useContext, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageBackButton } from "@/components/page-shell";
import { DiscardContext } from "@/features/kfid/ui";
import { leaveWithoutAsking } from "@/lib/workflow/leave-guard";

/**
 * A record of Egenkontroll's lists on its own page (a role, a person, a hired person; 2026-11-24, "som när man öppnar en
 * kund"): "Tillbaka till <listan>" in the page's top beside Avbryt and Spara. It asks first when something is changed, as Avbryt
 * does (DiscardContext), and goes back to the list – which kept its filter and search, since the list stays under the page.
 */
export function BackToList({ list, onBack }: { list: string; onBack: () => void }) {
  const mayDiscard = useContext(DiscardContext);
  return <PageBackButton label={`Tillbaka till ${list}`} testId="record-back" onClick={() => void (async () => {
    if (mayDiscard && !(await mayDiscard())) return;
    leaveWithoutAsking();
    onBack();
  })()} />;
}

/**
 * The record a list opens: from a click on a row, or from the address (`&role=`, `&person=`, `&hired=`), so a cross-link from
 * another part opens it. Closing takes the value out of the address again, so Bakåt does not open it once more.
 */
export function useOpenRecord<T>(param: string, find: (id: string) => T | null) {
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState<T | null>(() => { const id = params.get(param); return id ? find(id) : null; });
  const close = useCallback(() => {
    setOpen(null);
    if (!params.get(param)) return;
    const next = new URLSearchParams(params.toString());
    next.delete(param);
    next.delete("page");
    router.replace(`/?${next.toString()}`, { scroll: false });
  }, [params, param, router]);
  return [open, setOpen, close] as const;
}
