"use client";
import { plural } from "@/lib/plural";
import { CustomerCardLink } from "./customer-card";
import { PageHeader } from "@/components/page-shell";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useConfirm } from "./confirm";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, Trash2, RotateCcw, ChevronLeft, ChevronRight, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "./api";
import { useWorkspaceData } from "./use-workspace-data";
import { DelayedSkeleton, RowsSkeleton } from "@/components/skeleton";
import { bulkOutcomeMessage, selectedLabel, selectionState, toggleAllOnPage, toggleOne, type BulkAction, type BulkOutcome } from "@/lib/kfid/bulk-selection";
import { Panel, Empty } from "./ui";
import type { CustomerItem } from "./types";
import { CustomerAccordionList } from "./customer-accordion-list";
import { CustomerCreateDialog, CustomerInlineEdit } from "./customer-register-forms";
import { ListEmpty, ListGroup, ListRow, ListSkeleton, NativePage, NativePickerRow, NativeSearch, useNativeTopBar } from "@/components/native";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { RemoveButton } from "@/components/ui/remove-button";
import { CustomerListPage, customerChips } from "./customer-register-layout";
import { useListPrefs } from "@/components/list-filter-bar";
import { useAddressEntryState } from "@/components/use-address-filter";
import { CUSTOMER_FILTER_LABEL, CUSTOMER_FILTERS, CUSTOMER_SORTS, customerSortQuery, type CustomerFilter, type CustomerSort } from "@/lib/kfid/customer-list";
import { customerContact, customerTitle } from "@/lib/kfid/customer-name";
import { listChipText } from "@/lib/list-filter";
import { allowedFilter } from "@/lib/url-filters";
/** From 1280 px the register is a table, below it the accordion list (xl in Tailwind); only the one drawn holds the edit form. */
const WIDE = "(min-width: 1280px)";
const subscribeWide = (listener: () => void) => { const media = window.matchMedia(WIDE); media.addEventListener("change", listener); return () => media.removeEventListener("change", listener); };
export const useWideRegister = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
type CustomerWorkCounts = { projects: number | null; workOrders: number | null; riskAssessments: number | null };
type Item = CustomerItem & { work?: CustomerWorkCounts };

/** All of a customer's work in one line (2026-09-26); a null count is a module the member may not read. */
export function CustomerWork({ customerId, work }: { customerId: string; work: CustomerWorkCounts }) {
  const parts: React.ReactNode[] = [
    // Every count opens the matching part of the customer card (F15, 2026-09-29).
    work.projects !== null ? <Link className="text-primary" href={`/?view=customers&customerId=${customerId}&tab=projects`}>{plural(work.projects, "projekt", "projekt")}</Link> : null,
    work.workOrders !== null ? <Link className="text-primary" href={`/?view=customers&customerId=${customerId}&tab=tasks&kind=WORK_ORDER`}>{plural(work.workOrders, "arbetsorder", "arbetsorder")}</Link> : null,
    work.riskAssessments !== null ? <Link className="text-primary" href={`/?view=customers&customerId=${customerId}&tab=tasks&kind=RISK_ASSESSMENT`}>{plural(work.riskAssessments, "riskbedömning", "riskbedömningar")}</Link> : null,
  ].filter((part) => part !== null);
  return <span data-testid="customer-work">{parts.length ? parts.map((part, index) => <span key={index}>{index ? " · " : ""}{part}</span>) : "—"}</span>;
}
const customerWork = (item: Item): CustomerWorkCounts => item.work ?? { projects: null, workOrders: null, riskAssessments: null };

/**
 * The shared multi-select pieces of every papperskorg (2026-10-19): the bar with the count and the bulk buttons, and
 * the "Markera alla på sidan" row. Touch targets are 44 px on a phone; Esc clears the marks (see onKeyDown at the caller).
 */
