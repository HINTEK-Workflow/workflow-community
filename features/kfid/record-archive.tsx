"use client";
import { CustomerCardLink } from "./customer-card";
import { useEffect, useState } from "react";
import { useConfirm } from "./confirm";
import { formatSwedish } from "@/lib/swedish-time";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Search,
  Trash2,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "./api";
import { Panel, Empty, Status } from "./ui";
import type { CustomerItem, ControlItem } from "./types";
import { CustomerAccordionList } from "./customer-accordion-list";
type CustomerWorkCounts = { projects: number | null; workOrders: number | null; riskAssessments: number | null; controls: number | null };
type Item = ControlItem &
  CustomerItem & { number: number; _count?: { controls: number }; work?: CustomerWorkCounts };

/** All of a customer's work in one line (Daniel 2026-09-26); a null count is a module the member may not read. */
export function CustomerWork({ customerId, work }: { customerId: string; work: CustomerWorkCounts }) {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts: React.ReactNode[] = [
    // Every count opens the matching part of the customer card (F15, 2026-09-29).
    work.projects !== null ? <Link className="text-primary" href={`/?view=customers&customerId=${customerId}&tab=projects`}>{plural(work.projects, "projekt", "projekt")}</Link> : null,
    work.workOrders !== null ? <Link className="text-primary" href={`/?view=customers&customerId=${customerId}&tab=tasks&kind=WORK_ORDER`}>{plural(work.workOrders, "arbetsorder", "arbetsorder")}</Link> : null,
    work.riskAssessments !== null ? <Link className="text-primary" href={`/?view=customers&customerId=${customerId}&tab=tasks&kind=RISK_ASSESSMENT`}>{plural(work.riskAssessments, "riskbedömning", "riskbedömningar")}</Link> : null,
    work.controls !== null ? <Link className="text-primary" href={`/?view=controls&customerId=${customerId}`}>{plural(work.controls, "kontroll", "kontroller")}</Link> : null,
  ].filter((part) => part !== null);
  return <span data-testid="customer-work">{parts.map((part, index) => <span key={index}>{index ? " · " : ""}{part}</span>)}</span>;
}
const customerWork = (item: Item): CustomerWorkCounts => item.work ?? { projects: null, workOrders: null, riskAssessments: null, controls: item._count?.controls ?? 0 };
type Result = {
  items: Item[];
  total: number;
  page: number;
  pages: number;
  limit: number;
};
type Filters = {
  q: string;
  from: string;
  to: string;
  status: string;
  trash: string;
  sort: string;
  direction: string;
  page: number;
  limit: number;
  customerId: string;
  creator: "ALL" | "MINE";
  siteId: string;
  departmentId: string;
};
export function RecordArchive({
  kind,
  scope,
  admin,
  customerId,
  onEdit,
  notify,
  refresh,
  reloadToken = 0,
}: {
  kind: "controls" | "customers";
  scope: string;
  admin: boolean;
  customerId?: string;
  onEdit: (c?: CustomerItem) => void;
  notify: (text: string, error?: boolean) => void;
  refresh: () => Promise<void>;
  /** Changes whenever the workspace reloads (e.g. after a new customer was saved), so the list is read again. */
  reloadToken?: number;
}) {
  const [confirmAction, confirmElement] = useConfirm();
  const params = useSearchParams();
  const query = params.get("q");
  const controls = kind === "controls";
  const key = `kfid.records.${scope}.${kind}`;
  const [ready, setReady] = useState(false),
    [data, setData] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [sites, setSites] = useState<{ id: string; name: string; departments: { id: string; name: string }[] }[]>([]);
  const [filter, setFilter] = useState<Filters>({
    q: "",
    from: "",
    to: "",
    status: "ALL",
    trash: "false",
    sort: controls ? "updated" : "name",
    direction: controls ? "desc" : "asc",
    page: 1,
    limit: 25,
    customerId: customerId || "",
    creator: "ALL",
    siteId: "",
    departmentId: "",
  });
  useEffect(() => {
    if (!controls) return;
    void api<{ sites: typeof sites }>("/api/organization-structure")
      .then((result) => setSites(result.sites))
      .catch(() => setSites([]));
  }, [controls]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      setFilter((f) => ({
        ...f,
        ...(saved || {}),
        ...(query !== null ? { q: query, trash: "false" } : {}),
        page: 1,
        customerId: customerId || "",
      }));
    } catch {}
    setReady(true);
  }, [key, customerId, query]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ ...filter, page: 1, customerId: "" }),
      );
    } catch {}
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          kind,
          ...Object.fromEntries(
            Object.entries(filter).map(([k, v]) => [k, String(v)]),
          ),
        });
        const result = await api<Result>(`/api/records?${params}`, {
          signal: abort.signal,
        });
        setData(result);
        setError("");
        setSelected([]);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [ready, key, kind, filter, revision, reloadToken]);
  const update = (change: Partial<Filters>) =>
    setFilter((f) => ({ ...f, ...change, page: 1 }));
  async function bulk(action: string, ids = selected) {
    if (!ids.length) return;
    const noun = controls ? (ids.length === 1 ? "kontroll" : "kontroller") : (ids.length === 1 ? "kund" : "kunder");
    if (
      action !== "restore" &&
      !(await confirmAction(action === "purge"
        ? { title: `Radera ${ids.length} ${noun} permanent?`, message: controls ? "Kontrollerna raderas med bilagor och historik. Det går inte att ångra." : "Kunderna raderas permanent med sina anläggningar. Det går inte att ångra.", confirmLabel: "Radera permanent", tone: "danger" }
        : { title: `Flytta ${ids.length} ${noun} till papperskorgen?`, message: "Du kan återställa från papperskorgen senare.", confirmLabel: "Flytta till papperskorgen", tone: "danger" }))
    )
      return;
    setBusy(true);
    try {
      await api("/api/records", {
        method: "POST",
        body: JSON.stringify({ kind, action, ids }),
      });
      notify(
        action === "restore"
          ? "Valda poster återställda."
          : action === "purge"
            ? "Valda poster raderade."
            : "Valda poster flyttade till papperskorgen.",
      );
      setSelected([]);
      setRevision((v) => v + 1);
      await refresh();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const trash = filter.trash === "true";
  const pager = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        {data
          ? `${data.total} ${controls ? "kontroller" : "kunder"} · Sida ${data.page} av ${data.pages}`
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
  return (
    <div className="space-y-6">
      {confirmElement}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">
            {controls ? "Mina kontroller" : "Kundregister"}
          </h1>
          <p className="page-description mt-2">
            {controls
              ? "Sök i hela kontrollens innehåll, filtrera och hantera arkivet."
              : "Företagets kunder med kontaktuppgifter och kopplat arbete."}
          </p>
        </div>
        {controls ? (
          <Button asChild>
            <Link href="/?view=new">
              <Plus />
              Ny kontroll
            </Link>
          </Button>
        ) : (
          <Button onClick={() => onEdit()}>
            <Plus />
            Ny kund
          </Button>
        )}
      </div>
      <Panel
        title={controls ? "Kontrollarkiv" : "Kunder"}
        actions={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Uppdatera arkiv"
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw />
          </Button>
        }
      >
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                aria-label={controls ? "Sök kontroller" : "Sök kunder"}
                className="h-10 pl-10"
                placeholder={
                  controls
                    ? "Sök projekt, mätvärden, kommentarer, ID…"
                    : "Sök namn, företag, adress eller kontaktuppgifter…"
                }
                value={filter.q}
                onChange={(e) => update({ q: e.target.value })}
              />
            </div>
            {!controls && (
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
          {!controls && (
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
          {controls && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {controls && (
              <>
                <label className="space-y-1 text-xs text-muted-foreground">
                  Från datum
                  <Input
                    type="date"
                    aria-label="Från datum"
                    value={filter.from}
                    onChange={(e) => update({ from: e.target.value })}
                  />
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  Till datum
                  <Input
                    type="date"
                    aria-label="Till datum"
                    value={filter.to}
                    onChange={(e) => update({ to: e.target.value })}
                  />
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  Status
                  <select
                    aria-label="Filtrera status"
                    className="form-select"
                    value={filter.status}
                    onChange={(e) => update({ status: e.target.value })}
                  >
                    <option value="ALL">Alla statusar</option>
                    <option value="DRAFT">Utkast</option>
                    <option value="COMPLETED">Färdigställda</option>
                    <option value="POSTED">Skickade via e-post</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  Skapad av
                  <select
                    aria-label="Filtrera skapare"
                    className="form-select"
                    value={filter.creator}
                    onChange={(e) => update({ creator: e.target.value as Filters["creator"] })}
                  >
                    <option value="ALL">Alla medarbetare</option>
                    <option value="MINE">Mina kontroller</option>
                  </select>
                </label>
                {sites.length > 0 && <label className="space-y-1 text-xs text-muted-foreground">
                  Plats
                  <select aria-label="Filtrera plats" className="form-select" value={filter.siteId} onChange={(event) => update({ siteId: event.target.value, departmentId: "" })}>
                    <option value="">Alla platser</option>
                    {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                  </select>
                </label>}
                {filter.siteId && <label className="space-y-1 text-xs text-muted-foreground">
                  Avdelning
                  <select aria-label="Filtrera avdelning" className="form-select" value={filter.departmentId} onChange={(event) => update({ departmentId: event.target.value })}>
                    <option value="">Alla avdelningar</option>
                    {sites.find((site) => site.id === filter.siteId)?.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                  </select>
                </label>}
              </>
            )}
            <label className="space-y-1 text-xs text-muted-foreground">
              Sortera
              <select
                className="form-select"
                aria-label="Sortera arkiv"
                value={`${filter.sort}:${filter.direction}`}
                onChange={(e) => {
                  const [sort, direction] = e.target.value.split(":");
                  update({ sort, direction });
                }}
              >
                {(controls
                  ? [
                      ["updated", "Senast ändrad"],
                      ["number", "Kontrollnummer"],
                      ["name", "Namn"],
                      ["date", "Datum"],
                      ["performer", "Utförare"],
                    ]
                  : [
                      ["name", "Namn"],
                      ["address", "Adress"],
                      ["email", "E-post"],
                      ["updated", "Senast ändrad"],
                    ]
                ).flatMap(([value, label]) =>
                  ["asc", "desc"].map((dir) => (
                    <option key={`${value}:${dir}`} value={`${value}:${dir}`}>
                      {label} · {dir === "asc" ? "stigande" : "fallande"}
                    </option>
                  )),
                )}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Poster per sida
              <select
                aria-label="Poster per sida"
                className="form-select"
                value={filter.limit}
                onChange={(e) => update({ limit: Number(e.target.value) })}
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>}
          {filter.customerId && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => update({ customerId: "" })}
            >
              <Users />
              Visar vald kunds kontroller · Rensa filter
            </Button>
          )}
          {admin && selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary p-3">
              <span className="text-sm font-medium">
                {selected.length} markerade
              </span>
              {trash ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || loading}
                    onClick={() => void bulk("restore")}
                  >
                    <RotateCcw />
                    Återställ valda
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy || loading}
                    onClick={() => void bulk("purge")}
                  >
                    <Trash2 />
                    Radera valda permanent
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || loading}
                  onClick={() => void bulk("delete")}
                >
                  <Trash2 />
                  Ta bort valda
                </Button>
              )}
            </div>
          )}
          {data && pager}
        </div>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : !data && loading ? (
          <p
            role="status"
            className="py-10 text-center text-sm text-muted-foreground"
          >
            Hämtar poster…
          </p>
        ) : !data?.items.length ? (
          <Empty
            title={loading ? "Hämtar poster…" : "Inga träffar"}
            description="Ändra sökning eller filter, eller skapa en ny post."
          />
        ) : (
          <>
          {controls && <div className="archive-card-list space-y-3 lg:hidden" aria-busy={loading}>
            {data.items.map((item) => (
              <article key={item.id} className="min-w-0 rounded-xl border bg-card p-4">
                <div className="flex min-w-0 items-start gap-3">
                  {admin && (
                    <Checkbox
                      aria-label={`Markera ${controls ? item.title : item.name}`}
                      checked={selected.includes(item.id)}
                      onCheckedChange={(v) =>
                        setSelected((old) =>
                          v === true
                            ? [...old, item.id]
                            : old.filter((id) => id !== item.id),
                        )
                      }
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    {controls ? (
                      <>
                        <Link className="block break-words font-medium hover:text-primary" href={`/?view=new&id=${item.id}`}>
                          {item.title}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">#{item.number} · Version {item.version}</p>
                        {item.createdByName && <p className="mt-1 break-words text-xs text-muted-foreground">Skapad av {item.createdByName} · Ändrad av {item.updatedByName}</p>}
                        {item.siteName && <p className="mt-1 text-xs text-muted-foreground">{item.siteName}{item.departmentName && ` · ${item.departmentName}`}</p>}
                      </>
                    ) : (
                      <>
                        <button className="block max-w-full break-words text-left font-medium hover:text-primary" onClick={() => onEdit(item)}>
                          {item.name}
                        </button>
                        {item.company && <p className="mt-1 break-words text-xs text-muted-foreground">{item.company}</p>}
                      </>
                    )}
                  </div>
                </div>
                <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{controls ? "Utförare" : "Adress"}</dt>
                    <dd className="mt-1 break-words">
                      {controls
                        ? item.performer || "—"
                        : [item.address, item.postalCode, item.city].filter(Boolean).join(", ") || "—"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{controls ? "Datum" : "Kontakt"}</dt>
                    <dd className="mt-1 min-w-0 break-words">
                      {controls ? item.date || "—" : (
                        <>
                          {item.email && <a className="block break-all hover:text-primary" href={`mailto:${item.email}`}>{item.email}</a>}
                          {(item.phone || item.mobile) && <a className="mt-1 block text-muted-foreground" href={`tel:${item.phone || item.mobile}`}>{item.phone || item.mobile}</a>}
                          {!item.email && !item.phone && !item.mobile && "—"}
                        </>
                      )}
                    </dd>
                  </div>
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">{controls ? "Status" : "Arbete"}</dt>
                    <dd className="mt-1">
                      {controls ? (
                        <><Status status={item.status} />{item.postedAt && <span className="ml-2 text-xs text-muted-foreground">Skickad {formatSwedish(item.postedAt, { dateStyle: "short" })}</span>}</>
                      ) : (
                        <CustomerWork customerId={item.id} work={customerWork(item)} />
                      )}
                    </dd>
                  </div>
                </dl>
                <div className={`mt-4 grid grid-cols-1 gap-2 ${trash ? "sm:grid-cols-2" : admin && !controls ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                  {trash ? (
                    admin && <>
                      <Button variant="outline" disabled={busy || loading} onClick={() => void bulk("restore", [item.id])}><RotateCcw />Återställ</Button>
                      <Button variant="destructive" disabled={busy || loading} onClick={() => void bulk("purge", [item.id])}><Trash2 />Radera permanent</Button>
                    </>
                  ) : controls ? (
                    <>
                      <Button asChild variant="outline"><Link aria-label={`Öppna ${item.title}`} href={`/?view=new&id=${item.id}`}><ArrowUpRight />Öppna</Link></Button>
                      {admin && <Button variant="outline" disabled={busy || loading} onClick={() => void bulk("delete", [item.id])}><Trash2 />Ta bort</Button>}
                    </>
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => onEdit(item)}>Redigera</Button><CustomerCardLink customer={item} />
                      <Button asChild variant="outline"><Link aria-label={`Ny uppgift för ${item.name}`} href={`/?view=new_task&customerId=${item.id}`}><Plus />Ny uppgift</Link></Button>
                      {admin && <Button variant="outline" disabled={busy || loading} onClick={() => void bulk("delete", [item.id])}><Trash2 />Ta bort</Button>}
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>}
          {!controls && (
            <CustomerAccordionList
              items={data.items.map((item) => ({
                ...item,
                controlCount: item._count?.controls ?? 0,
              }))}
              leading={admin ? (item) => (
                <Checkbox
                  aria-label={`Markera ${item.name}`}
                  checked={selected.includes(item.id)}
                  onCheckedChange={(value) =>
                    setSelected((current) =>
                      value === true
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                />
              ) : undefined}
              controlLink={(item) => <CustomerWork customerId={item.id} work={customerWork(data.items.find((candidate) => candidate.id === item.id)!)} />}
              actions={(item) => {
                const customer = data.items.find((candidate) => candidate.id === item.id)!;
                return (
                  <div className={`grid grid-cols-1 gap-2 ${trash ? "sm:grid-cols-2" : admin ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                    {trash ? admin && <>
                      <Button variant="outline" disabled={busy || loading} onClick={() => void bulk("restore", [item.id])}><RotateCcw />Återställ</Button>
                      <Button variant="destructive" disabled={busy || loading} onClick={() => void bulk("purge", [item.id])}><Trash2 />Radera permanent</Button>
                    </> : <>
                      <Button variant="outline" onClick={() => onEdit(customer)}>Redigera</Button><CustomerCardLink customer={customer} />
                      <Button asChild variant="outline"><Link aria-label={`Ny uppgift för ${customer.name}`} href={`/?view=new_task&customerId=${item.id}`}><Plus />Ny uppgift</Link></Button>
                      {admin && <Button variant="outline" disabled={busy || loading} onClick={() => void bulk("delete", [item.id])}><Trash2 />Ta bort</Button>}
                    </>}
                  </div>
                );
              }}
            />
          )}
          <div className="table-scroll hidden lg:block" aria-busy={loading}>
            <table className="data-table">
              <thead>
                <tr>
                  {admin && (
                    <th>
                      <Checkbox
                        aria-label="Markera alla på sidan"
                        checked={
                          data.items.length > 0 &&
                          data.items.every((i) => selected.includes(i.id))
                        }
                        onCheckedChange={(v) =>
                          setSelected(
                            v === true ? data.items.map((i) => i.id) : [],
                          )
                        }
                      />
                    </th>
                  )}
                  <th>
                    {controls ? "Kontroll / projekt" : "Kontakt / företag"}
                  </th>
                  <th>{controls ? "Utförare" : "Adress"}</th>
                  <th>{controls ? "Datum" : "E-post / telefon"}</th>
                  <th>{controls ? "Status" : "Arbete"}</th>
                  <th>
                    <span className="sr-only">Åtgärder</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    {admin && (
                      <td>
                        <Checkbox
                          aria-label={`Markera ${controls ? item.title : item.name}`}
                          checked={selected.includes(item.id)}
                          onCheckedChange={(v) =>
                            setSelected((old) =>
                              v === true
                                ? [...old, item.id]
                                : old.filter((id) => id !== item.id),
                            )
                          }
                        />
                      </td>
                    )}
                    <td>
                      {controls ? (
                        <>
                          <Link
                            className="font-medium hover:text-primary"
                            href={`/?view=new&id=${item.id}`}
                          >
                            {item.title}
                          </Link>
                          <p className="mt-1 text-xs text-muted-foreground">
                            #{item.number} · Version {item.version}
                          </p>
                          {item.createdByName && <p className="mt-1 text-xs text-muted-foreground">Skapad av {item.createdByName}<br />Ändrad av {item.updatedByName}</p>}
                          {item.siteName && <p className="mt-1 text-xs text-muted-foreground">{item.siteName}{item.departmentName && ` · ${item.departmentName}`}</p>}
                        </>
                      ) : (
                        <>
                          <button
                            className="text-left font-medium hover:text-primary"
                            onClick={() => onEdit(item)}
                          >
                            {item.name}
                          </button>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.company}
                          </p>
                        </>
                      )}
                    </td>
                    <td>
                      {controls
                        ? item.performer || "—"
                        : [item.address, item.postalCode, item.city]
                            .filter(Boolean)
                            .join(", ") || "—"}
                    </td>
                    <td>
                      {controls ? (
                        item.date || "—"
                      ) : (
                        <>
                          {item.email && (
                            <a
                              className="block hover:text-primary"
                              href={`mailto:${item.email}`}
                            >
                              {item.email}
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
                      {controls ? (
                        <>
                          <Status status={item.status} />
                          {item.postedAt && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Skickad{" "}
                              {formatSwedish(item.postedAt, { dateStyle: "short" })}
                            </p>
                          )}
                        </>
                      ) : (
                        <CustomerWork customerId={item.id} work={customerWork(item)} />
                      )}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {trash ? (
                          admin && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Återställ ${controls ? item.title : item.name}`}
                                disabled={busy || loading}
                                onClick={() => void bulk("restore", [item.id])}
                              >
                                <RotateCcw />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Radera permanent ${controls ? item.title : item.name}`}
                                disabled={busy || loading}
                                onClick={() => void bulk("purge", [item.id])}
                              >
                                <Trash2 className="text-destructive" />
                              </Button>
                            </>
                          )
                        ) : (
                          <>
                            {controls ? (
                              <Button asChild variant="ghost" size="icon">
                                <Link
                                  aria-label={`Öppna ${item.title}`}
                                  href={`/?view=new&id=${item.id}`}
                                >
                                  <ArrowUpRight />
                                </Link>
                              </Button>
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onEdit(item)}
                                >
                                  Redigera
                                </Button>
                                <Button asChild variant="ghost" size="icon">
                                  <Link aria-label={`Kundkort för ${item.name}`} href={`/?view=customers&customerId=${item.id}`}>
                                    <ArrowUpRight />
                                  </Link>
                                </Button>
                                <Button asChild variant="ghost" size="icon">
                                  <Link
                                    aria-label={`Ny uppgift för ${item.name}`}
                                    href={`/?view=new_task&customerId=${item.id}`}
                                  >
                                    <Plus />
                                  </Link>
                                </Button>
                              </>
                            )}
                            {admin && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Ta bort ${controls ? item.title : item.name}`}
                                disabled={busy || loading}
                                onClick={() => void bulk("delete", [item.id])}
                              >
                                <Trash2 />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        <div className="mt-5">{pager}</div>
      </Panel>
    </div>
  );
}
