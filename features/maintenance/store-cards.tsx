"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useModuleOn } from "@/features/workflow/use-modules";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Boxes, ClipboardCheck, Hash, PackagePlus, Pencil, Trash2, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListGroup, NativePickerRow } from "@/components/native/list";
import { PageHeader } from "@/components/page-shell";
import { Panel, RowsSkeleton } from "@/features/kfid/ui";
import { useConfirm } from "@/features/kfid/confirm";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { formatSwedish } from "@/lib/swedish-time";
import { announce } from "@/lib/workflow/toast";
import { useLoadEffect } from "@/lib/use-load-effect";
import { cn } from "@/lib/utils";
import { partLevelName } from "@/lib/maintenance/place-model";
import { quantityText, storeLevelName, STORE_TRANSACTION_LABELS } from "@/lib/maintenance/model";
import { kronor, maintenanceGet, maintenancePost, type StoreArticleCard, type StoreCostOrder, type StoreEvent, type StoreFigures, type StoreLocationRow, type StorePlaceCard } from "./maintenance-api";
import { FigureBox } from "./maintenance-figures";
import { EditItemDialog, MoveDialog } from "./store-dialogs";

/**
 * Korten i Förrådet (2026-10-31): valt förråd eller vald plats med flikarna Översikt, Artiklar, Saldo per plats, Uttag och
 * händelser och Kostnad och nyckeltalen Artiklar, Lågt saldo, Lagervärde och Uttag senaste 90 dagar; vald artikel med sitt eget nummer,
 * raden "Beställs som" (aldrig blandad med numret) och saldo per plats med totalen. Kolumnerna följer kortets egen bredd (container
 * queries), så de fungerar från 390 till 1920 px.
 */
export const STORE_PLACE_TABS = ["Översikt", "Artiklar", "Saldo per plats", "Uttag och händelser", "Kostnad"] as const;
export type StoreTab = (typeof STORE_PLACE_TABS)[number];
export const STORE_TAB_ARTICLES: StoreTab = "Artiklar";
const ARTICLE_TABS = ["Översikt", "Saldo per plats", "Uttag och händelser", "Kostnad"] as const;
type ArticleTab = (typeof ARTICLE_TABS)[number];
const when = (value: string) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });
const chip = (on: boolean) => cn("touch-target h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-sm", on ? "border-primary/30 bg-secondary font-medium" : "text-muted-foreground hover:text-foreground");
const taskHref = (id: string) => `/?view=workflow_task&taskType=WORK_ORDER&taskId=${encodeURIComponent(id)}`;

function Tabs<T extends string>({ tabs, tab, onTab, native, label }: { tabs: readonly T[]; tab: T; onTab: (next: T) => void; native: boolean; label: string }) {
  if (native) return <ListGroup>
    <NativePickerRow label="Visa" display={tab} testId="store-tab-picker">
      <select aria-label={label} value={tab} onChange={(event) => onTab(event.target.value as T)}>{tabs.map((item) => <option key={item} value={item}>{item}</option>)}</select>
    </NativePickerRow>
  </ListGroup>;
  return <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label={label}>
    {tabs.map((item) => <button key={item} type="button" aria-current={tab === item ? "true" : undefined} onClick={() => onTab(item)} className={chip(tab === item)} data-testid={`store-tab-${item}`}>{item}</button>)}
  </div>;
}

function Figures({ figures, prices, valueTruncated = false, first }: { figures: StoreFigures; prices: boolean; valueTruncated?: boolean; first?: { label: string; value: string; hint?: string; testId?: string } }) {
  return <div className="@container"><dl className="grid grid-cols-2 gap-3 text-sm @2xl:grid-cols-4" data-testid="store-figures">
    {first ? <FigureBox {...first} /> : <FigureBox label="Artiklar" value={String(figures.articles)} testId="store-figure-articles" />}
    {first ? null : <FigureBox label="Lågt saldo" value={String(figures.low)} testId="store-figure-low" />}
    {prices ? <FigureBox label="Lagervärde" value={kronor(figures.value)} hint={valueTruncated ? "Bara de första 200 artiklarna" : figures.value === null ? "Inget känt pris" : undefined} testId="store-figure-value" /> : null}
    <FigureBox label="Uttag senaste 90 dagar" value={String(Math.max(0, figures.withdrawals90))} testId="store-figure-withdrawals" />
  </dl></div>;
}

