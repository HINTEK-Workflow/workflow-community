"use client";

import Link from "next/link";
import { RowChevron } from "@/components/row-chevron";
import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight, LayoutGrid, Rows3, Search, type LucideIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListToolbar } from "@/components/page-shell";
import { useAddressEntryState } from "@/components/use-address-filter";
import { cn } from "@/lib/utils";
import { deviceClass } from "@/lib/workflow/detail-level";
import { listChipText, listPrefKey, parseListPrefs } from "@/lib/list-filter";
import { allowedFilter } from "@/lib/url-filters";
import { defaultWorkListView, resolveWorkListScope, WORK_LIST_SCOPE_LABEL, WORK_LIST_VIEW_LABEL, WORK_LIST_VIEWS, type WorkListScope, type WorkListView } from "@/lib/workflow/work-list";

/**
 * Den gemensamma toppvisningen (2026-10-31): the filter bar of Uppgifter (features/workflow/work-list.tsx, the model)
 * broken into parts every list uses, in fixed places – row 1 Mina | Alla and the status chips, row 2 the search, extra
 * filters, the sort and Rader | Kort. A part a list has no use for is left out; nothing moves. The phone's level 1 keeps
 * its own pattern (NativeWorkList and the native lists). Pure rules: lib/list-filter.ts.
 */

/** A single-choice segmented control: a radio group with arrow keys and one tab stop, 40 px (44 px on touch). */
export function Segmented<T extends string>({ label, value, options, onChange, testId }: { label: string; value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (value: T) => void; testId?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return <div role="radiogroup" aria-label={label} data-testid={testId} className="touch-segments inline-flex h-[var(--control-h)] shrink-0 items-stretch rounded-md border bg-card p-0.5 max-lg:h-11">
    {options.map((option, index) => {
      const checked = option.value === value;
      return <button key={option.value} ref={(element) => { refs.current[index] = element; }} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1}
        onClick={() => onChange(option.value)} onKeyDown={(event) => move(event, index)}
        className={cn("inline-flex items-center gap-1.5 rounded-[4px] px-2.5 text-[0.8125rem] font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 [&_svg]:size-4",
          checked ? "bg-secondary text-secondary-foreground shadow-xs" : "text-muted-foreground hover:bg-secondary/60 hover:text-primary")}>
        {option.icon}{option.label}
      </button>;
    })}
  </div>;
}

/** Mina | Alla – shown only when the person may choose (more than one scope). */
export function ScopeToggle({ value, scopes, onChange, testId }: { value: WorkListScope; scopes: readonly WorkListScope[]; onChange: (scope: WorkListScope) => void; testId?: string }) {
  if (scopes.length < 2) return null;
  return <Segmented label="Mina eller alla" testId={testId} value={value} onChange={onChange} options={scopes.map((scope) => ({ value: scope, label: WORK_LIST_SCOPE_LABEL[scope] }))} />;
}

/** A chip: its value, its word and its count (null while unknown, or where the list gives none). */
export type ListChip<F extends string> = { value: F; label: string; count: number | null };

/**
 * Status chips that wrap from 640 px and a drop-down on a phone: never a sideways scroll (2026-10-02). Stabil
 * sidladdning (2026-10-23): the count has its place before it is known – an invisible "(0)" in the same tabular digits – so
 * the chips wrap the same way before and after the list is read. `counts={false}`: a list that never counts keeps no place.
 */
export function StatusChips<F extends string>({ label, chips, value, onChange, testId, counts = true }: { label: string; chips: readonly ListChip<F>[]; value: F; onChange: (value: F) => void; testId?: string; counts?: boolean }) {
  return <>
    <div className="hidden min-w-0 flex-1 flex-wrap gap-1 tabular-nums sm:flex" role="group" aria-label={label} data-testid={testId}>
      {chips.map((chip) => <Button key={chip.value} type="button" size="sm" variant={value === chip.value ? "secondary" : "ghost"} aria-pressed={value === chip.value} onClick={() => onChange(chip.value)}>
        {counts ? <span>{chip.label} <span className={chip.count === null ? "invisible" : undefined}>({chip.count ?? 0})</span></span> : chip.label}</Button>)}
    </div>
    <select aria-label={label} className="form-select min-w-0 flex-1 sm:hidden" value={value} onChange={(event) => onChange(event.target.value as F)}>
      {chips.map((chip) => <option key={chip.value} value={chip.value}>{listChipText(chip.label, chip.count)}</option>)}
    </select>
  </>;
}

/** The list's search: the magnifier inside the field, the whole row on a phone and the rest of the row from 640 px. */
export function ListSearch({ label, placeholder, value, onChange, testId }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; testId?: string }) {
  return <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <Input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} className="pl-9" data-testid={testId} /></div>;
}

/** An extra filter: its name (the select's label), the choice "" = all first among the options, and the select's look. */
export type ListExtraFilter = {
  key: string; label: string; value: string; options: readonly { value: string; label: string }[];
  onChange: (value: string) => void; testId?: string; className?: string; id?: string;
};

