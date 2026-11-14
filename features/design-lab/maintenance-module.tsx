"use client";

import { useState } from "react";
import {
  Activity, Bell, Boxes, CalendarDays, CheckCircle2, ChevronsDownUp, ChevronsUpDown, ClipboardList, Cog, Factory, Gauge, Hammer, HardHat, ImageIcon, ListChecks, ListTree, Menu, PackageMinus, Pencil, Play, Plus, Repeat, Rows3, Trash2, Wallet, Wrench, type LucideIcon,
} from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { IconActionBar } from "@/components/icon-action-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { DialogActions, Field, Modal, Panel, PanelAreaProvider } from "@/features/kfid/ui";
import { PhotoPicker } from "@/features/self-inspection/deviation-photos";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { placeIcon, placeParentIds, PlaceTreeView, type PlaceTreeLevel } from "@/features/workflow/place-tree";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import {
  addDays, addInterval, ARTICLES, FORMS, INITIAL_PARTS, isoWeek, LOCATIONS, MACHINES, PEOPLE, planAhead, ROUNDS, shortDate, TODAY, TREES,
  type Article, type CalendarUnit, type IntervalKind, type JobOccurrence, type MachineItem, type Part, type PartImage, type RecurringJob, type Status,
} from "./maintenance-data";
import { OperatorAdmin } from "./operator-admin";
import { useProposalLevel } from "./proposal-level";
import { ListGroup, ListRow, NativeActions, NativePickerRow, NativeSegmented } from "@/components/native/list";
import { NativeBar } from "@/components/native/top-bar";

/**
 * Förslag: Underhållsmodulen (2026-10-30). A mock only – example data in this component's state, invented names.
 * Three views: Maskiner (the machine tree in the customer card's look and the chosen part with its tabs),
 * Underhållsplanering (the coming weeks – the same occurrences as Planering) and Operatör (a fault report, phone first).
 * Recurring work gets one work order per occurrence, made in advance as Vilande; rounds keep one work order per period.
 */

