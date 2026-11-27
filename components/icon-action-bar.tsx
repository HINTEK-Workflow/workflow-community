"use client";

import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { disabledReasonProps } from "@/components/ui/disabled-reason";

/**
 * A light icon menu on a compact card (2026-10-24, "Lättare ikonmeny"; first used by Hantera anläggningar on the
 * customer page, made to be used on other pages too): plain Lucide line icons without a filled background, a faint
 * background on hover and when pressed, the theme colour only sparingly (a pressed toggle), the name as a tooltip and as
 * the accessible name, and the same size, spacing and place for every action.
 *
 * - The card has a title and one line under it (what the actions act on – the chosen level), read out when it changes;
 *   the line is one row (cut with an ellipsis and the whole text as its title when the card is narrow).
 * - `groups` are separated by a thin line; `end` is a group with a fixed place at the far right (expand/collapse all).
 * - An action that does not fit right now is inactive with its reason (`disabledReason`: it stays pressable and tells the
 *   reason as a toast, `aria-describedby` points at the card's line) – never removed, so nothing moves when the choice
 *   changes (editor-bar-never-shifts). A label that changes ("Nytt objekt" / "Nytt underobjekt") reserves its longest
 *   form (`labels`). `busy` is the only real `disabled`.
 * - The words show from a container width of 64 rem; narrower the buttons are icons with the word as tooltip and name.
 */
export type IconBarAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Why it cannot be used now; empty when it can. */
  disabledReason?: string | null;
  /** Working: really disabled for the moment. */
  busy?: boolean;
  /** A toggle that is on (aria-pressed). */
  pressed?: boolean;
  tone?: "danger";
  /** Every label the button can have, so it keeps the width of the longest. */
  labels?: readonly string[];
  /** Always only the icon (the word is the tooltip and the name): the end group's small tools. */
  iconOnly?: boolean;
  /** The full accessible name when it says more than the label; it starts with the label (V3). */
  ariaLabel?: string;
  testId?: string;
};

export function IconActionBar({ title, line, icon, label, groups, end, testId, className }: {
  title: string;
  /** The line under the title: what the actions act on now. A node for a skeleton. */
  line: ReactNode;
  /** The card's title icon (the icon standard: a solid square in the page's colour). */
  icon?: ReactNode;
  /** The toolbar's accessible name. */
  label: string;
  groups: IconBarAction[][];
  end?: IconBarAction[];
  testId?: string;
  className?: string;
}) {
  const lineId = useId();
  const button = (action: IconBarAction) => {
    const Icon = action.icon;
    const blocked = disabledReasonProps({ reason: action.disabledReason, describedBy: lineId, title: action.disabledReason || action.label, onClick: () => action.onClick() });
    return <button key={action.key} type="button" className={cn("icon-action", blocked.className)} data-tone={action.tone} data-icon-only={action.iconOnly ? "" : undefined}
      aria-label={action.ariaLabel ?? action.label} aria-pressed={action.pressed} aria-disabled={blocked["aria-disabled"]} aria-describedby={blocked["aria-describedby"]}
      data-disabled-reason={blocked["data-disabled-reason"]} title={blocked.title} disabled={action.busy} onClick={blocked.onClick} data-testid={action.testId}>
      <Icon aria-hidden="true" />
      {action.iconOnly ? null : <span className="icon-action-label" aria-hidden="true">
        {(action.labels?.length ? action.labels : [action.label]).map((text) => <span key={text} data-shown={text === action.label ? "" : undefined}>{text}</span>)}
      </span>}
    </button>;
  };
  return <div className={cn("icon-action-bar-wrap", className)} data-testid={testId}>
    <div className="icon-action-bar">
      <div className="icon-action-bar-head">
        {icon}
        <div className="min-w-0">
          <p className="icon-action-bar-title">{title}</p>
          {/* The line is cut to one row on a narrow card; a text line keeps its whole wording as the tooltip. */}
          <p id={lineId} className="icon-action-bar-line" title={typeof line === "string" ? line : undefined} aria-live="polite" data-testid={testId ? `${testId}-line` : undefined}>{line}</p>
        </div>
      </div>
      <div role="toolbar" aria-label={label} className="icon-action-bar-tools">
        {groups.filter((group) => group.length).map((group, index) => <div key={index} className="icon-action-group">{group.map(button)}</div>)}
        {end?.length ? <div className="icon-action-group" data-end="">{end.map(button)}</div> : null}
      </div>
    </div>
  </div>;
}
