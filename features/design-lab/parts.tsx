"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LabView } from "./data";
import s from "./design-lab.module.css";

/**
 * Designlabbets byggstenar (2026-10-16). Every look comes from design-lab.module.css under the page's own wrapper;
 * nothing here changes the app's shared components or CSS. Buttons, fields and tick boxes reuse the app's own
 * Button/Input and get the new look from the wrapper's variables.
 */

export type LabToast = (message: string, action?: { label: string; run: () => void }) => void;
export const LabContext = createContext<{ view: LabView; toast: LabToast }>({ view: 3, toast: () => {} });
export const useLab = () => useContext(LabContext);

/** A button that only shows the look says so instead of pretending to work. */
export function useLookOnly() {
  const { toast } = useLab();
  return (what: string) => () => toast(`${what} – visar bara utseendet i designlabbet.`);
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className={s.eyebrow}>{children}</p>;
}

export function Pill({ tone = "neutral", children, testId }: { tone?: "neutral" | "draft" | "info" | "ok" | "danger"; children: ReactNode; testId?: string }) {
  return <span className={s.pill} data-tone={tone} data-testid={testId}>{children}</span>;
}

export function Notice({ tone = "warn", children, testId }: { tone?: "warn" | "info"; children: ReactNode; testId?: string }) {
  return <div className={s.notice} data-tone={tone} role={tone === "warn" ? "status" : undefined} data-testid={testId}>{children}</div>;
}

/**
 * Innehållskort: white, a 1 px border, 8 px corners, no shadow and no coloured header. The title (15 px, Manrope)
 * with a grey line under it; the description is an explanation and is hidden at display level 1–2, like the app's rule.
 * `collapsible` folds the card (level 2: only the current step's card starts open).
 */
export function LabCard({ title, description, icon: Icon, actions, children, flush = false, collapsible = false, defaultOpen = true, className, testId }: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  /** The content goes edge to edge (a table in the card). */
  flush?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headingId = useId();
  const contentId = useId();
  const shown = !collapsible || open;
  return <section aria-labelledby={headingId} className={cn(s.card, className)} data-testid={testId}>
    <div className={s.cardHead}>
      <div className={s.cardHeading}>
        {Icon ? <Icon aria-hidden="true" className={s.cardIcon} /> : null}
        <div className={s.minw0}>
          <h2 id={headingId} className={s.cardTitle}>{title}</h2>
          {description ? <p className={s.cardDesc}>{description}</p> : null}
        </div>
      </div>
      {actions || collapsible ? <div className={s.cardActions}>
        {shown ? actions : null}
        {collapsible ? <button type="button" className={s.iconButton} aria-expanded={open} aria-controls={contentId} aria-label={`${open ? "Dölj" : "Visa"} ${title}`} onClick={() => setOpen((value) => !value)}>
          <ChevronDown aria-hidden="true" className={cn(s.chevron, !open && s.chevronClosed)} />
        </button> : null}
      </div> : null}
    </div>
    <div id={contentId} hidden={!shown} className={flush ? s.cardFlush : s.cardBody}>{children}</div>
  </section>;
}

/** A label above its field (12 px, grey) – the app's rule "labels above fields". */
export function LabField({ label, children, className, wide = false }: { label: string; children: ReactNode; className?: string; wide?: boolean }) {
  return <label className={cn(s.field, wide && s.fieldWide, className)}>
    <span className={s.fieldLabel}>{label}</span>
    {children}
  </label>;
}

export function LabSelect({ value, onChange, options, label, testId }: { value: string; onChange: (value: string) => void; options: readonly string[]; label?: string; testId?: string }) {
  return <select className={s.select} value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} data-testid={testId}>
    {options.map((option) => <option key={option} value={option}>{option}</option>)}
  </select>;
}

/** A segmented group (radio group): the chosen one filled blue (`strong`) or white with a frame. */
export function Segmented<T extends string>({ value, options, onChange, label, strong = false, testId }: {
  value: T | null;
  options: readonly T[];
  onChange: (value: T) => void;
  label: string;
  strong?: boolean;
  testId?: string;
}) {
  return <div role="radiogroup" aria-label={label} className={s.segmented} data-strong={strong ? "" : undefined} data-testid={testId}>
    {options.map((option) => <button key={option} type="button" role="radio" aria-checked={value === option} className={s.segment} onClick={() => onChange(option)}>{option}</button>)}
  </div>;
}

/** A thin bar (progress, estimated time, a supplier's share). */
export function Bar({ value, label, tone = "primary" }: { value: number; label: string; tone?: "primary" | "muted" }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  return <span className={s.bar} role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} data-tone={tone}>
    <span style={{ width: `${percent}%` }} />
  </span>;
}

// ---------- Display level 1: the phone's app look ----------

/** The top bar of a screen: a framed back button (or Avbryt), the title in the middle and the action as a filled pill. */
export function PhoneTopBar({ title, back, onBack, action, onAction, cancel }: {
  title: string;
  back?: string;
  onBack?: () => void;
  action?: string;
  onAction?: () => void;
  /** Avbryt instead of the back button (a sheet that edits something). */
  cancel?: boolean;
}) {
  return <div className={s.phoneTop} data-testid="lab-phone-top">
    <div>
      {back || cancel ? <button type="button" className={s.phonePill} data-kind={cancel ? "cancel" : "back"} onClick={onBack}>
        <span>{cancel ? null : <ChevronLeft aria-hidden="true" />}<span>{cancel ? "Avbryt" : back}</span></span>
      </button> : null}
    </div>
    <p className={s.phoneTitle}>{title}</p>
    <div>
      {action ? <button type="button" className={s.phonePill} data-kind="save" onClick={onAction}><span>{action}</span></button> : null}
    </div>
  </div>;
}

export function PhoneGroup({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return <div className={s.phoneGroupWrap}>
    {title ? <p className={s.phoneGroupTitle}>{title}</p> : null}
    <div className={s.phoneGroup}>{children}</div>
    {footer ? <p className={s.phoneGroupFoot}>{footer}</p> : null}
  </div>;
}

export function PhoneRow({ icon: Icon, title, subtitle, value, onClick, accent = false, testId }: {
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  accent?: boolean;
  testId?: string;
}) {
  const body = <>
    {Icon ? <span className={s.typeIcon}><Icon aria-hidden="true" /></span> : null}
    <span className={s.phoneRowText}>
      <span className={s.phoneRowTitle}>{title}</span>
      {subtitle ? <span className={s.phoneRowSub}>{subtitle}</span> : null}
    </span>
    {value !== undefined ? <span className={s.phoneRowValue}>{value}</span> : null}
    {onClick ? <ChevronRight aria-hidden="true" className={s.phoneChevron} /> : null}
  </>;
  return onClick
    ? <button type="button" className={s.phoneRow} data-accent={accent ? "" : undefined} onClick={onClick} data-testid={testId}>{body}</button>
    : <div className={s.phoneRow} data-testid={testId}>{body}</div>;
}
