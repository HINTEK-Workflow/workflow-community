"use client";

import { useRef, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type InPageTab<K extends string> = { key: K; label: string; icon: LucideIcon };

/**
 * One look for every tab row (page tops, 2026-11-02; Planering's row is the reference): the row under the heading with its line
 * and the pills. `SectionTabs` (with addresses), `InPageTabs` (without) and Översikt's tabs all draw it from here.
 */
export const TAB_ROW_CLASS = "mb-6 w-full border-b pb-4";
export const TAB_PILLS_CLASS = "-my-1 min-w-0 flex-nowrap gap-1.5 overflow-x-auto px-px py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
export const tabPillClass = (here: boolean) => cn("touch-target flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
  here ? "shrink-0 border-primary/30 bg-secondary font-medium text-secondary-foreground ring-1 ring-primary/15" : "min-w-0 shrink border-border text-muted-foreground hover:border-primary/40 hover:text-foreground");
export const tabIconClass = (here: boolean) => cn("size-4 shrink-0", here && "text-primary");

/**
 * Flikar inne på en sida, utan adress (2026-11-02): a select on a phone, a row of pills from 640 px, arrow keys between the
 * pills. Moved here from Egenkontroll with the same look. `SectionTabs` is built on `?view=` and router links, so a page
 * without the shell uses this. `idBase` ties the tabs to a `role="tabpanel"` with the id `<idBase>-panel`.
 */
export function InPageTabs<K extends string>({ label, tabs, current, onSelect, idBase, testId }: { label: string; tabs: readonly InPageTab<K>[]; current: K; onSelect: (tab: K) => void; idBase?: string; testId?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + tabs.length) % tabs.length;
    onSelect(tabs[next].key);
    refs.current[next]?.focus();
  };
  return <div className={TAB_ROW_CLASS} data-testid={testId}>
    <label className="block sm:hidden">
      <span className="sr-only">{label}</span>
      <select className="form-select" aria-label={label} value={current} onChange={(event) => onSelect(event.target.value as K)}>
        {tabs.map((tab) => <option key={tab.key} value={tab.key}>{tab.label}</option>)}
      </select>
    </label>
    <div role="tablist" aria-label={label} className={cn("hidden sm:flex", TAB_PILLS_CLASS)}>
      {tabs.map((tab, index) => <button key={tab.key} ref={(element) => { refs.current[index] = element; }} type="button" role="tab" id={idBase ? `${idBase}-tab-${tab.key}` : undefined} aria-controls={idBase ? `${idBase}-panel` : undefined} aria-selected={tab.key === current} tabIndex={tab.key === current ? 0 : -1} onClick={() => onSelect(tab.key)} onKeyDown={(event) => move(event, index)}
        className={tabPillClass(tab.key === current)}>
        <tab.icon className={tabIconClass(tab.key === current)} aria-hidden="true" /><span className="min-w-0 truncate">{tab.label}</span>
      </button>)}
    </div>
  </div>;
}