/** An extra filter as a select beside the search; half the row each on a phone. */
export function ExtraFilterSelect({ filter }: { filter: ListExtraFilter }) {
  return <select id={filter.id} aria-label={filter.label} data-testid={filter.testId} className={cn("form-select min-w-0 max-sm:basis-[calc(50%-0.25rem)] flex-1", filter.className)} value={filter.value} onChange={(event) => filter.onChange(event.target.value)}>
    {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
}

/** Sortera: 12 rem from 640 px, half the row on a phone. */
export function SortSelect<S extends string>({ value, options, onChange, testId }: { value: S; options: readonly { value: S; label: string }[]; onChange: (value: S) => void; testId?: string }) {
  return <select aria-label="Sortera" data-testid={testId} className="form-select min-w-0 max-sm:basis-[calc(50%-0.25rem)] flex-1 sm:w-48 sm:flex-none" value={value} onChange={(event) => onChange(event.target.value as S)}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
}

/** Rader | Kort. */
export function ViewToggle({ value, onChange, testId }: { value: WorkListView; onChange: (view: WorkListView) => void; testId?: string }) {
  return <Segmented label="Visa som" testId={testId} value={value} onChange={onChange} options={WORK_LIST_VIEWS.map((view) => ({ value: view, label: WORK_LIST_VIEW_LABEL[view], icon: view === "rows" ? <Rows3 aria-hidden="true" /> : <LayoutGrid aria-hidden="true" /> }))} />;
}

export type ListFilterBarProps<F extends string, S extends string> = {
  /** The prefix of the parts' test ids: `${testId}-scope`, `${testId}-view`. */
  testId: string;
  scope?: { value: WorkListScope; scopes: readonly WorkListScope[]; onChange: (scope: WorkListScope) => void };
  chips?: { label: string; chips: readonly ListChip<F>[]; value: F; onChange: (value: F) => void; testId?: string; counts?: boolean };
  /** A second group of chips on a row of its own under the first (Platser: Nivå and Driftstatus). */
  moreChips?: { label: string; chips: readonly ListChip<string>[]; value: string; onChange: (value: string) => void; testId?: string; counts?: boolean };
  search?: { label: string; placeholder: string; value: string; onChange: (value: string) => void; testId?: string };
  extras?: readonly ListExtraFilter[];
  sort?: { value: S; options: readonly { value: S; label: string }[]; onChange: (value: S) => void };
  view?: { value: WorkListView; onChange: (view: WorkListView) => void };
  label?: string;
  className?: string;
};

/**
 * The filter bar in its fixed places (docs/ui-system.md, Verktygsraden): row 1 Mina | Alla and the chips; row 2 the search,
 * extra filters, the sort and Rader | Kort. A row without parts is not drawn.
 */
export function ListFilterBar<F extends string, S extends string>(props: ListFilterBarProps<F, S>) {
  const first = (props.scope && props.scope.scopes.length > 1) || props.chips;
  const second = props.search || props.extras?.length || props.sort || props.view;
  return <ListToolbar label={props.label} className={props.className}>
    {first ? <div className="flex min-w-0 flex-wrap items-center gap-2">
      {props.scope ? <ScopeToggle value={props.scope.value} scopes={props.scope.scopes} onChange={props.scope.onChange} testId={`${props.testId}-scope`} /> : null}
      {props.chips ? <StatusChips {...props.chips} /> : null}
    </div> : null}
    {props.moreChips ? <div className="flex min-w-0 flex-wrap items-center gap-2"><StatusChips {...props.moreChips} /></div> : null}
    {second ? <div className="flex min-w-0 flex-wrap items-center gap-2">
      {props.search ? <ListSearch {...props.search} /> : null}
      {props.extras?.map((extra) => <ExtraFilterSelect key={extra.key} filter={extra} />)}
      {props.sort ? <SortSelect value={props.sort.value} options={props.sort.options} onChange={props.sort.onChange} testId={`${props.testId}-sort`} /> : null}
      {props.view ? <ViewToggle value={props.view.value} onChange={props.view.onChange} testId={`${props.testId}-view`} /> : null}
    </div> : null}
  </ListToolbar>;
}

/**
 * View, sort and Mina | Alla of a list, remembered per person and list on this device (as Uppgifter's useWorkListPrefs): a
 * phone may show cards while the computer shows rows; a view never chosen follows the device. Mina | Alla from the address
 * (`&scope=`) holds for the visit only, kept per history entry so Bakåt shows what was chosen. Display only – the server
 * decides what each scope contains.
 */
export function useListPrefs<S extends string>(list: string, personId: string, options: { sorts: readonly S[]; scopes?: readonly WorkListScope[]; scope?: WorkListScope }) {
  const scopes = options.scopes ?? [];
  const read = useCallback(() => {
    try { return parseListPrefs(window.localStorage.getItem(listPrefKey(list, personId)), options.sorts); } catch { return {}; }
  }, [list, personId, options.sorts]);
  const [prefs, setPrefs] = useState(() => {
    if (typeof window === "undefined") return { view: "rows" as WorkListView, sort: options.sorts[0], scope: options.scope };
    const saved = read();
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    return { view: saved.view ?? defaultWorkListView(deviceClass(window.innerWidth, touch, window.innerHeight)), sort: saved.sort ?? options.sorts[0], scope: saved.scope ?? options.scope };
  });
  const [visitScope, setVisitScope] = useAddressEntryState<WorkListScope | "">(`list.${list}.scope`, "scope", (raw) => allowedFilter(raw, scopes), "");
  const scope = scopes.length ? resolveWorkListScope(visitScope || prefs.scope, scopes) : undefined;
  const update = useCallback((change: Partial<{ view: WorkListView; sort: S; scope: WorkListScope }>) => {
    try { window.localStorage.setItem(listPrefKey(list, personId), JSON.stringify({ ...read(), ...change })); } catch { /* storage is optional */ }
    if (change.scope) setVisitScope("");
    setPrefs((current) => ({ ...current, ...change }));
  }, [list, personId, read, setVisitScope]);
  return {
    view: prefs.view, sort: prefs.sort, scope,
    setView: (view: WorkListView) => update({ view }),
    setSort: (sort: S) => update({ sort }),
    setScope: (value: WorkListScope) => update({ scope: value }),
  };
}

/**
 * The one action of a row or card. The title is the item's only link and covers the whole row or card
 * (.stretched-link), so a tap anywhere opens it; this shows what opening does and is read as the link's description.
 */
export function ActionHint({ id, label, wide = false }: { id: string; label: string; wide?: boolean }) {
  return <span id={id} aria-hidden="true" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "pointer-events-none text-primary group-hover:bg-secondary", wide ? "-mx-1 w-[calc(100%+0.5rem)] justify-between" : "max-md:px-1")}>
    <span className={wide ? undefined : "hidden md:inline"}>{label}</span>{wide ? null : <ChevronRight className="size-4 md:hidden" />}
  </span>;
}