export function BulkBar({ count, trash, busy, onRestore, onPurge, onDelete, onClear }: {
  count: number; trash: boolean; busy: boolean;
  onRestore: () => void; onPurge: () => void; onDelete: () => void; onClear: () => void;
}) {
  if (count < 1) return null;
  const tap = "max-sm:min-h-11";
  return <div className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary p-3" role="group" aria-label="Åtgärder för valda" data-testid="bulk-bar">
    <span className="text-sm font-medium" role="status" aria-live="polite">{selectedLabel(count)}</span>
    {trash ? <>
      <Button size="sm" variant="outline" className={tap} disabled={busy} onClick={onRestore}><RotateCcw />Återställ valda</Button>
      <Button size="sm" variant="destructive" className={tap} disabled={busy} onClick={onPurge}><Trash2 />Radera valda permanent</Button>
    </> : <Button size="sm" variant="outline" className={tap} disabled={busy} onClick={onDelete}><Trash2 />Ta bort valda</Button>}
    <Button size="sm" variant="ghost" className={tap} disabled={busy} onClick={onClear}>Avmarkera</Button>
  </div>;
}
/** "Markera alla på sidan" for the phone/accordion list (the wide table has the same box in its header). */
export function SelectAllRow({ selected, pageIds, onChange, className = "xl:hidden" }: {
  selected: readonly string[]; pageIds: readonly string[]; onChange: (next: string[]) => void; className?: string;
}) {
  const state = selectionState(selected, pageIds);
  return <label className={`flex min-h-11 items-center gap-3 px-1 text-sm ${className}`}>
    <Checkbox aria-label="Markera alla på sidan" checked={state === "all" ? true : state === "some" ? "indeterminate" : false}
      onCheckedChange={(value) => onChange(toggleAllOnPage(selected, pageIds, value === true || state === "none"))} />
    Markera alla på sidan
  </label>;
}
export const escapeClears = (clear: () => void) => (event: { key: string }) => { if (event.key === "Escape") clear(); };
/** What to ask before a bulk action; restoring one or many is harmless only for a single post. */
export function bulkConfirm(action: BulkAction, count: number, noun: [string, string], purgeNote: string) {
  const what = count === 1 ? noun[0] : noun[1];
  if (action === "purge") return { title: `Radera ${count} ${what} permanent?`, message: purgeNote, confirmLabel: "Radera permanent", tone: "danger" as const };
  if (action === "restore") return { title: `Återställ ${count} ${what}?`, message: "De hamnar i listan igen.", confirmLabel: "Återställ" , tone: "default" as const };
  return { title: `Flytta ${count} ${what} till papperskorgen?`, message: "Du kan återställa från papperskorgen.", confirmLabel: "Flytta till papperskorgen", tone: "danger" as const };
}
export type { BulkOutcome };
/**
 * A customer row's actions in the register's table (2026-10-08): every action has a visible name, not just an icon,
 * in a fixed two-column grid so the buttons stand in the same place on every row (Kundkort first; Ny uppgift is gone from the
 * register, plan 1Q, 2026-10-11 – the menu has it).
 * The names for screen readers keep the customer's name ("Kundkort för …"). Phones and tablets use the accordion list,
 * which already names every action.
 */
