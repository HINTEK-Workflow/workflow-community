"use client";

import { cn } from "@/lib/utils";

/**
 * Ett val som kort (2026-10-03: "snygga till dessa checkrutor"; 2026-10-04: "ta bort ringarna i rutan om de
 * inte behövs"): the whole card is the choice, with no mark of its own – the chosen card has the primary border, a
 * faint tint and a tinted badge. A real radio input underneath keeps the keyboard and screen readers working as for
 * any radio group.
 */
export function ChoiceCard({ name, value, checked, onChange, title, description, badge, disabled }: {
  name: string; value: string; checked: boolean; onChange: (value: string) => void; title: React.ReactNode; description?: React.ReactNode; badge?: React.ReactNode; disabled?: boolean;
}) {
  return <label className={cn(
    "group relative flex cursor-pointer items-start rounded-xl border bg-card px-4 py-3.5 text-sm transition-[border-color,box-shadow,background-color] focus-within:ring-2 focus-within:ring-ring/40",
    checked ? "border-primary bg-primary/[0.04] shadow-[inset_0_0_0_1px_var(--primary)]" : "hover:border-primary/50",
    disabled && "cursor-not-allowed opacity-60",
  )} data-checked={checked || undefined}>
    <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} className="sr-only" />
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold leading-5 text-foreground">{title}{badge ? <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        checked ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{badge}</span> : null}</span>
      {description ? <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span> : null}
    </span>
  </label>;
}
