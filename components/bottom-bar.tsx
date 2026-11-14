"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Home, LoaderCircle, Menu, Plus, Save, Search } from "lucide-react";
import type { BottomBarSlotKey } from "@/lib/workflow/bottom-bar";

/**
 * Bottenraden (2026-10-09): one shared bar on phone and tablet whose buttons follow the working mode
 * (lib/workflow/bottom-bar.ts). The shell draws it for ordinary pages and editors; since plan 1O (2026-10-11) there is no
 * temporary view with a bar of its own.
 */
export const BOTTOM_BAR_ICON: Record<BottomBarSlotKey, LucideIcon> = { home: Home, search: Search, new: Plus, save: Save, menu: Menu };

type ButtonProps = ComponentPropsWithoutRef<"button"> & { icon: LucideIcon; label: string; busy?: boolean; dirty?: boolean; create?: boolean; slot?: string };

/** One place in the bar: icon over a short word, at least 44 × 44 px. */
export const BottomBarButton = forwardRef<HTMLButtonElement, ButtonProps>(function BottomBarButton({ icon: Icon, label, busy = false, dirty = false, create = false, slot, className, ...rest }, ref) {
  return <button ref={ref} type="button" className={[create ? "nav-create" : "", className ?? ""].join(" ").trim() || undefined} data-slot-key={slot} {...rest}>
    <span className="nav-icon">{busy ? <LoaderCircle className="animate-spin" /> : <Icon />}{dirty ? <span className="nav-dirty" /> : null}</span><span>{label}</span>
  </button>;
});

/** The content of a bar link (Hem), drawn the same as a button. */
export function BottomBarLinkContent({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return <><span className="nav-icon"><Icon /></span><span>{label}</span></>;
}
