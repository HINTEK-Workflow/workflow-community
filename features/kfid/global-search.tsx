/* eslint-disable react-hooks/set-state-in-effect -- Synchronize debounced remote search state with the query and dialog. */
"use client";
import { plural } from "@/lib/plural";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, ClipboardCheck, ClipboardList, Clock, Cog, FileText, TriangleAlert, FolderKanban, LoaderCircle, ReceiptText, Repeat, Search, ShieldAlert, UserRound, Users, X, MapPinHouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "./ui";
import { api } from "./api";
import { useLocalWorkspaceSearch } from "@/components/workspace-actions";
import { useInstance } from "@/components/instance-provider";
import { cn } from "@/lib/utils";
import { hasWorkflowPermission, formPermissionArea, type WorkflowPermissionAction, type WorkflowPermissionProfile, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { commandCandidates, type SearchAccess } from "@/lib/search/commands";
import { MODULE_OF_SEARCH_TYPE, moduleInList } from "@/lib/workflow/modules";
import { formCandidate } from "@/lib/search/candidates";
import { parseSearchQuery, searchTooShort, type ParsedSearch } from "@/lib/search/query";
import { highlightRanges, mergeSearchResponses, rankCandidates } from "@/lib/search/score";
import type { SearchHit, SearchResponse, SearchType } from "@/lib/search/types";
import { FIRST_LIST_LIMIT, firstList, firstListCuts } from "@/lib/search/first-list";

/** Opens Sök from anywhere (a button elsewhere in the shell). */
import { OPEN_SEARCH_EVENT } from "@/lib/workflow/shell-events";
import { nativeHiddenHref } from "@/lib/workflow/native-mode";
import { useNativeMode, useNativeReduced } from "@/features/workflow/use-detail-level";
import { RECENT_SEARCH_PREFIX } from "@/features/auth/sign-out";
export { OPEN_SEARCH_EVENT };

export type GlobalSearchUser = {
  id?: string;
  email: string;
  role: string;
  memberRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  workflowPermissions: WorkflowPermissionProfile;
  canBuildForms?: boolean;
  localStorageMode?: boolean;
  /** Företagets moduler (0.39.0): what is on in the company; left out is everything. */
  modules?: readonly string[] | null;
};
type FormCard = { id: string; name: string; description?: string; publisher?: string; area?: string; allowStandalone?: boolean };
type Recent = { queries: string[]; items: Pick<SearchHit, "type" | "id" | "title" | "subtitle" | "href">[] };
const EMPTY: SearchResponse = { groups: [], fuzzy: false };
const RECENT_LIMIT = 8;
const recentKey = (user: GlobalSearchUser) => `${RECENT_SEARCH_PREFIX}${user.id ?? user.email}`;

function readRecent(key: string): Recent {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "null") as Recent | null;
    return { queries: Array.isArray(value?.queries) ? value.queries.slice(0, RECENT_LIMIT) : [], items: Array.isArray(value?.items) ? value.items.slice(0, RECENT_LIMIT) : [] };
  } catch {
    return { queries: [], items: [] };
  }
}
function writeRecent(key: string, recent: Recent) {
  try { window.localStorage.setItem(key, JSON.stringify(recent)); } catch { /* Private window or blocked storage: recents are only a convenience. */ }
}

const ICONS: Record<SearchType, LucideIcon> = { command: ArrowRight, task: ClipboardCheck, report: FileText, project: FolderKanban, quote: FileText, invoice_basis: ReceiptText, customer: Users, place: MapPinHouse, round: Repeat, deviation: TriangleAlert, machine: Cog, form: FileText, person: UserRound };
const iconFor = (hit: Pick<SearchHit, "type" | "href">) => hit.type === "task" ? (hit.href.includes("taskType=WORK_ORDER") ? ClipboardList : hit.href.includes("taskType=RISK_ASSESSMENT") ? ShieldAlert : ClipboardCheck) : ICONS[hit.type];

/** The text with the query's words marked. */
function Highlight({ text, parsed }: { text: string; parsed: ParsedSearch | null }) {
  const ranges = parsed ? highlightRanges(text, parsed) : [];
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], index) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={index} className="rounded-sm bg-primary/15 px-px text-inherit">{text.slice(start, end)}</mark>);
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

