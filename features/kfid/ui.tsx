"use client";
import { useId, useState } from "react";
import { Dialog } from "radix-ui";
import { X, Inbox, ChevronDown, Minimize2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useFlowHint } from "@/features/workflow/flow-hint-store";
export function Panel({
  title,
  description,
  children,
  actions,
  className,
  collapsible = false,
  defaultCollapsed = false,
  leadingActions,
  persistentContent,
  headerClassName,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  leadingActions?: React.ReactNode;
  persistentContent?: React.ReactNode;
  headerClassName?: string;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // The progress line's current step, when it is done in this panel (2026-10-01).
  const flowHint = useFlowHint(title);
  const contentId = useId();
  const headingId = useId();
  return (
    // The panel where the current step is done carries the step's marker (2026-10-01: "jag fattade inte att
    // dessa hörde ihop"): the same ring as the current dot on the progress line, and the step's number and name.
    <section aria-labelledby={headingId} className={cn("rounded-xl border bg-card shadow-xs", flowHint && "border-primary/45 ring-4 ring-primary/10", className)} data-flow-current={flowHint ? "" : undefined}>
      {/* Light blue header row against a white content area is the shared panel look (2026-09-25). */}
      <div className={cn("panel-header flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b px-5 py-4", collapsed && !persistentContent && "rounded-b-xl border-b-0", headerClassName)}>
        <div className="panel-heading flex min-w-0 items-center gap-3">
          {leadingActions}
          <div>
            <h2 id={headingId} className="section-title">{title}</h2>
            {description && (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        {flowHint ? <div className="panel-flow-hint flex min-w-0 flex-1 basis-72 items-start justify-end gap-2.5 text-right max-sm:justify-start max-sm:text-left" data-testid="flow-current" role="status">
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-primary">Nu: steg {flowHint.number} av {flowHint.total} · {flowHint.step}</span>
            <span className="block text-xs leading-5 text-muted-foreground">{flowHint.hint}</span>
          </span>
          {/* The same marker as the current dot on the line. */}
          <span aria-hidden="true" className="mt-1 block size-[11px] shrink-0 rounded-full border-2 border-primary bg-card ring-4 ring-primary/20 max-sm:order-first" />
        </div> : null}
        <div className="panel-actions flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          {collapsible && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${collapsed ? "Visa" : "Dölj"} ${title}`}
              className={leadingActions ? "measurement-collapse" : undefined}
              aria-expanded={!collapsed}
              aria-controls={contentId}
              onClick={() => setCollapsed((v) => !v)}
            >
              {leadingActions ? (
                collapsed ? (
                  <Maximize2 />
                ) : (
                  <Minimize2 />
                )
              ) : (
                <ChevronDown className={collapsed ? "-rotate-90" : ""} />
              )}
            </Button>
          )}
        </div>
      </div>
      {persistentContent && (
        <div className="panel-persistent-content p-5">{persistentContent}</div>
      )}
      <div
        id={contentId}
        hidden={collapsed}
        className={cn("panel-content p-5", persistentContent && "border-t")}
      >
        {children}
      </div>
    </section>
  );
}
export function Field({
  label,
  value,
  onChange,
  type = "text",
  id,
  required = false,
  disabled = false,
  options,
  optionLabels,
  suggestions,
  className,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  id: string;
  required?: boolean;
  disabled?: boolean;
  options?: string[];
  optionLabels?: Record<string, string>;
  suggestions?: string[];
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <Label htmlFor={id} className="field-label text-xs font-medium">
        {label}
      </Label>
      {options ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="form-select"
        >
          {!options.includes(String(value)) && (
            <option value={String(value)}>
              {optionLabels?.[String(value)] || value || "Välj…"}
            </option>
          )}
          {options.map((v) => (
            <option key={v} value={v}>
              {optionLabels?.[v] || v}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          type={type}
          step={type === "number" ? "any" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          className="h-10 bg-card px-3"
          list={suggestions?.length ? `${id}-suggestions` : undefined}
        />
      )}
      {suggestions?.length ? (
        <datalist id={`${id}-suggestions`}>
          {suggestions.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-xs" />
        <Dialog.Content className={cn("workspace-modal fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 shadow-xl", className)}>
          <Dialog.Title className="section-title pr-8">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <Dialog.Close asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Stäng"
              className="absolute right-3 top-3"
            >
              <X />
            </Button>
          </Dialog.Close>
          <div className="mt-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <span className="rounded-xl bg-secondary p-3 text-primary">
        <Inbox className="size-6" />
      </span>
      <h3 className="section-title">{title}</h3>
      <p className="page-description max-w-md">{description}</p>
      {children}
    </div>
  );
}
/** Shared footer for paged history and log lists: "Visar X av N" with a button that loads the next page. */
export function ShowMore({ shown, total, busy = false, onMore }: { shown: number; total: number; busy?: boolean; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
      <span>Visar {shown} av {total}</span>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onMore}>
        {busy ? "Hämtar…" : "Visa fler"}
      </Button>
    </div>
  );
}
export function Status({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
        indicatorBadge(status === "COMPLETED" ? "success" : "warning"),
      )}
    >
      {status === "COMPLETED" ? "Färdigställd" : "Utkast"}
    </span>
  );
}