const VIEWS = ["Maskiner", "Underhållsplanering", "Operatör"] as const;
type View = (typeof VIEWS)[number];
const VIEW_ICON: Record<View, LucideIcon> = { Maskiner: Cog, Underhållsplanering: CalendarDays, Operatör: HardHat };
const TABS = ["Översikt", "Bilder", "Händelser", "Återkommande arbeten", "Reservdelar", "Kostnad"] as const;
type Tab = (typeof TABS)[number];
const statusTone = (status: Status): IndicatorTone => status === "Ur drift" ? "danger" : status === "Service snart" ? "warning" : "success";
const OCCURRENCE_TONE: Record<JobOccurrence["status"] | "Försenad", IndicatorTone> = { Klar: "success", Aktiv: "info", Vilande: "neutral", Försenad: "danger" };
const occurrenceStatus = (item: JobOccurrence): JobOccurrence["status"] | "Försenad" => item.status === "Aktiv" && item.date < TODAY ? "Försenad" : item.status;
const kr = (value: number) => `${value.toLocaleString("sv-SE")} kr`;
const hm = (minutes: number) => `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
const total = (article: Article) => Object.values(article.stock).reduce((sum, value) => sum + value, 0);
const machineIcon = (item: MachineItem, level: PlaceTreeLevel): LucideIcon => level === "address" ? Factory : item.objectType === "Linje" ? Rows3 : placeIcon(item, level);
const lookOnly = (what: string) => () => announce(`${what} – visar bara utseendet i förslaget.`);
const chip = (on: boolean) => cn("touch-target h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-sm", on ? "border-primary/30 bg-secondary font-medium" : "text-muted-foreground hover:text-foreground");
const UNIT_WORDS: Record<CalendarUnit, [string, string]> = { dag: ["dag", "dagar"], vecka: ["vecka", "veckor"], månad: ["månad", "månader"], år: ["år", "år"] };
const ruleText = (job: Pick<RecurringJob, "kind" | "every" | "unit" | "hours">) => {
  const calendar = job.every === 1 ? `varje ${UNIT_WORDS[job.unit][0]}` : `var ${job.every}:e ${UNIT_WORDS[job.unit][0]}`;
  const hours = `var ${job.hours}:e drifttimme`;
  return job.kind === "Kalender" ? calendar : job.kind === "Drifttimmar" ? hours : `${calendar} eller ${hours} – det som kommer först`;
};

export function MaintenanceModule() {
  const [view, setView] = useState<View>("Maskiner");
  const [parts, setParts] = useState(INITIAL_PARTS);
  const [articles, setArticles] = useState(ARTICLES);
  const [partId, setPartId] = useState("pump");
  const [tab, setTab] = useState<Tab>("Översikt");
  const [nextOrder, setNextOrder] = useState(1062);
  const [nextPurchase, setNextPurchase] = useState(2041);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(placeParentIds(MACHINES)));
  const [bigImage, setBigImage] = useState<PartImage | null>(null);
  const [newJob, setNewJob] = useState<RecurringJob | null>(null);
  const [screen, setScreen] = useState<"tree" | "part">("tree");
  const level = useProposalLevel();
  const part = parts.find((item) => item.id === partId) ?? parts[0];
  const patch = (next: Partial<Part>) => setParts((list) => list.map((item) => item.id === part.id ? { ...item, ...next } : item));
  const dueAt = part.lastService + part.interval;
  const main = part.images.find((image) => image.id === part.mainImage) ?? null;
  const parents = placeParentIds(MACHINES);
  const toggle = (id: string) => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const addRunHours = () => {
    const runHours = part.runHours + 100;
    if (runHours >= dueAt) {
      patch({ runHours, lastService: dueAt, status: "I drift", events: [{ at: "nu", text: `Serviceintervall nått (${dueAt.toLocaleString("sv-SE")} h) – den vilande arbetsordern blev aktiv`, alarm: false }, ...part.events] });
      announce("Serviceintervall nått – den vilande arbetsordern är nu aktiv");
    } else patch({ runHours, status: runHours + 100 >= dueAt ? "Service snart" : part.status });
  };
  const alarm = () => {
    const order = `AO-${nextOrder}`;
    setNextOrder((value) => value + 1);
    patch({ status: "Ur drift", events: [{ at: "nu", text: "Larm: tryckfall – underhållspost skapad", alarm: true, order }, ...part.events] });
    announce(`Larm – arbetsorder ${order} med en underhållspost skapades (märkt Automatisk)`);
  };
  const order = (article: Article) => {
    announce(`Inköp IK-${nextPurchase} skapades med ${article.name}`);
    setNextPurchase((value) => value + 1);
    setArticles((list) => list.map((item) => item.id === article.id ? { ...item, stock: { ...item.stock, "Förråd A": item.stock["Förråd A"] + item.min * 2 } } : item));
  };
  // Decided 2026-10-30: a spare part is drawn from the store as soon as it is put on the work order.
  const takeOut = (article: Article) => {
    const from = LOCATIONS.find((location) => article.stock[location] > 0);
    if (!from) { announce(`${article.name} är slut i förrådet. Beställ först.`, true); return; }
    setArticles((list) => list.map((item) => item.id === article.id ? { ...item, stock: { ...item.stock, [from]: item.stock[from] - 1 } } : item));
    announce(`1 ${article.unit} ${article.name} lades på AO-1081 och drogs från ${from}`);
  };
  const addImages = (files: File[]) => {
    const added = files.map((file, index) => ({ id: `f-${Date.now()}-${index}`, url: URL.createObjectURL(file), name: file.name }));
    patch({ images: [...part.images, ...added], mainImage: part.mainImage ?? added[0]?.id ?? null });
    announce(added.length === 1 ? "Bilden lades till" : `${added.length} bilder lades till`);
  };
  const removeImage = (id: string) => {
    const images = part.images.filter((image) => image.id !== id);
    patch({ images, mainImage: part.mainImage === id ? images[0]?.id ?? null : part.mainImage });
    setBigImage(null);
  };
  const saveJob = () => {
    if (!newJob) return;
    if (!newJob.name.trim()) { announce("Skriv vad som ska göras.", true); return; }
    const first = newJob.kind === "Drifttimmar" ? addDays(TODAY, 21) : addInterval(TODAY, newJob.every, newJob.unit);
    const occurrences = planAhead(first, newJob.kind === "Drifttimmar" ? 5 : newJob.every, newJob.kind === "Drifttimmar" ? "vecka" : newJob.unit, 12, newJob.kind === "Drifttimmar");
    patch({ jobs: [...part.jobs, { ...newJob, occurrences }] });
    setNewJob(null);
    announce(`12 vilande arbetsordrar skapades, ${occurrences[0].order}–${occurrences[11].order}`);
  };
  // Done later than planned: the occurrence is done on the day it was done, the next ones are counted from it.
  const doneLate = (job: RecurringJob, days: number) => {
    const index = job.occurrences.findIndex((item) => item.status === "Aktiv");
    if (index < 0) return;
    const doneOn = addDays(job.occurrences[index].date, days);
    let date = doneOn;
    const occurrences = job.occurrences.map((item, at) => {
      if (at < index) return item;
      if (at === index) return { ...item, date: doneOn, status: "Klar" as const };
      date = addInterval(date, job.every, job.kind === "Drifttimmar" ? "vecka" : job.unit);
      return { ...item, date, status: at === index + 1 && date <= addDays(TODAY, 7) ? "Aktiv" as const : "Vilande" as const };
    });
    patch({ jobs: part.jobs.map((item) => item.id === job.id ? { ...item, occurrences } : item) });
    const moved = occurrences.length - index - 1;
    announce(`${job.name} gjord ${shortDate(doneOn)} – ${moved} vilande arbetsordrar flyttades ${days} ${days === 1 ? "dag" : "dagar"}`);
  };

  const selectedNode = MACHINES.find((item) => item.part === part.id)?.id ?? null;
  const machineLine = (item: MachineItem, depth: number) => depth === 0 ? (item.owner === "Eget" ? "Eget" : `Kund: ${item.owner}`)
    : [item.objectType, item.part ? parts.find((row) => row.id === item.part)?.status : ""].filter(Boolean).join(" · ");
  const bar = <IconActionBar title="Hantera maskiner" label="Hantera maskiner" icon={<AreaIcon area="tools" icon={ListTree} tone="solid" />} line={`Vald: ${part.path} › ${part.name}`} testId="mm-actions-bar"
    groups={[
      [{ key: "new-root", label: "Nytt träd", icon: Factory, onClick: lookOnly("Nytt träd (eget eller kundens)") }, { key: "new-part", label: "Ny del", icon: Plus, onClick: lookOnly("Ny del") }],
      [{ key: "edit", label: "Redigera", icon: Pencil, onClick: lookOnly("Redigera") }, { key: "signal", label: "Koppla signal", icon: Activity, onClick: lookOnly("Koppla signal") }, { key: "delete", label: "Ta bort", icon: Trash2, tone: "danger", onClick: lookOnly("Ta bort") }],
    ]}
    end={[
      { key: "open-all", label: "Fäll ut alla", icon: ChevronsUpDown, iconOnly: true, disabledReason: parents.every((id) => open.has(id)) ? "Allt i trädet är redan utfällt." : null, onClick: () => setOpen(new Set(parents)) },
      { key: "fold-all", label: "Fäll ihop alla", icon: ChevronsDownUp, iconOnly: true, disabledReason: parents.some((id) => open.has(id)) ? null : "Allt i trädet är redan hopfällt.", onClick: () => setOpen(new Set()) },
    ]} />;

  const downtime = part.costs.reduce((sum, row) => sum + row.downtime, 0);
  const roundsWithPart = ROUNDS.filter((round) => round.stops.some((stop) => stop.endsWith(part.name)));
  const tabContent = tab === "Översikt" ? <div className="space-y-4">
    <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Drifttimmar</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{part.runHours.toLocaleString("sv-SE")} h</dd></div>
      <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Nästa service</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{dueAt.toLocaleString("sv-SE")} h</dd><dd className="text-xs text-muted-foreground">Om {(dueAt - part.runHours).toLocaleString("sv-SE")} h</dd></div>
      <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Stillestånd i år</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{hm(downtime)}</dd><dd className="text-xs text-muted-foreground">Från underhållsposterna</dd></div>
      <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Signaler</dt><dd className="mt-1 text-sm">{part.signals.length ? part.signals.join(", ") : "Ingen kopplad"}</dd></div>
    </dl>
    <p className="text-xs text-muted-foreground">Drifttimmarna räknas från maskinkopplingen. Signalerna kopplas till delar i det här trädet.</p>
    <Button type="button" variant="outline" onClick={addRunHours} data-testid="mm-run-hours"><Gauge />+100 drifttimmar (exempel)</Button>
  </div>
  : tab === "Bilder" ? <div className="space-y-4" data-testid="mm-images">
    {part.images.length ? <ul className="flex flex-wrap gap-3">{part.images.map((image) => <li key={image.id} className="relative">
      <button type="button" className="block" onClick={() => setBigImage(image)} aria-label={`Visa ${image.name}`} data-testid="mm-image-thumb">
        {/* eslint-disable-next-line @next/next/no-img-element -- an example drawing or a picture chosen on this device */}
        <img src={image.url} alt={image.name} className="size-20 rounded-md border object-cover" />
      </button>
      {image.id === part.mainImage ? <Badge variant="outline" className={cn(indicatorBadge("info"), "absolute bottom-1 left-1 px-1 py-0 text-[10px]")}>Huvudbild</Badge> : null}
      <RemoveButton label={`Ta bort ${image.name}`} className="absolute -right-2 -top-2 bg-background" onClick={() => removeImage(image.id)} />
    </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga bilder än.</p>}
    <PhotoPicker files={[]} onChange={addImages} label="Lägg till" />
    <p className="text-xs text-muted-foreground">Bilderna följer med på en arbetsorder från delen. Klicka på en bild för att se den större.</p>
  </div>
  : tab === "Händelser" ? <div className="space-y-3">
    <Button type="button" variant="outline" onClick={alarm} data-testid="mm-alarm"><Bell />Simulera larm</Button>
    {part.events.length ? <ul className="-mx-4 divide-y border-y text-sm">{part.events.map((event, index) => <li key={`${event.at}-${index}`} className="flex items-start gap-2 px-5 py-2">
      {event.alarm ? <Bell className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden="true" /> : <Play className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />}
      <span className="min-w-0 flex-1">{event.text}{event.order ? <> → <strong>{event.order}</strong></> : null}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{event.at}</span>
    </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga händelser.</p>}
    <p className="text-xs text-muted-foreground">Ett larm blir en märkt arbetsorder med en underhållspost på delen.</p>
  </div>
  : tab === "Återkommande arbeten" ? <div className="space-y-4" data-testid="mm-jobs">
    <Button type="button" variant="outline" onClick={() => setNewJob({ id: `j-${Date.now()}`, name: "", kind: "Kalender", every: 3, unit: "månad", hours: 500, who: PEOPLE[0], estimate: "1 h", spares: [], form: FORMS[0], occurrences: [] })} data-testid="mm-job-new"><Plus />Nytt återkommande arbete</Button>
    <p className="text-xs text-muted-foreground">En arbetsorder per tillfälle, skapad i förväg som vilande. Den blir aktiv när dagen kommer. Görs det senare flyttas tillfället, och nästa räknas från när det gjordes.</p>
    {part.jobs.map((job) => {
      const coming = job.occurrences.filter((item) => item.status !== "Klar");
      const lastDone = [...job.occurrences].reverse().find((item) => item.status === "Klar");
      const shown = [...(lastDone ? [lastDone] : []), ...coming.slice(0, 3)];
      const rest = coming.slice(3);
      const active = job.occurrences.find((item) => item.status === "Aktiv");
      return <section key={job.id} className="rounded-lg border" data-testid="mm-job" aria-label={job.name}>
        <div className="flex flex-wrap items-start justify-between gap-2 border-b px-3 py-2">
          <div className="min-w-0"><p className="font-semibold">{job.name}</p>
            <p className="text-xs text-muted-foreground">{ruleText(job)} · {job.who} · {job.estimate} · Formulär: {job.form}{job.spares.length ? ` · Reservdelar: ${job.spares.map((spare) => `${spare.qty} × ${articles.find((item) => item.id === spare.article)?.name ?? ""}`).join(", ")}` : ""}</p></div>
          <Button type="button" size="sm" variant="outline" disabledReason={active ? null : "Inget aktivt tillfälle just nu."} onClick={() => doneLate(job, 1)} data-testid="mm-done-late"><CheckCircle2 />Gjord 1 dag sent (exempel)</Button>
        </div>
        <ul className="divide-y text-sm">{shown.map((item) => {
          const status = occurrenceStatus(item);
          return <li key={item.order} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5" data-testid="mm-occurrence-row">
            <span className="w-28 shrink-0 tabular-nums">{item.approx ? "≈ " : ""}{shortDate(item.date)}</span>
            <Badge variant="outline" className={indicatorBadge(OCCURRENCE_TONE[status])}>{status}</Badge>
            <span className="ml-auto text-xs font-semibold text-primary">{item.order}</span>
          </li>;
        })}</ul>
        {rest.length ? <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">+ {rest.length} vilande till {shortDate(rest[rest.length - 1].date)}</p> : null}
      </section>;
    })}
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">Ronder där delen ingår</p>
      {roundsWithPart.length ? <ul className="space-y-1 text-sm">{roundsWithPart.map((round) => <li key={round.name}><Repeat className="mr-1.5 inline size-3.5 text-muted-foreground" aria-hidden="true" /><strong>{round.name}</strong> · {round.rule} · {round.stops.length} stopp · {round.order} (en arbetsorder för perioden)</li>)}</ul>
        : <p className="text-sm text-muted-foreground">Ingen rond.</p>}
    </div>
    <p className="notice flex items-start gap-2 text-xs" data-testid="mm-same-rounds"><Repeat className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Samma rondfunktion som Driftronder: formulär, schema, påminnelser, tillfällen, protokoll, avvikelser och säkerhetsavstämning – med maskindelar i stället för platser.</span></p>
  </div>
  : tab === "Reservdelar" ? <div className="space-y-3">
    <ul className="-mx-4 divide-y border-y text-sm" data-testid="mm-spares">{part.articles.map((id) => {
      const article = articles.find((item) => item.id === id)!;
      const low = total(article) < article.min;
      return <li key={id} className="grid gap-2 px-5 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <span className="min-w-0"><span className="font-semibold">{article.name}</span><span className="block text-xs text-muted-foreground">{article.artNo} · {LOCATIONS.map((location) => `${location}: ${article.stock[location]}`).join(" · ")}</span></span>
        <span className="flex flex-wrap items-center gap-2"><span className="tabular-nums">{total(article)} {article.unit}</span>
          {low ? <Badge variant="outline" className={indicatorBadge("warning")}>Lågt</Badge> : null}
          <Button type="button" size="sm" variant="outline" onClick={() => takeOut(article)} data-testid="mm-take-out"><PackageMinus />Lägg på AO</Button>
          {low ? <Button type="button" size="sm" onClick={() => order(article)}><Boxes />Beställ</Button> : null}</span>
      </li>;
    })}</ul>
    <p className="text-xs text-muted-foreground">Artiklar från artikelregistret. Förrådet är gemensamt, med saldo per förrådsplats. En reservdel dras från förrådet direkt när den läggs på arbetsordern. Beställ gör ett vanligt inköp.</p>
  </div>
  : <div className="space-y-3">
    {part.costs.length ? <ul className="-mx-4 divide-y border-y text-sm" data-testid="mm-costs">
      {part.costs.map((row) => <li key={row.order} className="grid gap-1 px-5 py-2 sm:grid-cols-[6rem_minmax(0,1fr)_7rem] sm:items-center">
        <strong>{row.order}</strong>
        <span className="min-w-0 text-xs text-muted-foreground"><span className="block font-medium text-foreground">{row.item}</span>Tid {row.hours} h ({kr(row.time)}) · Material {kr(row.material)} · Inköp {kr(row.purchases)}{row.downtime ? ` · Stillestånd ${hm(row.downtime)}` : ""}</span>
        <span className="text-right tabular-nums">{kr(row.time + row.material + row.purchases)}</span>
      </li>)}
      <li className="flex flex-wrap justify-between gap-2 px-5 py-2 font-semibold"><span>Summa · stillestånd {hm(downtime)}</span><span className="tabular-nums">{kr(part.costs.reduce((sum, row) => sum + row.time + row.material + row.purchases, 0))}</span></li>
    </ul> : <p className="text-sm text-muted-foreground">Inga kostnader än.</p>}
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wallet className="size-3.5" aria-hidden="true" />Räknas från delens underhållsposter och arbetsordrar – inget nytt att fylla i.</p>
  </div>;

  const mainImageBox = <div className="h-40 overflow-hidden rounded-lg border bg-muted/40 sm:h-52" data-testid="mm-main-image">
    {main ? <button type="button" className="block size-full" onClick={() => setBigImage(main)} aria-label={`Visa ${main.name}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- an example drawing or a picture chosen on this device */}
      <img src={main.url} alt={main.name} className="size-full object-cover" />
    </button> : <button type="button" className="flex size-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground" onClick={() => setTab("Bilder")}>
      <ImageIcon className="size-6" aria-hidden="true" />Ingen bild – lägg till under Bilder</button>}
  </div>;

  return <PanelAreaProvider area="tools"><div className="space-y-6" data-testid="mm-module">
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 [&>*]:min-w-0" data-detail-min="2">
      <Panel icon={Menu} title="Ny menypunkt: Underhåll">
        <ul className="flex flex-wrap gap-1.5 text-sm" aria-label="Menyn (exempel)">
          {["Arbetsordrar", "Uppgifter", "Driftronder", "Underhåll", "Inköp", "Planering"].map((item) => <li key={item}
            className={cn("rounded-full border px-3 py-1", item === "Underhåll" ? "border-primary/30 bg-secondary font-semibold" : "text-muted-foreground")}>{item}{item === "Underhåll" ? " (ny)" : ""}</li>)}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">Maskiner, bilder, återkommande arbeten, ronder, förråd, kostnad och felanmälan. För industri och anläggningar.</p>
      </Panel>
      <Panel icon={Wrench} area="work-order" title="AO-1055 · Veckounderhåll Linje 2">
        <p className="mb-2 text-sm text-muted-foreground">Arbetsordern håller ronder, underhållsposter och vanliga uppgifter.</p>
        <ul className="-mx-4 divide-y border-y text-sm" data-testid="mm-order-example">
          <li className="flex items-center gap-2 px-5 py-2"><Repeat className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">Veckorond Linje 2 · 3 stopp</span><span className="shrink-0 text-xs text-muted-foreground">Rond</span></li>
          <li className="flex items-center gap-2 px-5 py-2"><Hammer className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">Underhåll · Hydraulpump</span><span className="shrink-0 text-xs text-muted-foreground">Underhållspost</span></li>
          <li className="flex items-center gap-2 px-5 py-2"><ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">Kontrollera nödstopp varje vecka</span><span className="shrink-0 text-xs text-muted-foreground">Uppgift</span></li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Återkommande arbeten får en egen arbetsorder per tillfälle, t.ex. AO-1092 Byt filter · Hydraulpump (vilande).</p>
      </Panel>
    </div>

    {/* The module's three views, in one fixed place: chips on levels 2–3, the phone's segmented control on level 1. */}
    {level === 1 ? <div data-testid="mm-views"><NativeSegmented label="Underhåll" value={view} onChange={(next) => { setView(next); setScreen("tree"); }} testId="mm-views-segmented"
      options={[["Maskiner", "Maskiner"], ["Underhållsplanering", "Planering"], ["Operatör", "Operatör"]]} /></div>
    : <div className="flex flex-wrap gap-1.5 border-b pb-3" role="group" aria-label="Underhåll" data-testid="mm-views">
      {VIEWS.map((item) => { const Icon = VIEW_ICON[item]; return <button key={item} type="button" aria-current={view === item ? "page" : undefined} onClick={() => setView(item)} className={chip(view === item)} data-testid={`mm-view-${item}`}>
        <Icon className="mr-1.5 inline size-4" aria-hidden="true" />{item}
      </button>; })}
    </div>}

    {view !== "Maskiner" ? (view === "Underhållsplanering" ? <MaintenancePlanning parts={parts} /> : <OperatorAdmin />)
    : level === 1 ? (screen === "tree" ? <div className="space-y-1" data-testid="mm-explorer">
      <ListGroup title="Maskinträd" footer="Eget träd – inte kundens platsträd.">
        <nav aria-label="Maskiner och delar" className="p-2" data-testid="mm-tree">
          <PlaceTreeView places={MACHINES} open={open} onToggle={toggle} selected={selectedNode} icon={machineIcon} line={machineLine} label="Maskiner och delar" testId="mm-place-tree"
            onOpen={(item) => { if (item.part) { setPartId(item.part); setScreen("part"); } else toggle(item.id); }} />
        </nav>
      </ListGroup>
      <NativeActions>
        <Button type="button" variant="ghost" onClick={lookOnly("Ny del")}><Plus />Ny del</Button>
        <Button type="button" variant="ghost" onClick={lookOnly("Koppla signal")}><Activity />Koppla signal</Button>
      </NativeActions>
    </div> : <div className="space-y-2" data-testid="mm-part-screen">
      <NativeBar testId="mm-part-top" leftKind="back" left={{ label: "Maskinträd", onClick: () => setScreen("tree"), ariaLabel: "Tillbaka till Maskinträd" }}
        heading={<div className="native-top-bar-title" role="heading" aria-level={2}>{part.name}</div>} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
        <Badge variant="outline" className={indicatorBadge(statusTone(part.status))}>{part.status}</Badge><span>{part.path}</span>
      </div>
      {mainImageBox}
      <ListGroup>
        <NativePickerRow label="Visa" display={tab} testId="mm-tab-picker">
          <select aria-label="Delens flik" value={tab} onChange={(event) => setTab(event.target.value as Tab)}>{TABS.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        </NativePickerRow>
      </ListGroup>
      <div className="native-group min-h-80 p-4" data-testid="mm-part-content">{tabContent}</div>
    </div>)
    : <div className="place-explorer-wrap" data-testid="mm-explorer"><div className="place-explorer">
      <div className="place-explorer-bar">{bar}</div>
      <div className="place-explorer-tree">
        <Panel icon={ListTree} title="Maskinträd" description="Eget träd – inte kundens platsträd" className="place-tree-panel">
          <nav aria-label="Maskiner och delar" data-testid="mm-tree">
            <PlaceTreeView places={MACHINES} open={open} onToggle={toggle} selected={selectedNode} icon={machineIcon} line={machineLine} label="Maskiner och delar" testId="mm-place-tree"
              onOpen={(item) => { if (item.part) setPartId(item.part); else toggle(item.id); }} />
          </nav>
        </Panel>
      </div>
      <div className="place-pane">
        {/* The part: its main image as the miniature in the header and at the top, then the tabs in a fixed place. */}
        <Panel icon={Cog} title={part.name} leadingIcon={main
          // eslint-disable-next-line @next/next/no-img-element -- an example drawing or a picture chosen on this device
          ? <img src={main.url} alt="" className="size-8 shrink-0 rounded-md border object-cover" data-testid="mm-part-thumb" /> : undefined}>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="outline" className={indicatorBadge(statusTone(part.status))}>{part.status}</Badge><span>{part.path}</span>
          </div>
          <div className="mb-4">{mainImageBox}</div>
          <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label="Delens flikar">
            {TABS.map((item) => <button key={item} type="button" aria-current={tab === item ? "true" : undefined} onClick={() => setTab(item)} className={chip(tab === item)} data-testid={`mm-tab-${item}`}>{item}</button>)}
          </div>
          <div className="min-h-80" data-testid="mm-part-content">{tabContent}</div>
        </Panel>
      </div>
    </div></div>}

    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 [&>*]:min-w-0" data-detail-min="2">
      <Panel icon={ListChecks} title="Finns redan / byggs nytt">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div><p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Finns redan</p>
            <ul className="mt-1 space-y-0.5">{["Rondfunktionen (Driftronder)", "Formulärmallar", "Underhållsfälten (i dag på arbetsordern)", "Maskinkoppling: intag, regler, larm → arbetsorder", "Jour, notiser med kvittens och eskalering", "Bilder på arbetsorder och avvikelser", "Artiklar och Inköp", "Arbetsordrar", "Planering (Tidplan, Kalender)"].map((text) => <li key={text}>{text}</li>)}</ul></div>
          <div><p className="text-xs font-semibold text-primary">Byggs nytt</p>
            <ul className="mt-1 space-y-0.5">{["Maskinträd (eget eller kundens)", "Underhållspost per maskindel", "Bilder på delar", "Återkommande arbeten på kalender eller drifttimmar", "Vilande arbetsordrar i förväg och omplanering", "Ronder med maskindelar som stopp", "Underhållsplanering (vy över samma tillfällen)", "Operatörens felanmälan och rollen Operatör", "Förrådsplatser, saldo och uttag", "Kostnad och stillestånd per maskin", "Signaler kopplade till trädet"].map((text) => <li key={text}>{text}</li>)}</ul></div>
        </div>
      </Panel>
      <Panel icon={CheckCircle2} title="Bestämt">
        <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="mm-decided">
          <li>Maskinobjekt i kundens platsträd tas bort (testdata). Maskinträdet börjar tomt.</li>
          <li>Kunden ser inte trädet nu.</li>
          <li>En servicebil kan vara en förrådsplats.</li>
          <li>Underhållsfälten lämnar arbetsordern och blir en underhållspost för en maskindel, som arbetsordern håller.</li>
          <li>Reservdelar dras från förrådet direkt när de läggs på arbetsordern.</li>
          <li>Återkommande arbete: en arbetsorder per tillfälle, skapad i förväg som vilande (ett år eller 12 tillfällen). Ronder: en arbetsorder per period, som i dag.</li>
          <li>Görs ett tillfälle senare flyttas det, och nästa räknas från när det gjordes.</li>
          <li>Operatören felanmäler och ser sina maskiner och egna anmälningar.</li>
        </ul>
        <p className="mt-4 text-xs font-semibold text-muted-foreground">Senare</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm" data-testid="mm-later">
          <li>Planerat driftstopp: en dag eller period per maskin eller linje. Arbeten märkta ”görs vid driftstopp” hamnar där.</li>
          <li>AI felsöker först vid felanmälan: förslag med underlag, går att hoppa över.</li>
          <li>Företagets egen lista med orsaker under Inställningar.</li>
        </ul>
      </Panel>
    </div>

    <Modal open={Boolean(bigImage)} onOpenChange={(value) => { if (!value) setBigImage(null); }} title={bigImage?.name ?? "Bild"}>
      {bigImage ? <div className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- an example drawing or a picture chosen on this device */}
        <img src={bigImage.url} alt={bigImage.name} className="max-h-[70dvh] w-full rounded-lg border object-contain" data-testid="mm-big-image" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={bigImage.id === part.mainImage} onClick={() => { patch({ mainImage: bigImage.id }); setBigImage(null); announce("Huvudbilden är bytt"); }}>Gör till huvudbild</Button>
          <Button type="button" variant="outline" className="text-destructive" onClick={() => removeImage(bigImage.id)}><Trash2 />Ta bort</Button>
        </div>
      </div> : null}
    </Modal>

    <Modal open={Boolean(newJob)} onOpenChange={(value) => { if (!value) setNewJob(null); }} title={`Nytt återkommande arbete · ${part.name}`} size="form">
      {newJob ? <div className="grid gap-4" data-testid="mm-job-form">
        <Field id="mm-job-name" label="Vad ska göras?" value={newJob.name} placeholder="Till exempel Byt filter" onChange={(name) => setNewJob({ ...newJob, name })} />
        <Field id="mm-job-kind" label="Intervall" value={newJob.kind} options={["Kalender", "Drifttimmar", "Det som kommer först"]} onChange={(kind) => setNewJob({ ...newJob, kind: kind as IntervalKind })} />
        <div className="grid grid-cols-3 gap-3">
          <Field id="mm-job-every" label="Var" type="number" value={newJob.every} disabled={newJob.kind === "Drifttimmar"} onChange={(every) => setNewJob({ ...newJob, every: Math.max(1, Number(every) || 1) })} />
          <Field id="mm-job-unit" label="Enhet" value={newJob.unit} options={["dag", "vecka", "månad", "år"]} disabled={newJob.kind === "Drifttimmar"} onChange={(unit) => setNewJob({ ...newJob, unit: unit as CalendarUnit })} />
          <Field id="mm-job-hours" label="Drifttimmar" type="number" value={newJob.hours} disabled={newJob.kind === "Kalender"} onChange={(hours) => setNewJob({ ...newJob, hours: Math.max(1, Number(hours) || 1) })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="mm-job-who" label="Vem" value={newJob.who} options={PEOPLE} onChange={(who) => setNewJob({ ...newJob, who })} />
          <Field id="mm-job-estimate" label="Uppskattad tid" value={newJob.estimate} onChange={(estimate) => setNewJob({ ...newJob, estimate })} />
        </div>
        <Field id="mm-job-form" label="Formulär eller rond" value={newJob.form} options={FORMS} onChange={(form) => setNewJob({ ...newJob, form })} />
        <Field id="mm-job-spare" label="Reservdel" value={newJob.spares[0]?.article ?? ""} options={["", ...part.articles]}
          optionLabels={Object.fromEntries([["", "Ingen"], ...articles.map((item) => [item.id, `${item.name} (${total(item)} ${item.unit} i förrådet)`])])}
          onChange={(article) => setNewJob({ ...newJob, spares: article ? [{ article, qty: 1 }] : [] })} />
        <p className="text-xs text-muted-foreground">{ruleText(newJob)}. Spara skapar en vilande arbetsorder för vart och ett av de 12 nästa tillfällena.</p>
        <DialogActions cancel={{ onClick: () => setNewJob(null) }} primary={{ label: "Spara", onClick: saveJob, testId: "mm-job-save" }} />
      </div> : null}
    </Modal>
  </div></PanelAreaProvider>;
}

