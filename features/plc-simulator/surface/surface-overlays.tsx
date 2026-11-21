"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, Trash2 } from "lucide-react";
import type { OptionDef } from "@/lib/machine/simulator/surface/devices";
import { cn } from "@/lib/utils";

// PLC-simulatorn (ritverktyget, 2026-11-03: "det måste vara tydligt hur man tar bort en linje"): the small
// things laid over the surface. A floating "Ta bort" at what is selected, a short menu on right-click or a long press, and a
// tip with the net under the pointer. Plain positioned elements inside the surface's frame, never a native dialog.

export type MenuItem = { label: string; onPick: () => void; danger?: boolean; hint?: string };

/** The floating remove button at a selected wire or device: the obvious way out, with the keyboard way as its tooltip. */
export function FloatingRemove({ x, y, label, onRemove }: { x: number; y: number; label: string; onRemove: () => void }) {
  return <div className="pointer-events-none absolute z-10" style={{ left: x, top: y }} data-testid="plc-floating-remove">
    <button type="button" className="plc-button pointer-events-auto" style={{ width: 72, height: 24, padding: 0 }} data-tone="danger" title="Delete eller Backspace tar också bort" aria-label={label} onPointerDown={(event) => event.stopPropagation()} onClick={onRemove}>
      <Trash2 aria-hidden="true" />Ta bort
    </button>
  </div>;
}

/**
 * The settings of one selected device (2026-11-09: "dra in knappen sedan klicka på ett litet kugghjul och välja färg och
 * funktion"): a small cog beside Ta bort that opens the device's choices – Färg, Funktion (momentary/latch), Kontakt – right there.
 */
export function FloatingSettings({ x, y, title, options, values, onChange }: { x: number; y: number; title: string; options: readonly OptionDef[]; values: Readonly<Record<string, string>>; onChange: (key: string, value: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const doc = ref.current?.ownerDocument ?? document;
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); } };
    doc.addEventListener("pointerdown", away, true); doc.addEventListener("keydown", key, true);
    return () => { doc.removeEventListener("pointerdown", away, true); doc.removeEventListener("keydown", key, true); };
  }, [open]);
  return <div ref={ref} className="absolute z-20" style={{ left: x, top: y }} data-testid="plc-floating-settings" onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" className="plc-button" style={{ width: 24, height: 24, padding: 0 }} aria-label={`Inställningar för ${title}`} aria-expanded={open} title="Inställningar" onClick={() => setOpen(!open)} data-testid="plc-settings-button">
      <Settings aria-hidden="true" />
    </button>
    {open ? <div role="dialog" aria-label={`Inställningar för ${title}`} className="absolute left-0 top-7 grid w-52 gap-2 rounded-md border bg-card p-2 shadow-lg" data-testid="plc-settings">
      <p className="truncate text-xs font-semibold">{title}</p>
      {options.map((option) => <label key={option.key} className="grid gap-1 text-xs text-muted-foreground">{option.label}
        <select className="form-select h-8 text-sm" value={values[option.key] ?? option.choices[0]!.value} onChange={(event) => onChange(option.key, event.target.value)} data-testid="plc-settings-option" data-option={option.key}>
          {option.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      </label>)}
    </div> : null}
  </div>;
}

/** The small menu at the pointer: Ta bort first, then what else fits the thing. Escape or a click elsewhere closes it. */
export function SurfaceMenu({ x, y, items, onClose, width, height }: { x: number; y: number; items: MenuItem[]; onClose: () => void; width: number; height: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    // The document the menu stands in: a panel may be in a window of its own.
    const doc = ref.current?.ownerDocument ?? document;
    doc.addEventListener("pointerdown", away, true);
    doc.addEventListener("keydown", key, true);
    return () => { doc.removeEventListener("pointerdown", away, true); doc.removeEventListener("keydown", key, true); };
  }, [onClose]);
  // Kept inside the frame: flipped left or up when it would stick out.
  const left = Math.max(4, Math.min(x, width - 180)), top = Math.max(4, Math.min(y, height - 8 - items.length * 34));
  return <div ref={ref} role="menu" aria-label="Åtgärder" className="absolute z-20 min-w-44 rounded-md border bg-card p-1 shadow-lg" style={{ left, top }} data-testid="plc-menu" onPointerDown={(event) => event.stopPropagation()}>
    {items.map((item) => <button key={item.label} type="button" role="menuitem" onClick={() => { item.onPick(); onClose(); }}
      className={cn("flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-sm hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none", item.danger && "text-destructive")} data-testid="plc-menu-item">
      <span className="inline-flex items-center gap-2">{item.danger ? <Trash2 aria-hidden="true" className="size-3.5" /> : null}{item.label}</span>
      {item.hint ? <span className="text-xs text-muted-foreground">{item.hint}</span> : null}
    </button>)}
  </div>;
}

/** What the net under the pointer is: role and potential. */
export function HoverTip({ x, y, text }: { x: number; y: number; text: string }) {
  return <div className="pointer-events-none absolute z-10 rounded border bg-card/95 px-1.5 py-0.5 text-[11px] font-medium shadow-sm" style={{ left: x + 14, top: y + 10 }} role="status" data-testid="plc-wire-tip">{text}</div>;
}
