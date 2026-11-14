"use client";

import Link from "next/link";
import { CalendarClock, ChevronRight, FileText, History, ListChecks, Receipt, OctagonAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { indicatorText } from "@/features/workflow/indicator-tone";
import { BOX_GAP, Box, Columns, GrowBar, Pill, ROWS_SKELETON } from "@/features/overview/viz";
import { cn } from "@/lib/utils";
import { daysBetween, isoWeek } from "@/lib/workflow/schedule";
import {
  customerCommercial, customerFacts, customerProgress, customerState, customersSentence, lapsedText, quoteDaysText, actionTotal,
  type CustomerActionRow, type CustomerUpcomingRow,
} from "@/lib/overview/customers-model";
import type { CustomerRow, CustomersTabData } from "@/lib/overview/customers-server";
import { Calm, HeadlineCard, Progression, Row, RowList, rowLook } from "./rows";
import { MoreNote, TabSkeleton, day, kronor } from "./team-customers-parts";

/**
 * Översikt – Kunder (2026-10-28, 0.29.0; reworked 2026-10-29 with the same rows as Jag and Teamet): the situation at
 * the customers on top; Kräver åtgärd (late work orders and deviations, Behöver åtgärdas, quotes going out soon) beside
 * Närmaste veckan; then every customer with something going on – its state, how far the work has come and the money side –
 * each opening its customer page. A part the person may not read is not sent by the server (null) and is left out here;
 * nothing is invented.
 */

type Level = 2 | 3;
const LONG_MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const LONG_DAYS = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
const n = (value: number | null | undefined) => value ?? 0;

function CustomersHeadline({ data }: { data: CustomersTabData }) {
  const date = new Date(`${data.today}T12:00:00Z`);
  const name = LONG_DAYS[(date.getUTCDay() + 6) % 7];
  const { totals } = data;
  return <HeadlineCard label="Läget hos kunderna" testId="customers-headline" title="Läget hos kunderna"
    sentence={customersSentence({ totals, attentionCustomers: data.attentionCustomers })}
    kicker={`${name.charAt(0).toUpperCase()}${name.slice(1)} ${date.getUTCDate()} ${LONG_MONTHS[date.getUTCMonth()]} · vecka ${isoWeek(data.today)}`}
    chips={[
      { count: actionTotal(totals), label: "kräver åtgärd", href: "#kunder-atgard", icon: ListChecks, tone: "danger", testId: "customers-chip-action" },
      { count: n(totals.upcomingWorkOrders), label: "närmaste veckan", href: "#narmaste-veckan", icon: CalendarClock, tone: "info", testId: "customers-chip-upcoming" },
      { count: n(totals.quotesAwaiting), label: n(totals.quotesAwaiting) === 1 ? "offert väntar på svar" : "offerter väntar på svar", href: data.links.quotes, icon: FileText, tone: "neutral", testId: "customers-chip-quotes" },
      { count: n(totals.invoiceDrafts), label: "att fakturera", href: data.links.invoiceDrafts, icon: Receipt, tone: "success", testId: "customers-chip-invoices" },
    ]} />;
}

const openButton = (href: string, title: string, text: string) => <Button asChild size="sm" variant="outline"><Link href={href} aria-label={`${text} ${title}`}>{text}</Link></Button>;

/** One row of Kräver åtgärd, the same row as Teamet's (progression, the pill and the button in fixed columns). */
function ActionRow({ row, today, prices }: { row: CustomerActionRow; today: string; prices: boolean }) {
  if (row.reason === "quote") return <Row columns area="quote" icon={FileText}
    row={{ id: row.key, title: row.title, href: row.href, detail: [row.customerName, quoteDaysText(row.day, today), prices && typeof row.net === "number" ? `${kronor(row.net)} exkl. moms` : ""].filter(Boolean).join(" · ") }}
    pill={<Pill tone="warning" className="whitespace-nowrap">Går ut snart</Pill>} action={openButton(row.href, row.title, "Följ upp")} />;
  if (row.reason === "deviation") return <Row columns area="tools" icon={OctagonAlert}
    row={{ id: row.key, title: row.title, href: row.href, late: true, detail: [row.customerName, `Förfallen ${day(row.day)}`].join(" · ") }}
    meta={<Progression kind="DEVIATION" status={row.status} />} pill={<Pill tone="danger" className="whitespace-nowrap">Förfallen</Pill>}
    action={openButton(row.href, row.title, "Åtgärda")} />;
  const look = rowLook(row.round ? "ROUND" : "WORK_ORDER", row.id);
  const late = row.reason === "overdue";
  return <Row columns area={look.area} icon={look.icon}
    row={{ id: row.key, title: row.title, href: row.href, late, detail: [row.customerName, row.day ? `${late ? "Förfallen" : "Klart senast"} ${day(row.day)}` : ""].filter(Boolean).join(" · ") }}
    meta={<Progression kind="WORK_ORDER" status={row.status} progress={row.progress} />}
    pill={late ? <Pill tone="danger" className="whitespace-nowrap">Förfallen</Pill> : undefined}
    action={late ? undefined : openButton(row.href, row.title, "Åtgärda")} />;
}

/** Kräver åtgärd: one list, the most urgent first, counted like the tab's chip. */
function ActionList({ data, level }: { data: CustomersTabData; level: Level }) {
  const rows = data.action.rows.slice(0, level === 2 ? 5 : 8);
  const total = data.action.total;
  return <Box title="Kräver åtgärd" area="work-order" icon={ListChecks} anchor="kunder-atgard" className="h-full"
    action={total ? <span className="text-xs font-medium tabular-nums text-muted-foreground"><span className={cn("font-semibold", indicatorText("danger"))}>{total}</span> att åtgärda</span> : undefined}>
    {rows.length ? <>
      <RowList testId="customers-action">{rows.map((row) => <ActionRow key={row.key} row={row} today={data.today} prices={data.rights.prices} />)}</RowList>
      <MoreNote shown={rows.length} total={Math.max(total, rows.length)} />
    </> : <Calm text="Inget kräver åtgärd hos kunderna" />}
  </Box>;
}

/** "idag", "imorgon" or "2 nov". */
const whenText = (target: string, today: string) => { const days = daysBetween(today, target); return days <= 0 ? "idag" : days === 1 ? "imorgon" : day(target); };

/** Närmaste veckan: the work orders (rounds' included) that start or are due within the week, the soonest first. */
function Upcoming({ data, rows: all, level }: { data: CustomersTabData; rows: NonNullable<CustomersTabData["upcoming"]>; level: Level }) {
  const rows = all.rows.slice(0, level === 2 ? 5 : 8);
  return <Box title="Närmaste veckan" area="calendar" icon={CalendarClock} anchor="narmaste-veckan" className="h-full"
    action={all.total ? <span className="text-xs font-medium tabular-nums text-muted-foreground" data-testid="customers-upcoming-count"><span className="font-semibold text-foreground">{all.total}</span> inom 7 dagar</span> : undefined}>
    {rows.length ? <>
      {/* No pill column: the card is half wide beside Kräver åtgärd, so the day is said in the line (as Teamet's half-wide cards). */}
      <RowList testId="customers-upcoming">{rows.map((row: CustomerUpcomingRow) => { const look = rowLook(row.round ? "ROUND" : "WORK_ORDER", row.id); return <Row key={row.id} columns pillColumn={false} area={look.area} icon={look.icon}
        row={{ id: row.id, title: row.title, href: row.href, detail: [row.customerName, `${row.starts ? "Startar" : "Klart senast"} ${whenText(row.day, data.today)}`].filter(Boolean).join(" · ") }}
        meta={<Progression kind="WORK_ORDER" status={row.status} progress={row.progress} />} />; })}</RowList>
      <MoreNote shown={rows.length} total={all.total} />
    </> : <Calm text="Inget planerat hos kunderna den närmaste veckan" />}
  </Box>;
}

/**
 * A customer's progression (as Jag's rows): the state in a pill of a fixed width, then the work orders färdigställda the last
 * 30 days against those and the open ones as a line with "3 av 5 klara".
 */
function CustomerProgression({ row }: { row: CustomerRow }) {
  const state = customerState(row);
  const progress = customerProgress(row);
  if (!state && !progress) return null;
  return <>
    {state ? <Pill tone={state.tone} className="min-w-[5.5rem] shrink-0 justify-center">{state.label}</Pill> : null}
    {progress ? <>
      <GrowBar value={progress.done} max={progress.total} className="hidden h-1.5 min-w-8 max-w-28 grow basis-8 @[13rem]/meta:block" fill={progress.done >= progress.total ? "bg-[var(--type-round)]" : "bg-primary"} />
      <span className="shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums text-muted-foreground" title="Färdigställda arbetsordrar de senaste 30 dagarna, jämfört med de öppna">{progress.done} av {progress.total} klara</span>
    </> : null}
  </>;
}

/** Kunder: every customer with something going on, the most urgent first; each opens its customer page. */
function CustomerList({ data, level }: { data: CustomersTabData; level: Level }) {
  const rows = data.rows.slice(0, level === 2 ? 8 : 15);
  return <Box title="Kunder med något på gång" area="customer" icon={Users} anchor="kunder"
    action={<Button asChild size="sm" variant="ghost"><Link href={data.links.register}>Kundregistret<ChevronRight /></Link></Button>}>
    {rows.length ? <>
      <RowList testId="customers-rows">{rows.map((row) => {
        const facts = customerFacts(row);
        const money = customerCommercial(row);
        return <Row key={row.customerId} columns area="customer"
          row={{ id: row.customerId, title: row.name, href: row.href, late: facts.late, detail: [facts.text, row.place].filter(Boolean).join(" · ") }}
          meta={<CustomerProgression row={row} />}
          pill={money ? <Pill tone={money.tone} className="whitespace-nowrap">{money.label}</Pill> : undefined} />;
      })}</RowList>
      <MoreNote shown={rows.length} total={data.totals.customers} />
    </> : <Calm text="Ingen kund har öppet arbete, offerter eller underlag" />}
  </Box>;
}

/**
 * Länge sedan (2026-10-29): customers worked for before, where nothing has been färdigställt for 12 months and nothing
 * is open – "Senast där" and a button to the customer. A small card low on the tab; a calm line when there is none.
 */
function Lapsed({ data, today, level }: { data: NonNullable<CustomersTabData["lapsed"]>; today: string; level: Level }) {
  const rows = data.rows.slice(0, level === 2 ? 3 : 6);
  return <Box title="Länge sedan" area="customer" icon={History} anchor="lange-sedan"
    action={data.total ? <span className="text-xs font-medium tabular-nums text-muted-foreground" data-testid="customers-lapsed-count"><span className="font-semibold text-foreground">{data.total}</span> utan arbete på 12 månader</span> : undefined}>
    {rows.length ? <>
      <RowList testId="customers-lapsed">{rows.map((row) => <Row key={row.customerId} columns pillColumn={false} area="customer" icon={History}
        row={{ id: row.customerId, title: row.name, href: row.href, detail: [lapsedText(row.lastCompletedOn, today), row.place].filter(Boolean).join(" · ") }} />)}</RowList>
      <MoreNote shown={rows.length} total={data.total} />
    </> : <Calm text="Ingen kund har varit utan arbete i mer än 12 månader" />}
  </Box>;
}

export function CustomersTab({ data, level }: { data: CustomersTabData | null; level: Level }) {
  if (!data) return <TabSkeleton label="Hämtar Kunder…" heights={ROWS_SKELETON} testId="overview-customers-skeleton" />;
  return <div className={cn("grid", BOX_GAP)} data-testid="overview-customers">
    <CustomersHeadline data={data} />
    {/* Half and half, each column a stack (2026-11-02). */}
    <Columns testId="customers-row-1"
      left={<>
        <ActionList key="action" data={data} level={level} />
        <CustomerList key="customers" data={data} level={level} />
      </>}
      right={<>
        {data.upcoming ? <Upcoming key="upcoming" data={data} rows={data.upcoming} level={level} /> : null}
        {data.lapsed ? <Lapsed key="lapsed" data={data.lapsed} today={data.today} level={level} /> : null}
      </>} />
  </div>;
}