type PlanRow = { key: string; date: string; title: string; target: string; tree: string; who: string; estimate: string; order: string; status: JobOccurrence["status"] | "Försenad"; round: boolean };

/** Underhållsplanering: the coming weeks across the machines – the same occurrences as Planering, filtered. */
function MaintenancePlanning({ parts }: { parts: Part[] }) {
  const [tree, setTree] = useState("Alla");
  const [who, setWho] = useState("Alla");
  const weeks = [isoWeek(TODAY), isoWeek(TODAY) + 1, isoWeek(TODAY) + 2, isoWeek(TODAY) + 3];
  const all: PlanRow[] = [
    ...parts.flatMap((part) => part.jobs.flatMap((job) => job.occurrences.filter((item) => item.status !== "Klar").map((item) => ({
      key: item.order, date: item.date, title: job.name, target: `${part.path} › ${part.name}`, tree: part.tree, who: job.who, estimate: job.estimate, order: item.order, status: occurrenceStatus(item), round: false,
    } satisfies PlanRow)))),
    ...ROUNDS.flatMap((round) => round.dates.map((date) => ({ key: `${round.name}-${date}`, date, title: round.name, target: `${round.stops.length} stopp`, tree: round.tree, who: round.who, estimate: "1 h 30 min", order: round.order, status: "Aktiv" as const, round: true }))),
  ];
  const rows = all.filter((item) => weeks.includes(isoWeek(item.date)) && (tree === "Alla" || item.tree === tree) && (who === "Alla" || item.who === who)).sort((a, b) => a.date.localeCompare(b.date));
  const level = useProposalLevel();
  const open = (order: string) => announce(`Öppnar ${order} – visar bara utseendet i förslaget.`);
  if (level === 1) return <div className="space-y-1" data-testid="mm-planning">
    <ListGroup footer="Samma tillfällen som i Planering.">
      <NativePickerRow label="Träd" display={tree}><select id="mm-plan-tree" aria-label="Träd" value={tree} onChange={(event) => setTree(event.target.value)}>{["Alla", ...TREES].map((item) => <option key={item}>{item}</option>)}</select></NativePickerRow>
      <NativePickerRow label="Person" display={who}><select id="mm-plan-who" aria-label="Person" value={who} onChange={(event) => setWho(event.target.value)}>{["Alla", ...PEOPLE].map((item) => <option key={item}>{item}</option>)}</select></NativePickerRow>
    </ListGroup>
    {weeks.map((week) => { const shown = rows.filter((item) => isoWeek(item.date) === week); return <ListGroup key={week} title={`Vecka ${week}${week === isoWeek(TODAY) ? " (denna)" : ""}`}>
      {shown.length ? shown.map((item) => <ListRow key={item.key} type={item.round ? "round" : "tools"} icon={item.round ? Repeat : Wrench} title={item.title} subtitle={`${shortDate(item.date)} · ${item.target} · ${item.who}`}
        pill={{ label: item.status, tone: OCCURRENCE_TONE[item.status] }} onClick={() => open(item.order)} testId="mm-occurrence" />) : <ListRow title="Inget planerat" chevron={false} />}
    </ListGroup>; })}
    <ListGroup title="Ronder">{ROUNDS.map((round) => <ListRow key={round.name} type="round" icon={Repeat} title={round.name} subtitle={`${round.rule} · ${round.stops.length} stopp · ${round.order}`} chevron={false} />)}</ListGroup>
  </div>;
  return <div className="space-y-6" data-testid="mm-planning">
    <p className="notice flex items-start gap-2 text-sm"><CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Samma tillfällen som i Planering (Tidplan och Kalender) – ingen egen planerare. Vilande arbetsordrar syns också där.</span></p>
    <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,16rem)]">
      <Field id="mm-plan-tree" label="Träd" value={tree} options={["Alla", ...TREES]} onChange={setTree} />
      <Field id="mm-plan-who" label="Person" value={who} options={["Alla", ...PEOPLE]} onChange={setWho} />
    </div>
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] [&>*]:min-w-0">
      <Panel icon={CalendarDays} title="Kommande veckor">
        <div className="space-y-4">{weeks.map((week) => {
          const shown = rows.filter((item) => isoWeek(item.date) === week);
          return <section key={week} aria-label={`Vecka ${week}`}>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Vecka {week}{week === isoWeek(TODAY) ? " (denna)" : ""}</p>
            {shown.length ? <ul className="-mx-4 divide-y border-y text-sm">{shown.map((item) => <li key={item.key}>
              <button type="button" onClick={() => open(item.order)} data-testid="mm-occurrence"
                className={cn("grid w-full gap-1 px-5 py-2 text-left hover:bg-muted sm:grid-cols-[6.5rem_minmax(0,1fr)_7rem_5.5rem_5.5rem] sm:items-center", item.status === "Försenad" && "bg-red-50 dark:bg-red-950/40")}>
                <span className="text-xs tabular-nums text-muted-foreground">{shortDate(item.date)}</span>
                <span className="min-w-0"><span className="flex items-center gap-1.5 font-medium">{item.round ? <Repeat className="size-3.5 shrink-0" aria-hidden="true" /> : <Wrench className="size-3.5 shrink-0" aria-hidden="true" />}<span className="truncate">{item.title}</span></span>
                  <span className="block truncate text-xs text-muted-foreground">{item.target} · {item.estimate}</span></span>
                <span className="truncate text-xs">{item.who}</span>
                <span><Badge variant="outline" className={indicatorBadge(OCCURRENCE_TONE[item.status])}>{item.status}</Badge></span>
                <span className="text-xs font-semibold text-primary sm:text-right">{item.order}</span>
              </button>
            </li>)}</ul> : <p className="text-sm text-muted-foreground">Inget planerat.</p>}
          </section>;
        })}</div>
        <p className="mt-3 text-xs text-muted-foreground">Försenat flyttas och planeras om. Nästa tillfälle räknas från när det gjordes.</p>
      </Panel>
      <Panel icon={Repeat} title="Ronder">
        <ul className="space-y-3 text-sm" data-testid="mm-rounds">{ROUNDS.map((round) => <li key={round.name}>
          <p className="font-semibold">{round.name}</p>
          <p className="text-xs text-muted-foreground">{round.rule} · {round.who} · {round.order} för perioden</p>
          <ol className="mt-1 list-decimal pl-5 text-xs">{round.stops.map((stop) => <li key={stop}>{stop}</li>)}</ol>
        </li>)}</ul>
        <p className="mt-3 text-xs text-muted-foreground">Driftrondens funktion med maskindelar som stopp.</p>
      </Panel>
    </div>
  </div>;
}

