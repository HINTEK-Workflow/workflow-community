"use client";

import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// PLC-simulatorn, skrivbordet: the small controls of the chrome, 12 px, square, 1 px borders (docs/ui-system.md, the documented
// variant "PLC-simulatorns skrivbord"). Everything beyond them, like the confirm dialog and the toasts, is the shared kind.

export function ToolButton({ label, pressed, children, className, ...rest }: { label: string; pressed?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn("plc-tool", className)} aria-label={label} title={label} aria-pressed={pressed} {...rest}>{children}</button>;
}

export function ChromeButton({ tone, children, className, ...rest }: { tone?: "danger" | "primary"; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn("plc-button", className)} data-tone={tone} {...rest}>{children}</button>;
}

export function LabeledInput({ label, className, ...rest }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className={cn("plc-field", className)}><span>{label}</span><input className="plc-input w-full" {...rest} /></label>;
}

export function LabeledSelect({ label, options, className, ...rest }: { label: string; options: readonly { value: string; label: string }[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  return <label className={cn("plc-field", className)}><span>{label}</span><select className="plc-select w-full" {...rest}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export function Lamp({ tone, on }: { tone: "run" | "prog" | "fault"; on: boolean }) {
  return <span aria-hidden="true" className="plc-lamp" data-tone={tone} data-on={on} />;
}
