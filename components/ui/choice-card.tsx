"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ett val som kort (2026-10-03: "snygga till dessa checkrutor"): the whole card is the choice, a round mark in
 * the corner turns into a filled check when it is chosen, and the chosen card gets the primary border. A real radio
 * input underneath keeps the keyboard and screen readers working as for any radio group.
 */
export function ChoiceCard({ name, value, checked, onChange, title, description, badge, disabled }: {
  name: string; value: string; checked: boolean; onChange: (value: string) => void; title: React.ReactNode; description?: React.ReactNode; badge?: React.ReactNode; disabled?: boolean;
}) {
  return <label className={cn(
    "group relative flex cursor-pointer gap-3 rounded-xl border bg-card p-4 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring/40",
    checked ? "border-primary bg-secondary/50 shadow-sm" : "hover:border-primary/40 hover:bg-secondary/20",
    disabled && "cursor-not-allowed opacity-60",
  )} data-checked={checked || undefined}>
    <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} className="sr-only" />
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">{title}{badge ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{badge}</span> : null}</span>
      {description ? <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span> : null}
    </span>
    <span aria-hidden="true" className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
      checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background")}>
      {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  </label>;
}