const STATE_LABEL: Partial<Record<string, string>> = { done: "Klar", archived: "Arkiverad/pausad" };
// A finished hit in the word its own list uses (2026-10-10): a job is Färdigställd, a project Avslutat, a quote Accepterad.
const DONE_LABEL: Partial<Record<string, string>> = { task: "Färdigställd", project: "Avslutat", quote: "Accepterad", invoice_basis: "Fakturerat" };
// Said once (simulation 0.6.3: "Färdigställd" in the line under the title and again as a badge): no badge when the line has it.
const stateLabel = (hit: { type: string; state?: string; subtitle?: string }) => {
  const label = hit.state === "done" ? DONE_LABEL[hit.type] ?? STATE_LABEL.done : hit.state ? STATE_LABEL[hit.state] : undefined;
  return label && !(hit.subtitle ?? "").split(" · ").includes(label) ? label : undefined;
};

/**
 * Sök (Ctrl K) – 2026-10-05: "en förbättrad sökfunktion … utan AI". One box for projects, tasks of every kind,
 * controls, customers, places with their whole way, rounds, forms, colleagues (admins) and pages. Cloud asks
 * /api/search (inside the person's rights); a Local company searches its open file with the same ranking. Pages and
 * forms are ranked here. A combobox with a listbox: arrows move, Enter opens, Escape closes.
 */
