"use client";

import { AreaIcon } from "@/components/area-icon";
import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, CalendarDays, ExternalLink, FileSpreadsheet, FileText, FolderKanban, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEntryState } from "@/components/history-nav";
import { ListCard, ListCardGrid, ListFilterBar, ScopeToggle, useListPrefs } from "@/components/list-filter-bar";
import { useAddressEntryState } from "@/components/use-address-filter";
import { listChipText, listSortOptions } from "@/lib/list-filter";
import { allowedFilter } from "@/lib/url-filters";
import type { WorkListScope } from "@/lib/workflow/work-list";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Empty, Panel, ShowMore } from "@/features/kfid/ui";
import { formatSwedish } from "@/lib/swedish-time";
import { ARCHIVE_FILTER_LABEL, ARCHIVE_FILTERS, ARCHIVE_KIND_LABELS, ARCHIVE_KINDS, ARCHIVE_PERIOD_LABEL, ARCHIVE_PERIODS, ARCHIVE_SORTS, archiveDetail, archiveRetentionText, type ArchiveFilter, type ArchivePeriod } from "@/lib/workflow/report-archive";
import { useLoadEffect } from "@/lib/use-load-effect";
import { PageHeader } from "@/components/page-shell";
import { ListEmpty, ListGroup, ListRow, NativeLargeTitle, NativePage, NativePickerRow, NativeSearch } from "@/components/native";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { RemoveButton } from "@/components/ui/remove-button";
import { DownloadButton } from "@/components/ui/download-button";

type Entry = { id: string; kind: string; title: string; format: "PDF" | "XLSX"; filename: string; size: number; createdAt: string; createdByName: string; mine: boolean; canDelete: boolean; customerName?: string; projectName?: string };
type Page = { items: Entry[]; hasMore: boolean; total: number; retentionMonths: number | null; counts?: Record<ArchiveFilter, number> };
const SCOPES: readonly WorkListScope[] = ["mine", "all"];
const SORT_OPTIONS = listSortOptions(ARCHIVE_SORTS);
const KIND_OPTIONS = [{ value: "", label: "Alla typer" }, ...ARCHIVE_KINDS.map((kind) => ({ value: kind, label: ARCHIVE_KIND_LABELS[kind] }))];
const PERIOD_OPTIONS = ARCHIVE_PERIODS.map((value) => ({ value, label: ARCHIVE_PERIOD_LABEL[value] }));

/**
 * Rapportarkiv (2026-10-07): the PDF and Excel reports a person chose to keep when exporting ("Spara i
 * rapportarkivet"), found and fetched again here. Mina = the ones the person kept, Alla = every one they may read (the
 * server checks the permission for what each report is of). A page at a time with "Visa fler"; kept as long as the
 * company's history. The reports are the files exactly as they were made. The shared toppvisning (2026-10-31): Mina |
 * Alla, the format as chips with counts over every report (not only the page read), the search, Typ and Period (the plan's
 * DO17), the sort and Rader | Kort; each report says its customer and project. The phone keeps its own rows with the format.
 */
