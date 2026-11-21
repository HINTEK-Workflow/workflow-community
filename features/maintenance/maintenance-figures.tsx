"use client";

import { cn } from "@/lib/utils";

/**
 * A figure box on Underhåll's and Förrådets cards (label, value, a short hint): the same box everywhere. The grid around it decides the
 * columns by its container (`@container` and `@2xl:grid-cols-4`), so the box fits whatever the card has beside it. Inside a `<dl>`.
 */
export function FigureBox({ label, value, hint, testId, className }: { label: string; value: string; hint?: string; testId?: string; className?: string }) {
  return <div className={cn("min-w-0 rounded-lg border p-3", className)} data-testid={testId}>
    <dt className="truncate text-xs text-muted-foreground" title={label}>{label}</dt>
    <dd className="mt-1 truncate text-lg font-semibold tabular-nums" title={value}>{value}</dd>
    {hint ? <dd className="line-clamp-2 text-xs text-muted-foreground" title={hint}>{hint}</dd> : null}
  </div>;
}