function Events({ events }: { events: StoreEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">Inga uttag eller händelser än.</p>;
  return <ul className="-mx-4 divide-y border-y text-sm" data-testid="store-log-view">{events.map((row) => <li key={row.id} className="grid gap-1 px-5 py-2 @xl:grid-cols-[7.5rem_minmax(0,1fr)_6rem] @xl:items-center" data-testid="store-log-row">
    <span className="text-xs tabular-nums text-muted-foreground">{when(row.at)}</span>
    <span className="min-w-0"><span className="font-medium">{STORE_TRANSACTION_LABELS[row.kind]}</span> · {row.itemName}
      <span className="block truncate text-xs text-muted-foreground">{[row.locationName, row.workOrder?.title, row.byName, row.note].filter(Boolean).join(" · ")}</span></span>
    <span className="tabular-nums @xl:text-right">{row.change > 0 ? "+" : ""}{quantityText(row.change)} → {quantityText(row.balanceAfter)}</span>
  </li>)}</ul>;
}

function CostOrders({ figures, orders, prices }: { figures: StoreFigures; orders: StoreCostOrder[]; prices: boolean }) {
  if (!prices) return <p className="text-sm text-muted-foreground" data-testid="store-cost">Belopp visas bara med rätt att se priser.</p>;
  return <div className="@container space-y-3" data-testid="store-cost">
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <FigureBox label="Uttag senaste 90 dagar" value={kronor(figures.withdrawalCost90)} testId="store-cost-90" />
      <FigureBox label="Uttag totalt" value={kronor(figures.withdrawalCostTotal)} testId="store-cost-total" />
    </dl>
    {orders.length ? <ul className="-mx-4 divide-y border-y text-sm" data-testid="store-cost-orders">{orders.map((order) => <li key={order.id} className="grid gap-1 px-5 py-2 @xl:grid-cols-[minmax(0,1fr)_8rem] @xl:items-center">
      <Link className="min-w-0 truncate font-medium underline-offset-2 hover:underline" href={taskHref(order.id)}>{order.title}</Link>
      <span className="tabular-nums text-xs text-muted-foreground @xl:text-right">{kronor(order.value)}</span>
    </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga uttag till arbetsordrar än.</p>}
    <p className="text-xs text-muted-foreground">Priset när delen togs ut. Inget att fylla i.</p>
  </div>;
}

function useCard<T>(query: string) {
  const [card, setCard] = useState<T | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { try { setCard(await maintenanceGet<T>(query)); setError(""); } catch (cause) { setError((cause as Error).message); } }, [query]);
  useLoadEffect(load);
  return { card, error, reload: load };
}

/** The chosen store or place (or the whole store): the tabs. The articles come from the page, where the filter row lives. */
export function StorePlacePane({ id, name, row, level, native, tab, onTab, articles, onOpenArticle }: {
  id: string | null; name: string; row: StoreLocationRow | null; level: number; native: boolean; tab: StoreTab; onTab: (next: StoreTab) => void; articles: ReactNode; onOpenArticle: (id: string) => void;
}) {
  const { card, error } = useCard<StorePlaceCard>(id ? `part=store_place&id=${encodeURIComponent(id)}` : "part=store_place");
  const facts = <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="store-place-facts">
    {row ? <span>{storeLevelName(level, row.kind)}</span> : null}
    {row && !row.isActive ? <Badge variant="outline" className={indicatorBadge("neutral")}>Pausad</Badge> : null}
    {row && row.parentId ? <span>{row.name}</span> : null}
    {row?.seriesStart ? <span data-testid="store-series">Nummerserie från {row.seriesStart}{row.nextNumber ? ` · nästa ${row.nextNumber}` : ""}</span> : null}
  </div>;
  const body = error ? <p role="alert" className="notice text-destructive">{error}</p>
    : tab === "Artiklar" ? <div data-testid="store-articles">{articles}<p className="mt-3 text-xs text-muted-foreground">Uttag görs på arbetsordern. Knappen Beställ skapar ett vanligt inköp.</p></div>
    : !card ? <RowsSkeleton rows={3} label="Hämtar förrådet…" />
    : tab === "Översikt" ? <div className="space-y-4">
      <Figures figures={card.figures} prices={card.pricesVisible} valueTruncated={card.valueTruncated} />
      <p className="text-xs text-muted-foreground">{id ? "Platsen och allt under den." : "Hela förrådet."}</p>
    </div>
    : tab === "Saldo per plats" ? <BalanceRows card={card} onOpenArticle={onOpenArticle} />
    : tab === "Uttag och händelser" ? <div className="@container"><Events events={card.events} /></div>
    : <CostOrders figures={card.figures} orders={card.costOrders} prices={card.pricesVisible} />;
  if (native) return <div className="space-y-2" data-testid="store-place">
    {row ? <div className="px-1">{facts}</div> : null}
    <Tabs tabs={STORE_PLACE_TABS} tab={tab} onTab={onTab} native label="Förrådets flik" />
    <div className="native-group min-h-40 p-4" data-testid="store-place-content">{body}</div>
  </div>;
  return <Panel icon={Warehouse} title={name}>
    <div data-testid="store-place">
      {row ? facts : null}
      <Tabs tabs={STORE_PLACE_TABS} tab={tab} onTab={onTab} native={false} label="Förrådets flikar" />
      <div className="min-h-60" data-testid="store-place-content">{body}</div>
    </div>
  </Panel>;
}

function BalanceRows({ card, onOpenArticle }: { card: StorePlaceCard; onOpenArticle: (id: string) => void }) {
  if (!card.balances.length) return <p className="text-sm text-muted-foreground">Inget saldo här än.</p>;
  return <ul className="-mx-4 divide-y border-y text-sm" data-testid="store-balances">{card.balances.map((row) => <li key={`${row.itemId}-${row.locationId}`} data-testid="store-balance-row">
    <button type="button" className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-5 py-2 text-left hover:bg-muted" onClick={() => onOpenArticle(row.itemId)}>
      <span className="min-w-0"><span className="block truncate font-medium">{row.itemName}</span><span className="block truncate text-xs text-muted-foreground">{[row.ownNumber ? `Nr ${row.ownNumber}` : "", row.locationName].filter(Boolean).join(" · ")}</span></span>
      <span className="tabular-nums">{quantityText(row.quantity)} {row.unit}</span>
    </button>
  </li>)}</ul>;
}

/** The article's own card. Inleverans and Inventera are here; a withdrawal is made on the work order. */
export function StoreArticlePane({ id, locations, native, onBack, onChanged, onGone }: { id: string; locations: StoreLocationRow[]; native: boolean; onBack: () => void; onChanged: () => Promise<void>; onGone: () => void }) {
  const router = useRouter();
  // Företagets moduler (0.39.0): the store orders through a purchase, so Beställ follows Inköp och artiklar.
  const purchasingOn = useModuleOn("purchasing");
  const { card, error, reload } = useCard<StoreArticleCard>(`part=store_article&id=${encodeURIComponent(id)}`);
  const [tab, setTab] = useState<ArticleTab>("Översikt");
  const [move, setMove] = useState<"receive" | "count" | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const changed = async () => { await Promise.all([reload(), onChanged()]); };
  if (error) return <Panel icon={Boxes} title="Artikeln"><p role="alert" className="notice text-destructive">{error}</p><Button type="button" variant="outline" className="mt-3" onClick={onBack}><ArrowLeft />Tillbaka</Button></Panel>;
  if (!card) return <Panel icon={Boxes} title="Hämtar artikeln…"><RowsSkeleton rows={4} label="Hämtar artikeln…" /></Panel>;
  const { item } = card;
  const active = locations.filter((row) => row.isActive);
  const order = async () => {
    try {
      const made = await maintenancePost<{ id: string; label: string }>({ action: "order", id: item.id });
      announce(`Inköp ${made.label} skapades med ${item.name}.`, false, [{ label: "Öppna", run: () => router.push(`/?view=purchase&purchaseId=${encodeURIComponent(made.id)}`) }]);
    } catch (cause) { announce((cause as Error).message, true); }
  };
  const assign = async () => {
    try { const made = await maintenancePost<{ ownNumber: number }>({ action: "assign_store_number", id: item.id, storeId: item.homeStoreId }); announce(`Artikeln fick nummer ${made.ownNumber}.`); await changed(); }
    catch (cause) { announce((cause as Error).message, true); }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Ta bort ${item.name}?`, message: "En artikel med logg i förrådet tas inte bort.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    try { await maintenancePost({ action: "delete_store_item", id: item.id }); announce(`${item.name} togs bort.`); onGone(); }
    catch (cause) { announce((cause as Error).message, true); }
  };
  const orderAs = [item.supplierName, item.articleNo].filter(Boolean).join(" ");
  const noPlace = active.length ? null : "Lägg till ett förråd först.";
  const actions = <div className="flex flex-wrap items-center gap-1.5" data-testid="store-article-actions">
    {native ? null : <Button type="button" size="sm" variant="outline" onClick={onBack} data-testid="store-article-back"><ArrowLeft />Tillbaka</Button>}
    {card.canEdit ? <>
      <Button type="button" size="sm" variant="outline" disabledReason={noPlace} onClick={() => setMove("receive")} data-testid="store-receive"><PackagePlus />Inleverans</Button>
      <Button type="button" size="sm" variant="outline" disabledReason={noPlace} onClick={() => setMove("count")} data-testid="store-count"><ClipboardCheck />Inventera</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid="store-item-edit"><Pencil />Redigera</Button>
      {item.ownNumber === null ? <Button type="button" size="sm" variant="ghost" onClick={() => void assign()} data-testid="store-assign-number"><Hash />Ge eget nummer</Button> : null}
    </> : null}
    {item.low && card.canOrder && purchasingOn ? <Button type="button" size="sm" onClick={() => void order()} data-testid="store-order"><Boxes />Beställ</Button> : null}
    {card.canEdit ? <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => void remove()} data-testid="store-item-delete"><Trash2 />Ta bort</Button> : null}
  </div>;
  const facts = <div className="space-y-1 text-xs text-muted-foreground" data-testid="store-article-facts">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Badge variant="outline" className={indicatorBadge(item.ownNumber === null ? "neutral" : "info")} data-testid="store-article-number">{item.ownNumber === null ? "Inget eget nummer" : `Nr ${item.ownNumber}`}</Badge>
      {item.total <= 0 ? <Badge variant="outline" className={indicatorBadge("danger")}>Slut</Badge> : item.low ? <Badge variant="outline" className={indicatorBadge("warning")}>Lågt</Badge> : null}
      {item.homeStoreName ? <span>{item.homeStoreName}</span> : null}
      {item.shelfText ? <span data-testid="store-article-shelf">Hylla {item.shelfText}</span> : null}
      {item.fromRegister ? null : <span>Egen artikel</span>}
    </div>
    <p data-testid="store-order-as">Beställs som: {orderAs || "–"}</p>
  </div>;
  const body = tab === "Översikt" ? <div className="@container space-y-4">
    <Figures figures={card.figures} prices={card.pricesVisible} first={{ label: "Totalt saldo", value: `${quantityText(item.total)} ${item.unit}`, hint: item.minQuantity !== null ? `Lägsta ${quantityText(item.minQuantity)}` : undefined, testId: "store-article-total" }} />
    {card.parts.length ? <div>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Reservdel till</h3>
      <ul className="-mx-4 divide-y border-y text-sm" data-testid="store-article-parts">{card.parts.map((part) => <li key={part.id} className="px-5 py-2">
        <Link className="block truncate font-medium underline-offset-2 hover:underline" href={`/?view=maintenance&part=${encodeURIComponent(part.id)}`}>{part.name}</Link>
        <span className="block truncate text-xs text-muted-foreground">{[partLevelName(part.level), part.path, `${quantityText(part.quantity)} ${item.unit} per byte`].filter(Boolean).join(" · ")}</span>
      </li>)}</ul>
    </div> : null}
  </div>
    : tab === "Saldo per plats" ? <div data-testid="store-article-balances">
      {card.balances.length ? <ul className="-mx-4 divide-y border-y text-sm">{card.balances.map((row) => <li key={row.locationId} className="flex items-center justify-between gap-2 px-5 py-2" data-testid="store-article-balance">
        <span className="min-w-0 truncate">{row.locationName}{row.isActive ? "" : " · Pausad"}</span><span className="tabular-nums">{quantityText(row.quantity)} {item.unit}</span>
      </li>)}
        <li className="flex items-center justify-between gap-2 px-5 py-2 font-semibold"><span>Totalt</span><span className="tabular-nums" data-testid="store-article-balance-total">{quantityText(item.total)} {item.unit}</span></li>
      </ul> : <p className="text-sm text-muted-foreground">Inget saldo än. Lägg in det med Inleverans.</p>}
    </div>
    : tab === "Uttag och händelser" ? <div className="@container"><Events events={card.events} /></div>
    : <CostOrders figures={card.figures} orders={card.costOrders} prices={card.pricesVisible} />;
  const dialogs = <>
    {move ? <MoveDialog kind={move} item={item} balances={card.balances} locations={active} onClose={() => setMove(null)} onSaved={async () => { setMove(null); await changed(); }} /> : null}
    {editing ? <EditItemDialog item={item} pricesVisible={card.pricesVisible} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await changed(); }} /> : null}
    {confirmElement}
  </>;
  if (native) return <div className="space-y-2" data-testid="store-article">
    <PageHeader title={item.name} />
    <div className="space-y-2 px-1">{facts}{actions}</div>
    <Tabs tabs={ARTICLE_TABS} tab={tab} onTab={setTab} native label="Artikelns flik" />
    <div className="native-group min-h-40 p-4">{body}</div>
    {dialogs}
  </div>;
  return <Panel icon={Boxes} title={item.name}>
    <div data-testid="store-article">
      <div className="mb-3 space-y-3">{facts}{actions}</div>
      <Tabs tabs={ARTICLE_TABS} tab={tab} onTab={setTab} native={false} label="Artikelns flikar" />
      <div className="min-h-60">{body}</div>
    </div>
    {dialogs}
  </Panel>;
}
