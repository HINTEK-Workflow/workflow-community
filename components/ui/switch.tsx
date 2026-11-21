"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Brytare (UX-granskningen C4, 2026-10-22): an on/off choice that takes effect at once, for the company's settings
 * (Arbetssätt, Workflow AI). A choice in a form that is saved with the form stays a Checkbox. Use it through `SwitchRow`
 * (features/kfid/ui.tsx), which gives the row its title, one line of text and the touch height.
 */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root data-slot="switch"
    className={cn("peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/40", className)}
    {...props}>
    <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5" />
  </SwitchPrimitive.Root>;
}
