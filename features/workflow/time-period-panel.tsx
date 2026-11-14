"use client";

import { useState } from "react";
import { BellRing, CalendarCheck, Check, ChevronLeft, ChevronRight, RotateCcw, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { IconButton } from "@/components/ui/icon-button";
import { ListEmpty, ListGroup, ListRow, NativeActions } from "@/components/native";
import { api } from "@/features/kfid/api";
import { useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { useConfirm } from "@/features/kfid/confirm";
import { DialogActions, Field, Modal, Panel } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { cn } from "@/lib/utils";
import { announce } from "@/lib/workflow/toast";
import { addPeriods, submitWarning, TIME_PERIOD_LABELS, TIME_PERIOD_NOTE_MAX, TIME_PERIOD_TONES, type MonthGap, type TimePeriodAction, type TimePeriodView } from "@/lib/workflow/time-periods";

/**
 * Månadens tid (2026-10-30): the person sends in their month, an approver (admin or the Teamet right) approves it or
 * sends it back with a note, and may open an approved month again. The rules and the lock are the server's
 * (lib/workflow/time-periods-server.ts); the demo answers the same (features/demo/demo-time-periods.ts). Cloud only: the Local
 * edition has one user and no approval, so Tid does not show this there.
 * `part`: "mine" (my month and Skicka in, on Min tid) or "team" (one row per person and month with Godkänn and Påminn, on Teamet;
 * beslut 13, 2026-11-01). The table's columns follow the card's own width (container query), so it is rows of two lines at 390 px.
 */
type Person = { userId: string; name: string; status: TimePeriodView; note: string; hours: number; submittedAt: string | null; decidedAt: string | null; decidedBy: string | null; mine: boolean; canDecide: boolean; absenceDays: number; remindedToday: boolean };
type Answer = { period: string; label: string; current: string; me: Person & { running: boolean; selfApproves: boolean; gap: MonthGap | null }; canApprove: boolean; people: Person[] | null };
/** What can be done to a person's month; Påminn changes no status, so it is not one of the month's actions. */
type RowAction = TimePeriodAction | "remind";
type Asking = { person: Person; actions: RowAction[] };

const hours = (value: number) => `${value.toLocaleString("sv-SE", { maximumFractionDigits: 2 })} h`;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const pillOf = (status: TimePeriodView) => ({ label: TIME_PERIOD_LABELS[status], tone: TIME_PERIOD_TONES[status] });
const days = (value: number) => (value ? `${value.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} ${value === 1 ? "dag" : "dagar"}` : "–");
const ACTION_LABEL: Record<RowAction, string> = { submit: "Skicka in", approve: "Godkänn", return: "Skicka tillbaka", reopen: "Öppna igen", remind: "Påminn" };

function StatusPill({ status }: { status: TimePeriodView }) {
  return <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold", indicatorBadge(TIME_PERIOD_TONES[status]))} data-testid="time-period-status">{TIME_PERIOD_LABELS[status]}</span>;
}

/** What the person's own month says under the status. */
function ownLine(me: Answer["me"]) {
  if (me.status === "SUBMITTED") return "Väntar på godkännande.";
  if (me.status === "APPROVED") return me.decidedBy && !me.selfApproves ? `Godkänd av ${me.decidedBy}.` : "Godkänd.";
  if (me.status === "RETURNED") return me.note ? `Tillbakaskickad: ${me.note}` : "Tillbakaskickad. Rätta och skicka in igen.";
  if (me.note) return `Öppnad igen: ${me.note}`;
  return me.selfApproves ? "Godkänns direkt när du skickar in." : "Skicka in när månaden är klar.";
}
/** Why Skicka in cannot be used, or null. */
function submitBlock(data: Answer) {
  const me = data.me;
  if (me.status === "SUBMITTED" || me.status === "APPROVED") return "Månaden är redan inskickad.";
  if (data.period > data.current) return "Månaden har inte börjat.";
  if (me.running) return "Stoppa tiden som går först.";
  return null;
}

export function TimePeriodPanel({ native = false, part, onChanged }: { native?: boolean; part: "mine" | "team"; onChanged?: () => void }) {
  const [period, setPeriod] = useState<string | null>(null);
  const key = `/api/time-periods${period ? `?period=${period}` : ""}`;
  const read = useWorkspaceData<Answer>(key, (signal) => api<Answer>(key, { signal }), { keepPrevious: true });
  const data = read.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState<Asking | null>(null);
  const [note, setNote] = useState("");
  const [confirm, confirmElement] = useConfirm();
  // Nothing until the month is read; a refusal (no Cloud, no access) shows nothing either.
  if (!data) return null;
  const showMine = part === "mine";
  const showTeam = part === "team" && data.canApprove && data.people;
  if (!showMine && !showTeam) return null;

  async function act(action: RowAction, person: Person | null, text = "") {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>("/api/time-periods", { method: "POST", body: JSON.stringify({ action, period: data!.period, ...(person && !person.mine ? { userId: person.userId } : {}), note: text }) });
      announce(result.message);
      setAsking(null); setNote("");
      await read.reload();
      onChanged?.();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Det gick inte att spara."); return false; }
    finally { setBusy(false); }
  }
  // PL8: before Skicka in, what is missing – in one sentence, and the person decides.
  async function submit() {
    const warning = submitWarning(data!.me.hours, data!.me.gap);
    if (warning && !(await confirm({ title: `Skicka in ${data!.label}?`, message: warning, confirmLabel: "Skicka ändå" }))) return;
    await act("submit", null);
  }
  const ask = (person: Person, actions: RowAction[]) => { setError(""); setNote(""); setAsking({ person, actions }); };
  // Påminn: a month not sent in, not one's own, not one that has not begun. The server checks the same.
  const remindable = (person: Person) => data!.canApprove && !person.mine && data!.period <= data!.current && (person.status === "OPEN" || person.status === "RETURNED");
  const choices = (person: Person): RowAction[] => remindable(person) ? (person.remindedToday ? [] : ["remind"]) : !person.canDecide ? [] : person.status === "SUBMITTED" ? ["approve", "return"] : person.status === "APPROVED" ? ["reopen"] : [];
  const blocked = submitBlock(data);
  const move = (step: number) => setPeriod(addPeriods(data.period, step));
  const atCurrent = data.period >= data.current;
  const errorLine = error && !asking ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{error}</p> : null;

  // Skicka tillbaka and Öppna igen need a note; on the phone a row opens the same box with Godkänn too.
  const needsNote = asking ? asking.actions.some((action) => action === "return" || action === "reopen") : false;
  const primary = asking?.actions[0];
  const secondary = asking?.actions[1];
  const dialog = <Modal open={Boolean(asking)} onOpenChange={(open) => { if (!open) setAsking(null); }} title={asking ? `${asking.person.name}, ${data.label}` : ""} size="compact">
    {asking ? <div className="space-y-3" data-testid="time-period-dialog">
      <p className="flex items-center gap-2 text-sm"><StatusPill status={asking.person.status} /><span>{hours(asking.person.hours)}</span>{asking.person.absenceDays ? <span className="text-muted-foreground">Frånvaro {days(asking.person.absenceDays)}</span> : null}</p>
      {needsNote ? <Field id="time-period-note" label={primary === "reopen" ? "Varför öppnas månaden?" : secondary === "return" ? "Kommentar (krävs för Skicka tillbaka)" : "Varför skickas tiden tillbaka?"} value={note} onChange={(value) => setNote(value.slice(0, TIME_PERIOD_NOTE_MAX))} multiline /> : null}
      {error ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{error}</p> : null}
      <DialogActions cancel={{ onClick: () => setAsking(null) }}
        primary={primary ? { label: ACTION_LABEL[primary], busy, disabled: busy, testId: `time-period-${primary}`, disabledReason: (primary === "return" || primary === "reopen") && !note.trim() ? "Skriv en kommentar först." : null, onClick: () => void act(primary, asking.person, note) } : null}>
        {secondary ? <Button type="button" variant="outline" disabled={busy} disabledReason={!note.trim() ? "Skriv en kommentar först." : null} onClick={() => void act(secondary, asking.person, note)} data-testid={`time-period-${secondary}`}><Undo2 />{ACTION_LABEL[secondary]}</Button> : null}
      </DialogActions>
    </div> : null}
  </Modal>;

  const monthButtons = <>
    <IconButton label="Föregående månad" variant="outline" onClick={() => move(-1)}><ChevronLeft /></IconButton>
    <IconButton label="Nästa månad" variant="outline" disabled={atCurrent} onClick={() => move(1)}><ChevronRight /></IconButton>
  </>;
  // Påminn is one a day: the button stays, with the reason in visible text beside it.
  const remindButton = (person: Person) => <>
    <Button type="button" size="sm" variant="outline" disabled={busy} disabledReason={person.remindedToday ? "Påmind i dag." : null} aria-describedby={person.remindedToday ? `time-reminded-${person.userId}` : undefined} onClick={() => void act("remind", person)} data-testid="time-period-remind"><BellRing />Påminn</Button>
    <DisabledReason id={`time-reminded-${person.userId}`} reason={person.remindedToday ? "Påmind i dag." : null} />
  </>;
  if (native) return <>
    <ListGroup title="Månadens tid" testId="native-time-period">
      <ListRow twoLines title={capital(data.label)} subtitle={showMine ? ownLine(data.me) : undefined} pill={showMine ? pillOf(data.me.status) : null} value={showMine ? hours(data.me.hours) : undefined} chevron={false} accessory={monthButtons} />
    </ListGroup>
    {showMine ? <>
      {data.me.status === "OPEN" || data.me.status === "RETURNED" ? <NativeActions footer={blocked ?? undefined}>
        <Button type="button" disabled={busy} disabledReason={blocked} onClick={() => void submit()} data-testid="time-period-submit"><Send />Skicka in {data.label}</Button>
      </NativeActions> : null}
    </> : null}
    {showTeam ? <ListGroup title={`Godkänna tid · ${data.label}`} testId="native-time-period-team" alignPills>
      {data.people!.length ? data.people!.map((person) => {
        const actions = choices(person);
        const subtitle = [hours(person.hours), person.absenceDays ? `frånvaro ${days(person.absenceDays)}` : "", person.remindedToday && remindable(person) ? "påmind i dag" : ""].filter(Boolean).join(" · ");
        return <ListRow key={person.userId} title={person.name} subtitle={subtitle} pill={pillOf(person.status)} onClick={actions.length ? () => ask(person, actions) : undefined} testId={`time-period-person-${person.userId}`} />;
      }) : <ListEmpty>Inga medarbetare.</ListEmpty>}
    </ListGroup> : null}
    {errorLine ? <div className="px-4">{errorLine}</div> : null}
    {dialog}
    {confirmElement}
  </>;

  if (showTeam) return <Panel icon={CalendarCheck} title={`Godkänn tid · ${data.label}`} actions={<div className="flex items-center gap-1.5">{monthButtons}</div>}>
    <div className="space-y-3" data-testid="time-period-team" aria-busy={read.fetching || undefined}>
      {errorLine}
      {/* The shared table, edge to edge in its card; from a wide card one row per person, in a narrow one (a phone) each row on three lines. */}
      {data.people!.length ? <div className="-mx-4 -mb-4 @container"><table className="data-table block @3xl:table" data-testid="time-period-table">
        <colgroup><col /><col className="w-24" /><col className="w-24" /><col className="w-36" /><col className="w-72" /></colgroup>
        <thead className="hidden @3xl:table-header-group">
          <tr>
            <th scope="col">Person</th>
            <th scope="col" className="text-right">Timmar</th>
            <th scope="col" className="text-right">Frånvaro</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="sr-only">Åtgärder</span></th>
          </tr>
        </thead>
        <tbody className="block @3xl:table-row-group">
          {data.people!.map((person) => <tr key={person.userId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5 last:border-b-0 @3xl:table-row @3xl:p-0" data-testid={`time-period-person-${person.userId}`}>
            <td className="min-w-0 truncate font-medium @max-3xl:border-0 @max-3xl:p-0">{person.name}</td>
            <td className="hidden text-right text-muted-foreground @3xl:table-cell" data-testid="time-period-hours">{hours(person.hours)}</td>
            <td className="hidden text-right text-muted-foreground @3xl:table-cell" data-testid="time-period-absence">{days(person.absenceDays)}</td>
            <td className="justify-self-end @max-3xl:border-0 @max-3xl:p-0"><StatusPill status={person.status} /></td>
            <td className="col-span-2 text-muted-foreground @max-3xl:border-0 @max-3xl:p-0 @3xl:hidden">{hours(person.hours)} · Frånvaro {days(person.absenceDays)}</td>
            <td className="col-span-2 @max-3xl:border-0 @max-3xl:p-0"><span className="flex flex-wrap items-center gap-1.5 @3xl:justify-end">
              {person.canDecide && person.status === "SUBMITTED" ? <>
                <Button type="button" size="sm" disabled={busy} onClick={() => void act("approve", person)} data-testid="time-period-approve"><Check />Godkänn</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => ask(person, ["return"])} data-testid="time-period-return"><Undo2 />Skicka tillbaka</Button>
              </> : person.canDecide && person.status === "APPROVED"
                ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => ask(person, ["reopen"])} data-testid="time-period-reopen"><RotateCcw />Öppna igen</Button>
                : remindable(person) ? remindButton(person) : null}
            </span></td>
          </tr>)}
        </tbody>
      </table></div> : <p className="text-sm text-muted-foreground">Inga medarbetare.</p>}
    </div>
    {dialog}
  </Panel>;

  return <Panel icon={CalendarCheck} title="Månadens tid" description="Skicka in månaden när den är klar. Inskickad tid är låst."
    actions={<div className="flex items-center gap-1.5">{monthButtons}</div>}>
    <div className="space-y-4" data-testid="time-period-panel" aria-busy={read.fetching || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium"><span>{capital(data.label)}</span><span className="tabular-nums text-muted-foreground">{hours(data.me.hours)}</span><StatusPill status={data.me.status} /></p>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="time-period-line">{ownLine(data.me)}</p>
        </div>
        {data.me.status === "OPEN" || data.me.status === "RETURNED"
          ? <Button type="button" disabled={busy} disabledReason={blocked} onClick={() => void submit()} data-testid="time-period-submit"><Send />Skicka in</Button> : null}
      </div>
      {errorLine}
    </div>
    {confirmElement}
    {dialog}
  </Panel>;
}