export function ReportArchive({ notify, cloud, personId = "" }: { notify: (text: string, error?: boolean) => void; cloud: boolean; personId?: string }) {
  const prefs = useListPrefs("report-archive", personId, { sorts: ARCHIVE_SORTS, scopes: SCOPES, scope: "mine" });
  const scope = prefs.scope ?? "mine";
  const [format, setFormat] = useAddressEntryState<ArchiveFilter>("report-archive.format", "filter", (raw) => allowedFilter(raw, ARCHIVE_FILTERS), "all");
  const [kind, setKind] = useEntryState("report-archive.kind", "");
  const [period, setPeriod] = useEntryState<ArchivePeriod>("report-archive.period", "all");
  const [query, setQuery] = useEntryState("report-archive.q", "");
  const [search, setSearch] = useState(query.trim());
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const request = useRef(0);
  const native = useNativeMode();
  // Level 1: Ta bort is shown on the rows only while Redigera is on, as in the phone's own lists.
  const [removing, setRemoving] = useState(false);

  // The search waits for a pause in the typing.
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);

  const load = useCallback(async (cursor?: string) => {
    const id = ++request.current;
    setBusy(true);
    try {
      const params = new URLSearchParams({ scope, format, sort: prefs.sort, period, ...(kind ? { kind } : {}), ...(search ? { q: search } : {}), ...(cursor ? { cursor } : {}) });
      const next = await api<Page>(`/api/report-archive?${params}`, { cache: "no-store" });
      // A slower, older answer never replaces a newer one.
      if (id !== request.current) return;
      setPage((current) => cursor && current ? { ...next, items: [...current.items, ...next.items] } : next);
      setError("");
    } catch (cause) { if (id === request.current) setError((cause as Error).message); } finally { if (id === request.current) setBusy(false); }
  }, [scope, search, format, kind, period, prefs.sort]);
  useLoadEffect(load, cloud);

  const remove = async (entry: Entry) => {
    if (!(await confirm({ title: "Ta bort rapporten?", message: `”${entry.title}” (${entry.format === "XLSX" ? "Excel" : "PDF"}) tas bort ur Rapportarkivet. Uppgiften och dess innehåll påverkas inte. Det går inte att ångra.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
    try { await api(`/api/report-archive/${encodeURIComponent(entry.id)}`, { method: "DELETE" }); notify("Rapporten är borttagen ur arkivet."); await load(); }
    catch (cause) { notify((cause as Error).message, true); }
  };

  const narrowed = Boolean(search || kind || period !== "all" || format !== "all");
  const actionsOf = (entry: Entry) => <div className="flex flex-wrap gap-2">
      {entry.format === "PDF" ? <Button asChild variant="outline"><a href={`/api/report-archive/${encodeURIComponent(entry.id)}?inline=1`} target="_blank" rel="noopener noreferrer"><ExternalLink />Visa</a></Button> : null}
      <DownloadButton href={`/api/report-archive/${encodeURIComponent(entry.id)}`} download={entry.filename}>Hämta</DownloadButton>
      {entry.canDelete ? <Button type="button" variant="ghost" aria-label={`Ta bort ${entry.title}`} onClick={() => void remove(entry)}><Trash2 />Ta bort</Button> : null}
      </div>;
  const heading = <PageHeader title="Rapportarkiv" description="PDF- och Excel-rapporter som du sparat vid export, så att du kan hämta dem igen." />;
  if (!cloud) return <div className="space-y-6">{heading}<p className="notice" role="status" data-testid="report-archive">Rapportarkivet finns för Cloud. Med lokal lagring sparas rapporten som fil på din dator.</p></div>;

  // Nivå 1 på mobil (2026-10-09): a large title, Mina/Alla, a search field and the reports as rows; a PDF opens in
  // the phone's viewer and an Excel file is fetched with a tap. One page that scrolls, no button rows.
  if (native) return <NativePage testId="report-archive">
    {confirmElement}
    <NativeLargeTitle inBar actions={page?.items.some((entry) => entry.canDelete) ? <Button type="button" variant="ghost" className="px-2 text-base font-normal text-primary" aria-pressed={removing} onClick={() => setRemoving((value) => !value)}>{removing ? "Klar" : "Redigera"}</Button> : null}>Rapportarkiv</NativeLargeTitle>
    <div className="flex justify-center pb-2"><ScopeToggle testId="report-archive-scope" value={scope} scopes={SCOPES} onChange={prefs.setScope} /></div>
    <NativeSearch value={query} onChange={setQuery} label="Sök i rapporterna" placeholder="Sök på rubrik" />
    <ListGroup testId="report-archive-filter">
      <NativePickerRow label="Format" display={listChipText(ARCHIVE_FILTER_LABEL[format], page?.counts?.[format])}>
        <select aria-label="Format" value={format} onChange={(event) => setFormat(event.target.value as ArchiveFilter)}>
          {ARCHIVE_FILTERS.map((value) => <option key={value} value={value}>{listChipText(ARCHIVE_FILTER_LABEL[value], page?.counts?.[value])}</option>)}
        </select>
      </NativePickerRow>
    </ListGroup>
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    <ListGroup testId="report-archive-list" footer={page ? archiveRetentionText(page.retentionMonths) : undefined}>
      {!page ? <ListEmpty>{error ? "Kunde inte hämta rapporterna." : "Hämtar…"}</ListEmpty>
        : !page.items.length ? <ListEmpty>{narrowed ? "Inga rapporter hittades." : "Inga sparade rapporter ännu."}</ListEmpty>
        : page.items.map((entry) => <ListRow key={entry.id} type={entry.format === "XLSX" ? "round" : "control"} icon={entry.format === "XLSX" ? FileSpreadsheet : FileText} title={entry.title} twoLines testId="report-archive-row"
          subtitle={[archiveDetail(entry), entry.customerName, formatSwedish(entry.createdAt, { dateStyle: "medium" }) + (entry.mine ? "" : ` av ${entry.createdByName}`)].filter(Boolean).join(" · ")}
          value={entry.format === "XLSX" ? "Excel" : "PDF"}
          onClick={() => { if (entry.format === "PDF") window.open(`/api/report-archive/${encodeURIComponent(entry.id)}?inline=1`, "_blank", "noopener"); else { const link = document.createElement("a"); link.href = `/api/report-archive/${encodeURIComponent(entry.id)}`; link.download = entry.filename; link.click(); } }}
          accessory={removing && entry.canDelete ? <RemoveButton label={`Ta bort ${entry.title}`} onClick={() => void remove(entry)} /> : undefined} />)}
      {page && page.items.length < page.total ? <ListRow title={<span className="text-primary">{busy ? "Hämtar…" : "Visa fler"}</span>} chevron={false} onClick={() => { if (!busy) void load(page.items.at(-1)?.id); }} /> : null}
    </ListGroup>
  </NativePage>;
  return <div className="space-y-5" data-testid="report-archive">
    {confirmElement}
    {heading}
    <ListFilterBar testId="report-archive" label="Sök och filtrera rapporter"
      scope={{ value: scope, scopes: SCOPES, onChange: prefs.setScope }}
      chips={{ label: "Format", chips: ARCHIVE_FILTERS.map((value) => ({ value, label: ARCHIVE_FILTER_LABEL[value], count: page?.counts?.[value] ?? null })), value: format, onChange: setFormat, testId: "report-archive-format" }}
      search={{ label: "Sök i rapporterna", placeholder: "Sök på rubrik", value: query, onChange: setQuery }}
      extras={[
        { key: "kind", label: "Typ", value: kind, options: KIND_OPTIONS, onChange: setKind, testId: "report-archive-kind", className: "sm:w-40 sm:flex-none" },
        { key: "period", label: "Period", value: period, options: PERIOD_OPTIONS, onChange: (value) => setPeriod(value as ArchivePeriod), testId: "report-archive-period", className: "sm:w-40 sm:flex-none" },
      ]}
      sort={{ value: prefs.sort, options: SORT_OPTIONS, onChange: prefs.setSort }}
      view={{ value: prefs.view, onChange: prefs.setView }} />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    {!page && !error ? <p role="status" className="text-sm text-muted-foreground">Hämtar…</p> : null}
    {page && !page.items.length ? <Panel icon={Archive} title="Sparade rapporter"><Empty title={narrowed ? "Inga rapporter hittades" : scope === "mine" ? "Du har inga sparade rapporter" : "Inga sparade rapporter"} description={narrowed ? "Ändra filter eller sökning." : "Välj Spara i rapportarkivet när du exporterar."} /></Panel> : null}
    {page?.items.length ? <>
      {prefs.view === "cards" ? <ListCardGrid testId="report-archive-list" busy={busy}>{page.items.map((entry) => <ListCard key={entry.id} testId="report-archive-row"
        icon={<AreaIcon area="tools" icon={entry.format === "XLSX" ? FileSpreadsheet : FileText} />} title={entry.title} subtitle={archiveDetail(entry)}
        facts={[
          entry.customerName ? { icon: Users, label: "Kund", value: entry.customerName } : null,
          entry.projectName ? { icon: FolderKanban, label: "Projekt", value: entry.projectName } : null,
          { icon: CalendarDays, label: "Sparad", value: `${formatSwedish(entry.createdAt, { dateStyle: "medium", timeStyle: "short" })}${entry.mine ? "" : ` av ${entry.createdByName}`}` },
        ]}
        footer={actionsOf(entry)} />)}</ListCardGrid>
      : <ul className="divide-y rounded-xl border bg-card shadow-xs" data-testid="report-archive-list" aria-busy={busy}>
        {page.items.map((entry) => {
          const Icon = entry.format === "XLSX" ? FileSpreadsheet : FileText;
          return <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5" data-testid="report-archive-row">
            <AreaIcon area="tools" icon={Icon} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{entry.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{[archiveDetail(entry), entry.customerName, entry.projectName].filter(Boolean).join(" · ")} · sparad {formatSwedish(entry.createdAt, { dateStyle: "medium", timeStyle: "short" })}{entry.mine ? "" : ` av ${entry.createdByName}`}</span>
            </span>
            {actionsOf(entry)}
          </li>;
        })}
      </ul>}
      <ShowMore shown={page.items.length} total={page.total} busy={busy} onMore={() => void load(page.items.at(-1)?.id)} />
    </> : null}
    {page ? <p className="text-xs text-muted-foreground" data-testid="report-archive-retention">{archiveRetentionText(page.retentionMonths)}</p> : null}
  </div>;
}