export function GlobalSearch({ localMode = false, user, importAvailable = false }: { localMode?: boolean; user?: GlobalSearchUser | null; importAvailable?: boolean } = {}) {
  const router = useRouter();
  const localSearch = useLocalWorkspaceSearch();
  const { features } = useInstance();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [expand, setExpand] = useState<SearchType | null>(null);
  const [remote, setRemote] = useState<SearchResponse>(EMPTY);
  // Which query and "Visa alla" the records belong to: older records stay on screen while a new search runs, so the
  // list is marked busy until the answer for what is typed now has come (screen readers and tests wait for it).
  const [remoteFor, setRemoteFor] = useState("");
  const searchKey = `${q}|${expand ?? ""}`;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [forms, setForms] = useState<FormCard[] | null>(null);
  const [recent, setRecent] = useState<Recent>({ queries: [], items: [] });
  // A phone starts with the text box alone and a shorter first list (2026-10-09).
  const [phone, setPhone] = useState(false);
  // Level 1 on a phone leaves out the pages that are in display level 2 (2026-10-09); display only. With Visa mer or
  // Visa allt on a phone (A2) they are found again.
  const native = useNativeMode();
  const reduced = useNativeReduced();
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia("(max-width: 639px)");
    const read = () => setPhone(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, [open]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);

  const storageKey = user ? recentKey(user) : null;
  useEffect(() => { if (open && storageKey) setRecent(readRecent(storageKey)); }, [open, storageKey]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // Never on top of another open dialog (e.g. Kontrollera arbetsytefil); F11, 2026-09-29.
        if (!openRef.current && document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
        setOpen((value) => !value);
      }
    };
    const show = () => setOpen(true);
    window.addEventListener("keydown", key);
    window.addEventListener(OPEN_SEARCH_EVENT, show);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener(OPEN_SEARCH_EVENT, show); };
  }, []);

  // Published forms, once per opening: the same list as Ny uppgift, offered to whoever may create from them.
  useEffect(() => {
    if (!open || forms) return;
    let current = true;
    void api<{ forms?: FormCard[] }>("/api/forms").then((data) => { if (current) setForms(data.forms ?? []); }).catch(() => { if (current) setForms([]); });
    return () => { current = false; };
  }, [open, forms]);

  const admin = user?.memberRole === "OWNER" || user?.memberRole === "ADMIN";
  const can = useCallback((subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => Boolean(user && (admin || hasWorkflowPermission(user.workflowPermissions, subject, action))), [user, admin]);
  const access = useMemo<SearchAccess>(() => ({
    admin, superadmin: user?.role === "SUPERADMIN", local: localMode, canBuildForms: Boolean(user?.canBuildForms), can, modules: user?.modules,
    features: { credits: features.credits, billing: features.billing, ai: features.ai, integrations: features.integrations, landingEditor: features.landingEditor, import: importAvailable },
  }), [admin, user, localMode, can, features, importAvailable]);

  const parsed = useMemo(() => (q.trim() ? parseSearchQuery(q) : null), [q]);
  const waiting = !parsed || searchTooShort(parsed);

  // Records: the server in Cloud, the open file in Local.
  useEffect(() => {
    if (!open || waiting) { setRemote(EMPTY); setError(""); setLoading(false); return; }
    if (localMode && !localSearch) { setRemote(EMPTY); setError("Öppna din lokala arbetsyta för att söka."); return; }
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const request = localSearch
        ? Promise.resolve(localSearch(q, { expand }))
        : api<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}${expand ? `&type=${expand}` : ""}`, { signal: abort.signal });
      void request
        .then((found) => { setRemote(found); setRemoteFor(searchKey); setError(""); })
        .catch((reason: Error) => { if (!abort.signal.aborted) { setRemote(EMPTY); setRemoteFor(searchKey); setError(reason.message); } })
        .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, localSearch ? 60 : 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [q, open, waiting, localSearch, localMode, expand, searchKey]);

  // Pages and forms are ranked here with the same rules, so they mix with the records by score.
  const local = useMemo<SearchResponse>(() => {
    if (!parsed || waiting) return EMPTY;
    const formHits = (forms ?? []).filter((form) => form.allowStandalone !== false && can(formPermissionArea(form.area), "create")).map(formCandidate);
    const scoped = expand ? { ...parsed, filters: { ...parsed.filters, types: [expand] } } : parsed;
    return rankCandidates(scoped, [...commandCandidates(access).filter((hit) => !reduced || !nativeHiddenHref(hit.href)), ...formHits], { perGroup: expand ? 30 : phone ? 3 : 5 });
  }, [parsed, waiting, forms, can, access, expand, phone, reduced]);
  const result = useMemo(() => mergeSearchResponses(local, remote), [local, remote]);
  // The server leaves these out by itself; the open file in Local has them too, and there it is display only.
  const inCompany = useCallback((type: SearchType) => !MODULE_OF_SEARCH_TYPE[type] || moduleInList(user?.modules, MODULE_OF_SEARCH_TYPE[type]), [user?.modules]);
  const shownGroups = useMemo(() => result.groups.filter((group) => inCompany(group.type)), [result, inCompany]);
  const allGroups = expand ? shownGroups.filter((group) => group.type === expand) : shownGroups;
  const cut = phone && !expand && !showAll && firstListCuts(allGroups);
  const groups = cut ? firstList(allGroups, FIRST_LIST_LIMIT) : allGroups;
  const hits = useMemo(() => groups.flatMap((group) => group.hits), [groups]);
  const emptyRows = waiting ? [...recent.items] : [];
  const rows: Pick<SearchHit, "type" | "id" | "title" | "subtitle" | "href">[] = waiting ? emptyRows : hits;

  useEffect(() => { setActive(0); setShowAll(false); }, [q, expand, remote]);
  useEffect(() => { if (!open) { setExpand(null); } }, [open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const remember = (hit?: Pick<SearchHit, "type" | "id" | "title" | "subtitle" | "href">) => {
    if (!storageKey) return;
    const query = q.trim();
    const next: Recent = {
      queries: query && !waiting ? [query, ...recent.queries.filter((item) => item !== query)].slice(0, RECENT_LIMIT) : recent.queries,
      items: hit ? [{ type: hit.type, id: hit.id, title: hit.title, subtitle: hit.subtitle, href: hit.href }, ...recent.items.filter((item) => !(item.type === hit.type && item.id === hit.id))].slice(0, RECENT_LIMIT) : recent.items,
    };
    setRecent(next);
    writeRecent(storageKey, next);
  };
  const choose = (hit: Pick<SearchHit, "type" | "id" | "title" | "subtitle" | "href">) => {
    remember(hit);
    setOpen(false);
    // The next opening starts empty, with the recent searches and what was just opened.
    setQ("");
    // A saved report is a file (PDF in the viewer, Excel as a download): it opens beside the app, which stays where it was.
    if (hit.href.startsWith("/api/")) window.open(hit.href, "_blank", "noopener");
    else router.push(hit.href);
  };
  const clearRecent = () => {
    const next = { queries: [], items: [] };
    setRecent(next);
    if (storageKey) writeRecent(storageKey, next);
    inputRef.current?.focus();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!rows.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => (index + 1) % rows.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index - 1 + rows.length) % rows.length); }
    else if (event.key === "Home" && event.ctrlKey) { event.preventDefault(); setActive(0); }
    else if (event.key === "End" && event.ctrlKey) { event.preventDefault(); setActive(rows.length - 1); }
    else if (event.key === "Enter") { event.preventDefault(); const hit = rows[active]; if (hit) choose(hit); }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;
  const status = waiting
    ? (q.trim() ? "Skriv minst två tecken." : "")
    : loading ? "Söker…"
      : error ? error
        : !hits.length ? "Inga träffar. Pröva färre ord, en annan stavning eller ett filter."
          : `${plural(result.groups.reduce((sum, group) => sum + group.count, 0), "träff", "träffar")}${result.fuzzy ? ", även med liknande stavning" : ""}.`;

  const positions = new Map(rows.map((row, position) => [`${row.type}:${row.id}`, position]));
  const option = (hit: Pick<SearchHit, "type" | "id" | "title" | "subtitle" | "href"> & Partial<Pick<SearchHit, "why" | "state" | "fuzzy">>) => {

    const position = positions.get(`${hit.type}:${hit.id}`) ?? 0;
    const Icon = iconFor(hit);
    const selected = position === active;
    return (
      <div key={`${hit.type}:${hit.id}`} id={optionId(position)} role="option" aria-selected={selected} data-index={position} data-testid="search-option"
        onMouseMove={() => { if (!selected) setActive(position); }}
        onClick={() => choose(hit)}
        className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-sm", selected ? "bg-secondary text-primary" : "text-foreground")}>
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-card text-primary"><Icon className="size-4" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium"><Highlight text={hit.title} parsed={parsed} /></span>
          {hit.subtitle || hit.why ? (
            <span className="line-clamp-2 block text-xs leading-5 text-muted-foreground">
              {hit.subtitle ? <Highlight text={hit.subtitle} parsed={parsed} /> : null}
              {hit.why ? <span>{hit.subtitle ? " · " : ""}Träff i {hit.why.toLocaleLowerCase("sv")}</span> : null}
            </span>
          ) : null}
        </span>
        {stateLabel(hit) ? <span className="mt-0.5 shrink-0 rounded-full border px-2 text-xs leading-5 text-muted-foreground">{stateLabel(hit)}</span> : null}
        {hit.fuzzy ? <span className="sr-only">liknande stavning</span> : null}
      </div>
    );
  };

  return (
    <>
      {/* The name is the word the button shows (V3, WCAG 2.5.3): "Sök" is its text, only for screen readers below 1024 px
          where the button is an icon; the shortcut is aria-keyshortcuts, not part of the name. */}
      <Button variant="outline" aria-keyshortcuts="Control+K" onClick={() => setOpen(true)} className="workspace-search-button size-10 px-0 lg:w-auto lg:px-4">
        <Search className="size-4" aria-hidden="true" />
        <span className="sr-only lg:not-sr-only">Sök</span>
        <kbd className="hidden text-xs text-muted-foreground xl:inline" aria-hidden="true">Ctrl K</kbd>
      </Button>
      {/* Level 1 on a phone: Sök is a screen of its own (a view with Stäng, above the tab bar), not a card over the page. */}
      <Modal open={open} onOpenChange={setOpen} title="Sök" size={native ? "view" : "compact"} place={native ? "center" : "top"} className={native ? "global-search" : "global-search top-2 translate-y-0 p-4 max-sm:w-[calc(100%-1rem)] sm:top-[8dvh] sm:p-6"}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={rows.length ? optionId(active) : undefined}
            aria-label="Sök i Workflow"
            aria-describedby={`${listId}-status`}
            placeholder="Sök uppgift, kund, plats…"
            value={q}
            onChange={(event) => { setQ(event.target.value); setExpand(null); }}
            onKeyDown={onKeyDown}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="h-[var(--control-h)] w-full rounded-md border bg-card pl-9 pr-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:h-11"
          />
          {q ? (
            <button type="button" aria-label="Rensa sökningen" onClick={() => { setQ(""); inputRef.current?.focus(); }}
              className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5 text-xs text-muted-foreground max-sm:hidden">
          {parsed?.filterLabels.length ? parsed.filterLabels.map((label) => <span key={label} className="rounded-full border bg-secondary px-2 leading-5 text-primary">{label}</span>)
            : <span>Filter: <code>kund:</code> <code>plats:</code> <code>status:</code> <code>typ:</code> – t.ex. <code>typ:ao status:pågår</code></span>}
        </div>
        <p id={`${listId}-status`} aria-live="polite" className="mt-1 flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground" role={error ? "alert" : undefined}>
          {loading ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}{status}
        </p>
        <div ref={listRef} id={listId} role="listbox" aria-label="Sökträffar" aria-busy={!waiting && !error && (loading || remoteFor !== searchKey)} className={cn("mt-2 max-h-[min(60dvh,32rem)] overflow-y-auto overscroll-contain", !waiting || !phone ? "min-h-48" : "", waiting && phone && !recent.queries.length && !recent.items.length ? "hidden" : "")} data-testid="search-results">
          {waiting ? (
            <>
              {recent.queries.length ? (
                <div className="mb-3" role="presentation">
                  <p className="mb-1 px-2 text-xs font-semibold text-muted-foreground">Senaste sökningar</p>
                  <div className="flex flex-wrap gap-1.5 px-2">
                    {recent.queries.map((query) => <button key={query} type="button" tabIndex={-1} onClick={() => { setQ(query); inputRef.current?.focus(); }} className="flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs hover:bg-secondary hover:text-primary"><Clock className="size-3" aria-hidden="true" />{query}</button>)}
                  </div>
                </div>
              ) : null}
              {recent.items.length ? (
                <div role="group" aria-label="Senast öppnade">
                  <p className="mb-1 px-2 text-xs font-semibold text-muted-foreground" aria-hidden="true">Senast öppnade</p>
                  {recent.items.map((item) => option(item))}
                </div>
              ) : null}
              {recent.queries.length || recent.items.length ? (
                <button type="button" tabIndex={-1} onClick={clearRecent} className="mt-2 px-2 text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline">Rensa senaste</button>
              ) : (
                <p className="px-2 text-sm text-muted-foreground">Sök bland projekt, uppgifter, kunder, platser, rapporter, formulär och sidor.</p>
              )}
            </>
          ) : groups.map((group) => (
            <Fragment key={group.type}>
              <div role="group" aria-labelledby={`${listId}-${group.type}`} className="mb-2">
                <div className="flex min-h-8 items-center justify-between gap-2 px-2">
                  <p id={`${listId}-${group.type}`} className="text-xs font-semibold text-muted-foreground">{group.label} <span className="tabular-nums">({group.count})</span></p>
                  {expand === group.type ? (
                    <button type="button" tabIndex={-1} onClick={() => { setExpand(null); inputRef.current?.focus(); }} className="text-xs text-primary hover:underline">Visa alla typer</button>
                  ) : group.more && group.type !== "command" ? (
                    <button type="button" tabIndex={-1} onClick={() => { setExpand(group.type); inputRef.current?.focus(); }} className="text-xs text-primary hover:underline">Visa alla ({group.count})</button>
                  ) : null}
                </div>
                {group.hits.map((hit) => option(hit))}
              </div>
            </Fragment>
          ))}
        </div>
        {cut ? <button type="button" onClick={() => { setShowAll(true); inputRef.current?.focus(); }} className="mt-2 flex h-11 w-full items-center justify-center rounded-lg border text-sm font-medium text-primary hover:bg-secondary" data-testid="search-show-all">
          Visa alla träffar
        </button> : null}
        {/* Keys only where there is a keyboard (simulation 0.6.3: the tips showed on a tablet's touch screen). */}
        <p className="mt-2 hidden text-xs text-muted-foreground sm:pointer-fine:block" aria-hidden="true">↑ ↓ flyttar · Enter öppnar · Esc stänger</p>
      </Modal>
    </>
  );
}
