"use client";

import { plural } from "@/lib/plural";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { CalendarClock, Clock3, FileText, FolderKanban, Hammer, Receipt, ReceiptText, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { indicatorText } from "@/features/workflow/indicator-tone";
import { InvoiceBasisModal, type InvoiceBasisTarget } from "@/features/invoice-basis/invoice-basis-view";
import { BOX_GAP, Box, Columns, EmptyNote, GrowBar, Halves, Pill, ROWS_SKELETON, SrTable } from "@/features/overview/viz";
import { cn } from "@/lib/utils";
import { isoWeek } from "@/lib/workflow/schedule";
import { listHref } from "@/lib/url-filters";
import { creditSummaryLines } from "@/lib/credits/wallet-summary";
import { QUOTE_STATUS_LABELS } from "@/lib/quotes/model";
import { FIGURE_KIND_LABEL, expiresText, hoursText, monthShort, type EconomyTabData, type FigureKind, type UnbilledRow } from "@/lib/overview/economy-model";
import { UNBILLED_LATE_DAYS, economyFigures, economySentence, invoicedStatus, invoicedTimeShare, materialRowsText } from "@/lib/overview/economy-headline";
import { Figure } from "@/features/overview/viz";
import { Calm, CountLink, HeadlineCard, Row, RowList } from "./rows";
import { MoreNote, TabSkeleton, day } from "./team-customers-parts";

/**
 * Översikt → Ekonomi (2026-10-28; reworked 2026-10-29 "med användare i fokus", the same way as Jag and Teamet): the
 * economy's situation on top in one sentence with its figures; Att fakturera – the jobs and projects with finished time no
 * basis has taken, the oldest first, each with how much of its time is already billed and Skapa underlag (the existing
 * proposal, its own double-billing protection) – beside Offerter, the won quotes without a work order and those running out;
 * then Fakturerat per månad against the company's goal and the AI credits. Every figure says whether it is "Verkligt"
 * (invoiced bases, decided quotes) or an "Uppskattning" (unbilled hours × the company's own hourly rate). No cash flow,
 * overdue invoices or margin: there is no reliable source for them. Nothing is made from here but through the existing flows.
 */
type Level = 2 | 3;
const kr = (value: number) => `${Math.round(value).toLocaleString("sv-SE")} kr`;
const tkr = (value: number) => Math.abs(value) >= 10_000 ? `${Math.round(value / 1000).toLocaleString("sv-SE")} tkr` : kr(value);
const days = (count: number) => `${count} ${count === 1 ? "dag" : "dagar"}`;
const LONG_MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const LONG_DAYS = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
const quoteHref = (id: string) => `/?view=quote&quoteId=${encodeURIComponent(id)}`;

/** The tag that says what a figure is (2026-10-28: "skilj uppskattningar från verkliga värden"). */
function Kind({ kind }: { kind: FigureKind }) {
  return <Pill tone={kind === "actual" ? "success" : "info"} className="h-5 px-1.5 text-[11px]">{FIGURE_KIND_LABEL[kind]}</Pill>;
}

function EconomyHeadline({ data }: { data: EconomyTabData }) {
  const figures = economyFigures(data);
  const date = new Date(`${data.today}T12:00:00Z`);
  const name = LONG_DAYS[(date.getUTCDay() + 6) % 7];
  return <HeadlineCard label="Läget i ekonomin" testId="economy-headline" title="Läget i ekonomin" sentence={economySentence(data)}
    kicker={`${name.charAt(0).toUpperCase()}${name.slice(1)} ${date.getUTCDate()} ${LONG_MONTHS[date.getUTCMonth()]} · vecka ${isoWeek(data.today)}`}
    chips={[
      { count: figures.unbilled, label: "att fakturera", href: "#att-fakturera", icon: Clock3, tone: figures.late ? "danger" : "warning", testId: "economy-chip-unbilled" },
      { count: figures.drafts, label: "utkast", href: "#att-fakturera", icon: ReceiptText, tone: "info", testId: "economy-chip-drafts" },
      { count: figures.withoutWorkOrder, label: "utan arbetsorder", href: "#offerter", icon: FileText, tone: "warning", testId: "economy-chip-won" },
      { count: figures.expiring, label: "går ut snart", href: "#offerter", icon: CalendarClock, tone: "warning", testId: "economy-chip-expiring" },
    ]} />;
}

/**
 * One unbilled job or project: its time and material rows, the estimate and how much of its finished time is already billed
 * (a job with material only says so instead – there is no time to measure).
 */
function UnbilledItem({ row, estimates, onCreate }: { row: UnbilledRow; estimates: boolean; onCreate: (row: UnbilledRow) => void }) {
  const share = invoicedTimeShare(row.seconds, row.invoicedSeconds);
  const materialOnly = row.seconds === 0 && row.invoicedSeconds === 0;
  return <Row columns pillColumn={false} area={row.kind === "project" ? "project" : "work-order"} icon={row.kind === "project" ? FolderKanban : Hammer}
    row={{ id: row.id, title: row.title, href: row.href, late: row.oldestDays >= UNBILLED_LATE_DAYS,
      detail: [row.kind === "project" ? "Projekt" : "Arbetsorder", row.customer, row.seconds > 0 ? hoursText(row.seconds) : "", row.materialRows ? materialRowsText(row.materialRows) : "",
        estimates && row.estimate !== null ? `≈ ${kr(row.estimate)}` : "", `äldst ${days(row.oldestDays)}`].filter(Boolean).join(" · ") }}
    meta={<>
      <Pill tone={row.invoicedSeconds > 0 ? "info" : "warning"} className="min-w-[5.5rem] shrink-0 justify-center whitespace-nowrap">{invoicedStatus(row.invoicedSeconds)}</Pill>
      {materialOnly ? <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-muted-foreground">Bara material</span> : <>
        <GrowBar value={share} max={100} className="hidden h-1.5 min-w-8 max-w-28 grow basis-8 @[13rem]/meta:block" fill="bg-primary" />
        <span className="shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums text-muted-foreground">{share} % av tiden fakturerat</span>
      </>}
    </>}
    action={row.canCreate
      ? <Button type="button" size="sm" variant="outline" onClick={() => onCreate(row)} aria-label={`Skapa fakturaunderlag för ${row.title}`} data-testid="economy-create-basis">Underlag</Button>
      : undefined} />;
}

/**
 * Att fakturera: finished time no basis has taken, per work order or project, the oldest first (red after 30 days), with the
 * share already billed; the drafts not invoiced as one row to their list. Lagom shows five, Allt eight, and Visa alla the rest
 * of what was read.
 */
function Billing({ data, level, onCreate }: { data: EconomyTabData; level: Level; onCreate: (row: UnbilledRow) => void }) {
  const [all, setAll] = useState(false);
  const unbilled = data.unbilled!;
  const limit = level === 2 ? 5 : 8;
  const rows = all ? unbilled.rows : unbilled.rows.slice(0, limit);
  // An estimate needs the price right; a row's own is null when it has time and the company no hourly rate.
  const estimates = data.access.prices;
  const materialRows = unbilled.totalMaterialRows ?? 0;
  const drafts = data.drafts && data.drafts.count && data.access.readBases ? data.drafts : null;
  return <Box title="Att fakturera" area="time" icon={Clock3} anchor="att-fakturera" className="h-full"
    action={unbilled.totalSeconds || materialRows ? <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground" data-testid="economy-unbilled-total">
      <span className="font-semibold text-foreground">{[unbilled.totalSeconds ? hoursText(unbilled.totalSeconds) : "", materialRows ? materialRowsText(materialRows) : ""].filter(Boolean).join(" · ")}</span>
      {estimates && unbilled.totalEstimate !== null ? <> · ≈ {tkr(unbilled.totalEstimate)}</> : null}
    </span> : undefined}>
    {rows.length || drafts ? <>
      <RowList testId="economy-unbilled">
        {rows.map((row) => <UnbilledItem key={`${row.kind}:${row.id}`} row={row} estimates={Boolean(estimates)} onCreate={onCreate} />)}
        {drafts ? <Row columns pillColumn={false} area="quote" icon={ReceiptText}
          row={{ id: "drafts", title: "Utkast som inte är fakturerade", href: listHref("invoice_bases", { filter: "DRAFT" }),
            detail: [`${drafts.count} fakturaunderlag`, drafts.net !== null ? `${kr(drafts.net)} exkl. moms${drafts.partial ? " (de senaste 500)" : ""}` : ""].filter(Boolean).join(" · ") }}
          action={<Pill tone="info" className="min-w-10 justify-center tabular-nums" data-testid="economy-drafts">{drafts.count}</Pill>} /> : null}
      </RowList>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-muted-foreground">
          {[unbilled.rows.length + unbilled.more > rows.length ? `Visar ${rows.length} av ${unbilled.groups}, äldst först.` : "",
            unbilled.hidden ? `${unbilled.hidden} som du inte kan öppna räknas bara i summan.` : "",
            estimates ? "≈ är en uppskattning: timmar × företagets timpris plus materialradernas egna priser." : ""].filter(Boolean).join(" ")}
        </p>
        {unbilled.rows.length > limit ? <Button type="button" size="sm" variant="ghost" onClick={() => setAll((value) => !value)} data-testid="economy-unbilled-all">
          {all ? "Visa färre" : `Visa alla ${unbilled.rows.length}`}
        </Button> : null}
      </div>
    </> : <Calm text={unbilled.hidden ? `${unbilled.hidden} arbetsordrar som du inte kan öppna har ofakturerat arbete` : "Allt färdigt arbete finns i ett fakturaunderlag"} />}
  </Box>;
}

/** A quote's status and what is next: a sent quote's last day, or the work order a won one lacks. */
function QuoteMeta({ status, text, tone }: { status: "SENT" | "ACCEPTED"; text: string; tone?: "warning" }) {
  return <>
    <Pill tone={status === "SENT" ? "info" : "success"} className="min-w-[5.5rem] shrink-0 justify-center">{QUOTE_STATUS_LABELS[status]}</Pill>
    <span className={cn("min-w-0 truncate text-[11px] font-medium", tone ? indicatorText(tone) : "text-muted-foreground")}>{text}</span>
  </>;
}

/**
 * Offerter: the won quotes that have no work order yet (the money is decided, the work not started), then the sent quotes
 * running out within 14 days, the soonest first; the win rate of the last twelve months against the company's goal under.
 */
function Quotes({ data, level }: { data: EconomyTabData; level: Level }) {
  const quotes = data.quotes!;
  const limit = level === 2 ? 4 : 6;
  // The most urgent first: a quote running out within three days, then the won ones to start, then the other sent ones.
  const items = [
    ...quotes.expiring.rows.map((row) => ({ kind: "expiring" as const, row, urgency: row.days <= 3 ? 0 : 2 })),
    ...(quotes.withoutWorkOrder?.rows ?? []).map((row) => ({ kind: "won" as const, row, urgency: 1 })),
  ].sort((a, b) => a.urgency - b.urgency).slice(0, limit);
  const prices = data.access.prices;
  const total = (quotes.withoutWorkOrder?.count ?? 0) + quotes.expiring.count;
  const goal = data.goals.quoteWinRatePercent;
  const rate = quotes.winRate;
  const read = data.access.readQuotes;
  return <Box title="Offerter" area="quote" icon={FileText} anchor="offerter" className="h-full"
    action={read ? <span className="flex flex-wrap items-baseline justify-end gap-x-3">
      <CountLink href={listHref("quotes", { filter: "SENT" })} count={quotes.awaiting.count} testId="economy-quotes-awaiting">väntar på svar</CountLink>
      <CountLink href={listHref("quotes", { filter: "ACCEPTED" })} count={quotes.acceptedThisMonth.count} testId="economy-quotes-accepted">accepterade i {monthShort(data.today.slice(0, 7))}</CountLink>
    </span> : <span className="text-xs tabular-nums text-muted-foreground"><span className="font-semibold">{quotes.awaiting.count}</span> väntar på svar</span>}>
    {items.length ? <RowList testId="economy-quotes">
      {items.map((item) => item.kind === "won" ? <Row key={`won:${item.row.id}`} columns pillColumn={false} area="quote" icon={FileText}
        row={{ id: item.row.id, title: `${item.row.label} · ${item.row.title || "Utan rubrik"}`, href: item.row.href,
          detail: [item.row.customerName, item.row.decidedOn ? `Accepterad ${day(item.row.decidedOn)}` : "", prices && item.row.net !== null ? `${kr(item.row.net)} exkl. moms` : ""].filter(Boolean).join(" · ") }}
        meta={<QuoteMeta status="ACCEPTED" text="Arbetsorder saknas" tone="warning" />} />
        : <Row key={`exp:${item.row.id}`} columns pillColumn={false} area="quote" icon={CalendarClock}
          row={{ id: item.row.id, title: `${item.row.label} · ${item.row.title || "Utan rubrik"}`, href: quoteHref(item.row.id), late: item.row.days <= 3,
            detail: [item.row.customer, item.row.net !== null ? `${kr(item.row.net)} exkl. moms` : "", `giltig t.o.m. ${day(item.row.validUntil)}`].filter(Boolean).join(" · ") }}
          meta={<QuoteMeta status="SENT" text={expiresText(item.row.days)} tone={item.row.days <= 3 ? "warning" : undefined} />} />)}
    </RowList> : total ? <EmptyNote compact icon={FileText} title={`${plural(total, "offert", "offerter")} att följa upp`} text="De visas för den som får läsa offerter." />
      : <Calm text="Inga vunna offerter utan arbetsorder och inga som går ut inom 14 dagar" />}
    {/* Not the set of "väntar på svar" in the head: won ones without a work order and those running out within 14 days (resa 4, 2026-11-06). */}
    {items.length ? <MoreNote shown={items.length} total={total} what="att följa upp: vunna utan arbetsorder och de som går ut inom 14 dagar" /> : null}
    {/* Andel vunna (verkligt): won of decided quote numbers, the last twelve months, against the goal. */}
    <section aria-label="Andel vunna offerter" className="mt-4" data-testid="economy-win-rate">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
        <h3 className="font-semibold">Andel vunna <span className="font-normal text-muted-foreground">· senaste {rate.months} mån</span></h3>
        <span className="tabular-nums text-muted-foreground">{rate.percent === null ? "Inga avgjorda offerter" : <><span className="font-semibold text-foreground">{rate.percent} %</span> · {rate.won} av {rate.won + rate.lost}</>}{goal !== null ? <> · <span className={cn(rate.percent !== null && indicatorText(rate.percent >= goal ? "success" : "warning"))}>mål {goal} %</span></> : ""}</span>
      </div>
      <div className="relative mt-2">
        <GrowBar value={rate.percent ?? 0} max={100} className="h-1.5" fill={rate.percent !== null && goal !== null && rate.percent >= goal ? "bg-[var(--type-round)]" : "bg-primary"} />
        {goal !== null ? <span className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-foreground/50" style={{ left: `calc(${Math.min(100, goal)}% - 1px)` }} aria-hidden="true" /> : null}
      </div>
    </section>
  </Box>;
}

/** Fakturerat per månad (verkligt): this month against the company's goal on top, the six months as bars with the goal line. */
function Invoiced({ data }: { data: EconomyTabData }) {
  const invoiced = data.invoiced!;
  const prices = data.access.prices;
  const value = (month: (typeof invoiced.months)[number]) => prices ? month.net ?? 0 : month.count;
  const goal = prices ? data.goals.invoicedPerMonth : null;
  const max = Math.max(1, ...invoiced.months.map(value), goal ?? 0) * 1.08;
  const last = invoiced.months.length - 1;
  const now = invoiced.months[last];
  const show = (amount: number) => prices ? kr(amount) : `${amount} st`;
  const share = goal && now ? Math.round((value(now) / goal) * 100) : null;
  return <Box title="Fakturerat per månad" area="quote" icon={Wallet} anchor="fakturerat"
    action={data.access.readBases ? <Button size="sm" variant="ghost" asChild><Link href={listHref("invoice_bases", { filter: "INVOICED" })}>Fakturerade</Link></Button> : undefined}>
    <section aria-label={`Fakturerat i ${data.monthName}`} data-testid="economy-month">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
        <h3 className="flex items-center gap-2 font-semibold">Fakturerat i {data.monthName} <Kind kind="actual" /></h3>
        <span className="tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{now ? show(value(now)) : "–"}</span>
          {goal !== null ? ` av målet ${tkr(goal)}` : prices ? " · inget mål satt" : " underlag · belopp kräver prisbehörighet"}</span>
      </div>
      {goal !== null ? <>
        <GrowBar value={now ? value(now) : 0} max={goal} className="mt-2 h-1.5" fill={share !== null && share >= 100 ? "bg-[var(--type-round)]" : "bg-primary"} />
        <p className={cn("mt-1 text-xs tabular-nums", share !== null && share >= 100 ? indicatorText("success") : "text-muted-foreground")}>{share} % av målet</p>
      </> : null}
    </section>
    {/* Nothing invoiced in six months: one calm line instead of an empty chart. */}
    {invoiced.months.every((month) => value(month) === 0) ? <div className="mt-4"><Calm text="Inga fakturerade underlag de senaste sex månaderna" /></div> : <>
    <div className="relative mt-6 flex h-36 items-end gap-3" aria-hidden="true">
      {goal !== null ? <span className="absolute inset-x-0 z-10 border-t border-dashed border-foreground/40" style={{ bottom: `${(goal / max) * 100}%` }}>
        <span className="absolute -top-4 right-0 bg-card px-1 text-[10.5px] text-muted-foreground">Mål {tkr(goal)}</span>
      </span> : null}
      {invoiced.months.map((month, index) => <div key={month.key} className="group relative flex h-full flex-1 items-end">
        <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lg group-hover:block">{month.label}: {show(value(month))}</span>
        <div className={cn("relative w-full rounded-t-[4px] [height:var(--h)] transition-[height] duration-700 ease-out motion-reduce:transition-none starting:[height:0]", index === last ? "bg-primary" : "bg-[color-mix(in_srgb,var(--primary)_35%,var(--card))]")} style={{ "--h": `${(value(month) / max) * 100}%` } as CSSProperties} />
      </div>)}
    </div>
    <div className="mt-1 flex gap-3" aria-hidden="true">
      {invoiced.months.map((month, index) => <span key={month.key} className={cn("flex-1 text-center text-[11px]", index === last ? "font-semibold text-primary" : "text-muted-foreground")}>{month.label}</span>)}
    </div>
    </>}
    <p className="mt-3 text-[11px] text-muted-foreground">Fakturerade underlag{prices ? ", exkl. moms" : ", antal"}{invoiced.partial ? " (de senaste 3 000)" : ""}.{goal === null && prices ? " Målet anges under Inställningar → Arbetssätt." : ""}</p>
    <SrTable caption={`Fakturerat per månad${goal !== null ? `, mål ${kr(goal)}` : ""}`} head={["Månad", prices ? "Kronor exkl. moms" : "Antal underlag"]} rows={invoiced.months.map((month) => [monthShort(month.key), value(month)])} />
  </Box>;
}

/** AI-krediter: the usable balance (expired lots left out at once), what they are and how long they are valid. */
function Credits({ data, className }: { data: EconomyTabData; className?: string }) {
  const credits = data.credits;
  if (!credits) return null;
  const lines = creditSummaryLines(credits);
  return <Box className={className} title="AI-krediter" area="admin" icon={Sparkles}>
    <Figure label="Saldo" value={String(credits.balance)} unit="krediter" note={lines.split || (credits.balance ? undefined : "Inga krediter kvar")} />
    {lines.validity ? <p className="mt-2 text-sm font-medium" data-testid="economy-credit-validity">{lines.validity}</p> : null}
    {credits.testMode ? <p className="mt-1 text-xs text-muted-foreground">Testläge – inga köpta krediter.</p> : null}
    {credits.expiredPending ? <p className="mt-1 text-xs text-muted-foreground">{credits.expiredPending} krediter har gått ut och räknas inte.</p> : null}
  </Box>;
}

/** Ekonomi: `data` from loadEconomyTab (null while it is read: a skeleton of the tab's shape); `onChanged` reads it again. */
export function EconomyTab({ data, level, onChanged }: { data: EconomyTabData | null; level: Level; /** A basis was made or changed from here: read the tab again. */ onChanged?: () => void }) {
  const [target, setTarget] = useState<InvoiceBasisTarget | null>(null);
  if (!data) return <TabSkeleton label="Hämtar ekonomi…" heights={ROWS_SKELETON} testId="overview-economy-loading" />;
  if (!data.cloud) return <div data-testid="overview-economy"><Halves>
    <Box key="local" title="Ekonomi" area="quote" icon={Receipt}>
      <EmptyNote icon={Receipt} title="Fakturaunderlag och offerter finns med serverlagring" text={data.credits ? "I en lokal arbetsyta visas bara AI-krediterna här." : "I en lokal arbetsyta visas ingen ekonomi."} />
    </Box>
    {data.credits ? <Credits key="credits" data={data} /> : null}
  </Halves></div>;
  return <div className={cn("grid", BOX_GAP)} data-testid="overview-economy">
    <EconomyHeadline data={data} />
    {/* Half and half, each column a stack; the money first: Att fakturera and Fakturerat per månad on the left (2026-11-02). */}
    <Columns testId="economy-row-1"
      left={<>
        {data.unbilled ? <Billing key="billing" data={data} level={level} onCreate={(row) => setTarget({ proposal: row.kind === "task" ? { taskId: row.id } : { projectId: row.id } })} /> : null}
        {data.invoiced ? <Invoiced key="invoiced" data={data} /> : null}
      </>}
      right={<>
        {data.quotes ? <Quotes key="quotes" data={data} level={level} /> : null}
        {data.credits ? <Credits key="credits" data={data} /> : null}
      </>} />
    {/* Skapa underlag: the existing proposal (nothing is saved until Skapa underlaget; the sources it takes are checked again). */}
    <InvoiceBasisModal target={target} open={Boolean(target)} onClose={() => setTarget(null)} onChanged={() => onChanged?.()} />
  </div>;
}