/** One fact of a card: an icon, a hidden name for screen readers, and the value on at most two lines. */
export type ListCardFact = { icon: LucideIcon; label: string; value: ReactNode; title?: string };

/**
 * A register's card in Kort (the shape of Uppgifter's WorkCard): the icon square, the title on one line (2026-10-07:
 * card titles never wrap), a line under it, the status and other marks, facts with icons, and at the foot either the action
 * the whole card does (`href` or `onOpen`) or the card's own buttons (`footer`).
 */
export function ListCard({ icon, title, subtitle, badges, facts, footer, href, onOpen, action = "Öppna", linkLabel, data, testId, urgent = false, className }: {
  icon: ReactNode; title: string; subtitle?: ReactNode; badges?: ReactNode; facts?: readonly (ListCardFact | null | false)[]; footer?: ReactNode;
  href?: string; onOpen?: () => void; action?: string;
  /** The link's name when the title alone does not say what it opens; `data`: the card's data attributes, as the list's rows have them. */
  linkLabel?: string; data?: Record<`data-${string}`, string>;
  testId?: string; urgent?: boolean; className?: string;
}) {
  const actionId = useId();
  const opens = Boolean(href || onOpen);
  const heading = href ? <Link href={href} title={title} aria-label={linkLabel} aria-describedby={actionId} className="stretched-link group-hover:text-primary">{title}</Link>
    : onOpen ? <button type="button" title={title} aria-describedby={actionId} onClick={onOpen} className="stretched-link max-w-full truncate text-left group-hover:text-primary">{title}</button>
    : <span title={title}>{title}</span>;
  const shown = (facts ?? []).filter((fact): fact is ListCardFact => Boolean(fact));
  return <article {...data} data-testid={testId} data-urgent={urgent || undefined} className={cn("workflow-card group flex min-w-0 flex-col gap-3 p-4", opens && "tap-card", urgent && "bg-[color-mix(in_srgb,var(--destructive)_6%,transparent)]", className)}>
    <div className="flex min-w-0 items-start gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold" data-card-title="">{heading}</h2>
        {subtitle ? <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {opens ? <RowChevron className="mt-1" /> : null}
    </div>
    {badges ? <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{badges}</div> : null}
    {shown.length ? <dl className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
      {shown.map((fact) => { const Icon = fact.icon; return <div key={fact.label} className="flex min-w-0 items-start gap-1.5"><dt className="sr-only">{fact.label}</dt><Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" /><dd className="line-clamp-2 min-w-0 break-words" title={fact.title}>{fact.value}</dd></div>; })}
    </dl> : null}
    {footer || opens ? <div className="mt-auto space-y-3">
      {footer ? <div className="tap-above">{footer}</div> : null}
      {opens ? <ActionHint id={actionId} label={action} wide /> : null}
    </div> : null}
  </article>;
}

/**
 * The cards of Kort: as many columns as the list's own width holds (a container query, 2026-10-29: card columns follow
 * the container, not the screen) – one on a phone, two from 36 rem, three from 56 rem, four from 80 rem.
 */
export function ListCardGrid({ children, testId, busy }: { children: ReactNode; testId?: string; busy?: boolean }) {
  return <div className="@container">
    <div aria-busy={busy} data-testid={testId} className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4">{children}</div>
  </div>;
}