export function CustomerRowActions({ id, name, trash, busy, onEdit, onDelete, onRestore, onPurge }: {
  id: string; name: string; trash: boolean; busy: boolean;
  onEdit?: () => void; onDelete?: () => void; onRestore?: () => void; onPurge?: () => void;
}) {
  const cell = "w-full justify-start";
  if (trash) return <div className="ml-auto grid w-44 gap-1">
    {onRestore ? <Button variant="ghost" size="sm" className={cell} aria-label={`Återställ ${name}`} disabled={busy} onClick={onRestore}><RotateCcw />Återställ</Button> : null}
    {onPurge ? <Button variant="ghost" size="sm" className={`${cell} text-destructive hover:text-destructive`} aria-label={`Radera permanent ${name}`} disabled={busy} onClick={onPurge}><Trash2 />Radera permanent</Button> : null}
  </div>;
  return <div className="ml-auto grid w-56 grid-cols-2 gap-1">
    <Button asChild variant="ghost" size="sm" className={cell}><Link aria-label={`Kundkort för ${name}`} href={`/?view=customers&customerId=${encodeURIComponent(id)}`}>Kundkort</Link></Button>
    {onEdit ? <Button variant="ghost" size="sm" className={cell} aria-label={`Redigera ${name}`} onClick={onEdit}><Pencil />Redigera</Button> : null}
    {onDelete ? <Button variant="ghost" size="sm" className={cell} aria-label={`Ta bort ${name}`} disabled={busy} onClick={onDelete}><Trash2 />Ta bort</Button> : null}
  </div>;
}
type Result = {
  items: Item[];
  counts?: Partial<Record<CustomerFilter, number>>;
  total: number;
  page: number;
  pages: number;
  limit: number;
};
type Filters = {
  q: string;
  trash: string;
  sort: string;
  direction: string;
  page: number;
  limit: number;
};
/** The customer register (the older controls' archive is gone with its editor, 2026-10-06). */
export function RecordArchive({
  scope,
  admin,
  onEdit,
  notify,
  refresh,
  reloadToken = 0,
  canEditCustomers = true,
  personId = "",
}: {
  /** Whose device memory the sort and Rader | Kort are kept in. */
  personId?: string;
  scope: string;
  admin: boolean;
  onEdit: (c?: CustomerItem) => void;
  notify: (text: string, error?: boolean) => void;
  refresh: () => Promise<void>;
  /** Changes whenever the workspace reloads (e.g. after a new customer was saved), so the list is read again. */
  reloadToken?: number;
  /** The customers permission (2026-10-02): without it Ny kund/Redigera are hidden here too. */
  canEditCustomers?: boolean;
  /** Nytt projekt in the card's Projekt section (the server decides again). */
  canCreateProject?: boolean;
}) {
  const [confirmAction, confirmElement] = useConfirm();
  const native = useNativeMode();
  // Level 1: Ta bort is shown on the rows only while Redigera is on.
  const [removing, setRemoving] = useState(false);
  const params = useSearchParams();
  const router = useRouter();
  const wide = useWideRegister();
  const query = params.get("q");
  // Redigera kund folds the form out in the customer's row; Ny kund is a popup on display 3 and a page on display 2 (plan 1Q,
  // 2026-10-11). Level 1 keeps its form screens (onEdit).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // `new=1` in the address (the menu's Ny kund) is taken out first and the form opens then, so the trail does not name it twice
  // (the page the form is on adds its own step).
  const wantsNew = params.get("new") === "1" && !params.get("returnTo");
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!wantsNew || native) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    queueMicrotask(() => setArmed(true));
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [wantsNew, native, router]);
  if (armed && !wantsNew) { setArmed(false); setCreating(true); }
  // Spara leads to the new customer's card – once the page of Ny kund has taken its own history step back, or the two would
  // undo each other (the page closing sets the address back to where it came from).
  const openCardWhenClosed = (id: string) => {
    const started = Date.now();
    const tick = () => {
      if (!new URL(window.location.href).searchParams.has("page") || Date.now() - started > 2000) router.push(`/?view=customers&customerId=${encodeURIComponent(id)}`);
      else window.setTimeout(tick, 30);
    };
    window.setTimeout(tick, 0);
  };
  const edit = (customer?: CustomerItem) => {
    if (native) { onEdit(customer); return; }
    if (customer) setEditingId(customer.id); else setCreating(true);
  };
  const canEdit = canEditCustomers;
  const key = `kfid.records.${scope}.customers`;
  const [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filters>({
    q: "",
    trash: "false",
    sort: "name",
    direction: "asc",
    page: 1,
    limit: 25,
  });
  const trash = filter.trash === "true";
  // The shared toppvisning (2026-10-31): the chip follows the history entry, the sort and Rader | Kort the person and device.
  const prefs = useListPrefs("customers", personId, { sorts: CUSTOMER_SORTS });
  const [type, setType] = useAddressEntryState<CustomerFilter>("customers.type", "filter", (raw) => allowedFilter(raw, CUSTOMER_FILTERS), "all");
  // Kept for the tab only (2026-10-04): a search may hold a customer name, so it does not stay in the
  // browser after the tab closes; the older copy in local storage is removed.
  useEffect(() => {
    try { localStorage.removeItem(key); } catch {}
  }, [key]);
  // The tab's saved filter (and a search from the address) is read when the list opens and when either changes, while
  // rendering (React's "adjust state when a value changes"); the list is shown only on the client, after the workspace
  // has loaded, so the browser storage is there.
  const readFor = JSON.stringify([key, query]);
  const [readFilterFor, setReadFilterFor] = useState<string | null>(null);
  if (readFilterFor !== readFor) {
    setReadFilterFor(readFor);
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      setFilter((f) => ({
        ...f,
        ...(saved || {}),
        ...(query !== null ? { q: query, trash: "false" } : {}),
        page: 1,
      }));
    } catch {}
  }
  const ready = readFilterFor !== null;
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({ ...filter, page: 1 }),
      );
    } catch {}
  }, [ready, key, filter]);
  // Steg 7 (stabil sidladdning): the page of customers through the workspace's memory cache – Bakåt from a customer shows
  // the rows at once and reads them again; a new search or page keeps the old rows (aria-busy) until its answer comes.
  const recordsKey = ready ? `/api/records?${new URLSearchParams({ kind: "customers", ...Object.fromEntries(Object.entries(filter).map(([k, v]) => [k, String(v)])), ...(trash ? {} : { ...customerSortQuery(prefs.sort), type, counts: "1" }) })}` : null;
  const read = useWorkspaceData<Result>(recordsKey, (signal) => api<Result>(recordsKey!, { signal }), { keepPrevious: true, delayMs: 200 });
  const data = read.data ?? null;
  const loading = read.fetching;
  const error = read.error;
  const reload = read.reload;
  // A new page or search starts with nothing marked, as the read used to (React's "adjust state when a value changes").
  const [selectionFor, setSelectionFor] = useState(recordsKey);
  if (selectionFor !== recordsKey) { setSelectionFor(recordsKey); setSelected([]); }
  // The workspace's reload (a customer saved elsewhere) reads the list again.
  const seenToken = useRef(reloadToken);
  useEffect(() => {
    if (seenToken.current === reloadToken) return;
    seenToken.current = reloadToken;
    queueMicrotask(() => void reload());
  }, [reloadToken, reload]);

  // The chosen customer is in the address (its own page since 2026-10-14). Looking at a customer leaves the papperskorg's table.
  const selectedId = params.get("customerId");
  // Level 1 (audit 2026-10-12): removing customers is an edit mode behind Redigera in the top bar, not a row under Ny kund.
  // Redigera/Klar is plain text (2026-10-14): a filled blue button looked like Spara.
  useNativeTopBar(native && admin && !trash && !selectedId ? { title: "Kunder", save: { label: removing ? "Klar" : "Redigera", plain: true, onClick: () => setRemoving((value) => !value) } } : null);
  const [seenSelected, setSeenSelected] = useState(selectedId);
  if (selectedId !== seenSelected) { setSeenSelected(selectedId); if (selectedId && filter.trash === "true") setFilter((f) => ({ ...f, trash: "false", page: 1 })); }
  const update = (change: Partial<Filters>) =>
    setFilter((f) => ({ ...f, ...change, page: 1 }));
  // A new chip or sort starts from the first page again, as a new search does.
  const chooseType = (value: CustomerFilter) => { setType(value); update({}); };
  const chooseSort = (value: CustomerSort) => { prefs.setSort(value); update({}); };
  async function bulk(action: BulkAction, ids = selected) {
    if (!ids.length) return false;
    const noun: [string, string] = ["kund", "kunder"];
    const purgeNote = `${ids.length === 1 ? "Kunden och dess platser raderas" : "Kunderna och deras platser raderas"}. Projekt och uppgifter behåller kundnamnet som text men tappar kopplingen till platsen. Det går inte att ångra.`;
    // One post restores without asking; several, delete and purge always ask first.
    if ((action !== "restore" || ids.length > 1) && !(await confirmAction(bulkConfirm(action, ids.length, noun, purgeNote)))) return false;
    const oneName = ids.length === 1 ? customerTitle(data?.items.find((item) => item.id === ids[0])) || undefined : undefined;
    setBusy(true);
    try {
      const answer = await api<{ count: number; failed?: { id: string; reason: string }[] }>("/api/records", {
        method: "POST",
        body: JSON.stringify({ kind: "customers", action, ids }),
      });
      const outcome: BulkOutcome = { ok: answer.count, failed: answer.failed ?? [] };
      const message = bulkOutcomeMessage(action, outcome, noun);
      notify(oneName && !outcome.failed.length ? `${oneName} ${action === "restore" ? "återställd" : action === "purge" ? "raderad" : "flyttad till papperskorgen"}.` : message.text, message.error);
      // Whatever failed stays marked so it can be tried again; whatever went through is unmarked.
      const failedIds = new Set(outcome.failed.map((failure) => failure.id));
      setSelected((current) => current.filter((id) => failedIds.has(id)));
      void reload();
      await refresh();
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const pageIds = (data?.items ?? []).map((item) => item.id);
  const headState = selectionState(selected, pageIds);
  const pager = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        {data
          ? `${plural(data.total, "kund", "kunder")} · Sida ${data.page} av ${data.pages}`
          : "Hämtar…"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={loading || !data || data.page <= 1}
          onClick={() =>
            setFilter((f) => ({ ...f, page: (data?.page || 1) - 1 }))
          }
        >
          <ChevronLeft />
          Föregående
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={loading || !data || data.page >= data.pages}
          onClick={() =>
            setFilter((f) => ({ ...f, page: (data?.page || 1) + 1 }))
          }
        >
          Nästa
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
  // Nivå 1 på mobil (2026-10-09): the register as rows to the customer card, where Redigera and Ny uppgift are;
  // the papperskorg keeps the ordinary view.
  if (native && !trash) return <NativePage testId="customer-register">
    {confirmElement}
    {/* Ta bort sits behind Redigera, as in the phone's own lists (2026-10-09: no bins on every row). */}
    {/* M4 (2026-10-12): the top bar names the page; Ny kund and Redigera are rows, not buttons beside a second heading. */}
    {canEdit ? <ListGroup testId="native-customer-actions-top">
      <ListRow type="new" icon={Plus} title="Ny kund" onClick={() => edit()} testId="native-customer-new" />
    </ListGroup> : null}
    <NativeSearch value={filter.q} onChange={(q) => update({ q })} label="Sök kunder" />
    <ListGroup testId="native-customer-filter">
      <NativePickerRow label="Filter" display={listChipText(CUSTOMER_FILTER_LABEL[type], data?.counts?.[type])}>
        <select aria-label="Kundtyp" value={type} onChange={(event) => chooseType(event.target.value as CustomerFilter)}>
          {customerChips(data?.counts).map((chip) => <option key={chip.value} value={chip.value}>{listChipText(chip.label, chip.count)}</option>)}
        </select>
      </NativePickerRow>
    </ListGroup>
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    {!data ? <DelayedSkeleton><ListSkeleton rows={7} label="Hämtar kunder…" testId="native-customer-loading" /></DelayedSkeleton>
      : <ListGroup title={`${data.total} ${data.total === 1 ? "kund" : "kunder"}`} testId="native-customer-list">
        {data.items.length ? data.items.map((item) => <ListRow key={item.id} type="customer" title={customerTitle(item)} href={`/?view=customers&customerId=${encodeURIComponent(item.id)}`} testId="native-customer-row"
          subtitle={[customerContact(item), [item.address, item.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || item.email || undefined}
          accessory={admin && removing ? <RemoveButton label={`Ta bort ${customerTitle(item)}`} disabled={busy || loading} onClick={() => void bulk("delete", [item.id])} /> : undefined} />)
          : <ListEmpty>{loading ? "Hämtar…" : "Inga träffar. Ändra sökningen."}</ListEmpty>}
      </ListGroup>}
    {data && data.pages > 1 ? <div className="pt-3">{pager}</div> : null}
    <ListGroup><ListRow type="neutral" icon={Trash2} title="Papperskorg" onClick={() => update({ trash: "true" })} testId="native-customer-trash" /></ListGroup>
  </NativePage>;
  // Display 2 and 3 (2026-10-14): an ordinary list page as Mina projekt; a row opens the customer's own page (the
  // workspace draws CustomerCard for an address with customerId). The papperskorg keeps its table below.
  if (!native && !trash) {
    return <div className="space-y-6">
      {confirmElement}
      <CustomerCreateDialog open={creating} onOpenChange={setCreating} onSaved={(customer) => { void refresh(); openCardWhenClosed(customer.id); }} />
      <CustomerListPage description="Företagets kunder med kontaktuppgifter och kopplat arbete." count={data?.total}
        onTrash={() => update({ trash: "true" })} onNew={canEdit ? () => edit() : undefined}
        items={data?.items.map((item) => ({ id: item.id, name: item.name, company: item.company, customerType: item.customerType, address: item.address, city: item.city, phone: item.phone, mobile: item.mobile, email: item.email, projects: item.work?.projects ?? null })) ?? []}
        query={filter.q} onQuery={(q) => update({ q })} searchLabel="Sök kunder" loading={loading || !data} error={error}
        emptyText={filter.q ? "Ändra sökningen eller skapa en ny kund." : canEdit ? "Skapa den första kunden med Ny kund." : "Det finns inga kunder att visa."}
        filter={{ chips: customerChips(data?.counts), value: type, onChange: chooseType }}
        sort={{ value: prefs.sort, onChange: chooseSort }}
        view={{ value: prefs.view, onChange: prefs.setView }}
        footer={data && data.pages > 1 ? pager : undefined} />
    </div>;
  }
  return (
    <div className="space-y-6">
      {confirmElement}
      <CustomerCreateDialog open={creating} onOpenChange={setCreating}
        onSaved={(customer) => { void refresh(); openCardWhenClosed(customer.id); }} />
      <PageHeader title="Kunder" description="Företagets kunder med kontaktuppgifter och kopplat arbete." actions={canEdit ? <Button onClick={() => edit()} data-testid="customer-new"><Plus />Ny kund</Button> : undefined} />
      <Panel
        title="Kunder"
        actions={
          // A named action, not a lone icon (open finding 2026-10-09: the register's icon actions were unclear).
          <Button
            variant="outline"
            size="sm"
            aria-label="Uppdatera kundlistan"
            title="Hämta kundlistan på nytt"
            disabled={loading}
            onClick={() => void reload()}
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            Uppdatera
          </Button>
        }
      >
        <div className="mb-4 space-y-3" onKeyDown={escapeClears(() => setSelected([]))}>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                aria-label="Sök kunder"
                className="pl-10"
                placeholder="Sök namn, företag, adress eller kontaktuppgifter…"
                value={filter.q}
                onChange={(e) => update({ q: e.target.value })}
              />
            </div>
            {(
              <div className="hidden gap-2 lg:flex">
                <select
                  className="form-select w-52"
                  aria-label="Sortera arkiv"
                  value={`${filter.sort}:${filter.direction}`}
                  onChange={(e) => {
                    const [sort, direction] = e.target.value.split(":");
                    update({ sort, direction });
                  }}
                >
                  {[["name", "Namn"], ["address", "Adress"], ["email", "E-post"], ["updated", "Senast ändrad"]].flatMap(([value, label]) =>
                    ["asc", "desc"].map((dir) => <option key={`${value}:${dir}`} value={`${value}:${dir}`}>{label} · {dir === "asc" ? "stigande" : "fallande"}</option>),
                  )}
                </select>
                <select aria-label="Poster per sida" className="form-select w-36" value={filter.limit} onChange={(e) => update({ limit: Number(e.target.value) })}>
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} per sida</option>)}
                </select>
              </div>
            )}
            <Button
              variant={trash ? "secondary" : "outline"}
              onClick={() => update({ trash: trash ? "false" : "true" })}
            >
              <Trash2 />
              {trash ? "Visa aktiva" : "Papperskorg"}
            </Button>
          </div>
          {(
            <details className="rounded-lg border bg-background p-3 lg:hidden">
              <summary className="cursor-pointer text-sm font-medium">Sortering och visning</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-muted-foreground">
                  Sortera
                  <select
                    className="form-select"
                    aria-label="Sortera kunder mobilt"
                    value={`${filter.sort}:${filter.direction}`}
                    onChange={(e) => {
                      const [sort, direction] = e.target.value.split(":");
                      update({ sort, direction });
                    }}
                  >
                    {[["name", "Namn"], ["address", "Adress"], ["email", "E-post"], ["updated", "Senast ändrad"]].flatMap(([value, label]) =>
                      ["asc", "desc"].map((dir) => <option key={`${value}:${dir}`} value={`${value}:${dir}`}>{label} · {dir === "asc" ? "stigande" : "fallande"}</option>),
                    )}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  Poster per sida
                  <select aria-label="Kunder per sida mobilt" className="form-select" value={filter.limit} onChange={(e) => update({ limit: Number(e.target.value) })}>
                    {[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}
                  </select>
                </label>
              </div>
            </details>
          )}
          {admin && <BulkBar count={selected.length} trash={trash} busy={busy || loading} onRestore={() => void bulk("restore")} onPurge={() => void bulk("purge")} onDelete={() => void bulk("delete")} onClear={() => setSelected([])} />}
          {data && pager}
        </div>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : !data ? (
          // The rows' grey shape while the first page is read (stabil sidladdning steg 6).
          <DelayedSkeleton><RowsSkeleton rows={7} label="Hämtar poster…" /></DelayedSkeleton>
        ) : !data?.items.length ? (
          <Empty
            title={loading ? "Hämtar poster…" : "Inga träffar"}
            description="Ändra sökning eller filter, eller skapa en ny post."
          />
        ) : (
          <div onKeyDown={escapeClears(() => setSelected([]))}>
          {admin && <SelectAllRow selected={selected} pageIds={pageIds} onChange={setSelected} />}
          {(
            <CustomerAccordionList
              items={data.items}
              editor={(item) => editingId === item.id && canEdit && !trash && !wide ? <CustomerInlineEdit customerId={item.id} idPrefix="customer" onClose={() => setEditingId(null)} onSaved={() => { void reload(); void refresh(); }} /> : null}
              leading={admin ? (item) => (
                <Checkbox
                  aria-label={`Markera ${item.name}`}
                  checked={selected.includes(item.id)}
                  onCheckedChange={(value) => setSelected((current) => toggleOne(current, item.id, value === true))}
                />
              ) : undefined}
              work={(item) => <CustomerWork customerId={item.id} work={customerWork(data.items.find((candidate) => candidate.id === item.id)!)} />}
              actions={(item) => {
                const customer = data.items.find((candidate) => candidate.id === item.id)!;
                return (
                  <div className={`grid grid-cols-1 gap-2 ${trash ? "sm:grid-cols-2" : admin ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                    {trash ? admin && <>
                      <Button variant="outline" disabled={busy || loading} onClick={() => void bulk("restore", [item.id])}><RotateCcw />Återställ</Button>
                      <Button variant="destructive" disabled={busy || loading} onClick={() => void bulk("purge", [item.id])}><Trash2 />Radera permanent</Button>
                    </> : <>
                      {canEdit && <Button variant="outline" aria-label={`Redigera ${customer.name}`} onClick={() => edit(customer)}><Pencil />Redigera</Button>}<CustomerCardLink customer={customer} />
                      {admin && <Button variant="outline" disabled={busy || loading} onClick={() => void bulk("delete", [item.id])}><Trash2 />Ta bort</Button>}
                    </>}
                  </div>
                );
              }}
            />
          )}
          {/* From 1280 px the table fits beside the menu: Adress has its own column from 1440 px and stands under the name
              before that; a long e-mail address wraps instead of widening the table (QA 2026-10-10). */}
          <div className="table-scroll hidden xl:block" aria-busy={loading}>
            <table className="data-table">
              {/* Fixed columns (steg 10): the actions' buttons and the tick box keep their width, the rest share the room. */}
              <colgroup>
                {admin ? <col className="w-12" /> : null}
                <col />
                <col className="hidden min-[1440px]:table-column" />
                <col className="w-64" />
                <col />
                <col className={trash ? "w-52" : "w-64"} />
              </colgroup>
              <thead>
                <tr>
                  {admin && (
                    <th>
                      <Checkbox
                        aria-label="Markera alla på sidan"
                        checked={headState === "all" ? true : headState === "some" ? "indeterminate" : false}
                        onCheckedChange={(v) => setSelected((old) => toggleAllOnPage(old, pageIds, v === true || headState === "none"))}
                      />
                    </th>
                  )}
                  <th>Kontakt / företag</th>
                  <th className="hidden min-[1440px]:table-cell">Adress</th>
                  <th>E-post / telefon</th>
                  <th>Arbete</th>
                  <th>
                    <span className="sr-only">Åtgärder</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <Fragment key={item.id}>
                  <tr>
                    {admin && (
                      <td>
                        <Checkbox
                          aria-label={`Markera ${item.name}`}
                          checked={selected.includes(item.id)}
                          onCheckedChange={(v) => setSelected((old) => toggleOne(old, item.id, v === true))}
                        />
                      </td>
                    )}
                    <td>
                      {(
                        <>
                          {canEdit ? <button
                            className="text-left font-medium hover:text-primary"
                            onClick={() => edit(item)}
                          >
                            {item.name}
                          </button> : <span className="text-left font-medium">{item.name}</span>}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.company}
                          </p>
                          {[item.address, item.postalCode, item.city].some(Boolean) ? <p className="mt-1 text-xs text-muted-foreground min-[1440px]:hidden">
                            {[item.address, item.postalCode, item.city].filter(Boolean).join(", ")}
                          </p> : null}
                        </>
                      )}
                    </td>
                    <td className="hidden min-[1440px]:table-cell">
                      {[item.address, item.postalCode, item.city]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                    <td className="max-w-64 break-words">
                      {(
                        <>
                          {item.email && (
                            <a
                              className="block hover:text-primary"
                              href={`mailto:${item.email}`}
                            >
                              {/* A long address may wrap before @, never in the middle of a word. */}
                              {item.email.includes("@") ? <>{item.email.slice(0, item.email.indexOf("@"))}<wbr />{item.email.slice(item.email.indexOf("@"))}</> : item.email}
                            </a>
                          )}
                          {(item.phone || item.mobile) && (
                            <a
                              className="mt-1 block text-xs text-muted-foreground"
                              href={`tel:${item.phone || item.mobile}`}
                            >
                              {item.phone || item.mobile}
                            </a>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <CustomerWork customerId={item.id} work={customerWork(item)} />
                    </td>
                    <td>
                      <CustomerRowActions id={item.id} name={item.name} trash={trash} busy={busy || loading}
                        onEdit={!trash && canEdit ? () => edit(item) : undefined}
                        onDelete={!trash && admin ? () => void bulk("delete", [item.id]) : undefined}
                        onRestore={trash && admin ? () => void bulk("restore", [item.id]) : undefined}
                        onPurge={trash && admin ? () => void bulk("purge", [item.id]) : undefined} />
                    </td>
                  </tr>
                  {editingId === item.id && canEdit && !trash && wide ? <tr data-testid="customer-edit-row">
                    <td colSpan={admin ? 6 : 5} className="bg-muted/20">
                      <CustomerInlineEdit customerId={item.id} idPrefix="customer" onClose={() => setEditingId(null)} onSaved={() => { void reload(); void refresh(); }} />
                    </td>
                  </tr> : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        )}
        <div className="mt-5">{pager}</div>
      </Panel>
    </div>
  );
}
