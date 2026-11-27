"use client";

import type { KeyboardEvent, Ref } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * The list's search: the magnifier inside the field, the whole row on a phone and the rest of the row from 640 px. Part of the list's
 * filter row (components/list-filter-bar.tsx re-exports it), in a file of its own so a public page can use it without the app's list
 * row. Variant (2026-11-24, the public film page): `id` for a visible <label> of its own, `onKeyDown` (Esc empties it there), `inputRef`.
 * The field is as high as the buttons beside it (2026-11-25, ärende #8): 34 px with a mouse, 44 px on a touch screen or under 1024 px
 * (`touch:min-h-11`, the same rule as every [data-slot=button]; inside the app's main area it already was, on a public page it was not).
 */
export function ListSearch({ label, placeholder, value, onChange, testId, id, onKeyDown, inputRef }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; testId?: string; id?: string; onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void; inputRef?: Ref<HTMLInputElement> }) {
  return <div className="list-search relative min-w-0 basis-full sm:basis-auto sm:flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <Input ref={inputRef} id={id} type="search" aria-label={id ? undefined : label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} className="pl-9 touch:min-h-11" data-testid={testId} /></div>;
}
