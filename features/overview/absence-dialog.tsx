"use client";

import { plural } from "@/lib/plural";
import { useState } from "react";
import { CalendarClock, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { DialogActions, Field, Modal } from "@/features/kfid/ui";
import { ABSENCE_LABELS, ABSENCE_TYPES, AFTERNOON, MORNING, type AbsenceHours, type AbsenceType } from "@/lib/workflow/absence";
import { shortDay } from "@/lib/workflow/my-day";
import { announce } from "@/lib/workflow/toast";
import type { TeamAffectedRow } from "@/lib/overview/team-server";

/**
 * Frånvaro (2026-10-29): the shared dialogs of Jag and Teamet. "Anmäl frånvaro" – the person, the type (an own reason
 * with its text), from–to and half a day; everyone for themselves, the Teamet right for anyone (the server decides again).
 * "Hantera" for work an absence touches – who could take it over, Skjut upp to the first day back, or Låt vänta. Nothing is
 * moved without a choice here.
 */
export type AbsenceDraft = { id?: string; userId: string; type: AbsenceType; note: string; from: string; to: string; hours: AbsenceHours | null;
  /** An absence imported from a payroll or HR system that is locked here: the line that says where it is changed. */
  locked?: string;
  /** Registered by someone else (a manager): Ta bort asks first, and they are told (användartest 2026-10-31, F7). */
  byOther?: boolean };

/** Del av dagen: förmiddag and eftermiddag fill in their hours, which can be changed; Egna tider starts from the morning. */
const PART_LABELS: Record<string, string> = { day: "Hela dagen", morning: "Förmiddag", afternoon: "Eftermiddag", own: "Egna tider" };
const partOf = (hours: AbsenceHours | null) => !hours ? "day" : hours.start === MORNING.start && hours.end === MORNING.end ? "morning" : hours.start === AFTERNOON.start && hours.end === AFTERNOON.end ? "afternoon" : "own";
const hours = (minutes: number) => `${(Math.round(minutes / 6) / 10).toLocaleString("sv-SE")} h`;

export function AbsenceDialog({ open, onOpenChange, draft, people, onSaved, quick }: {
  open: boolean; onOpenChange: (open: boolean) => void; draft: AbsenceDraft;
  /** Today and tomorrow (YYYY-MM-DD): Sjuk i dag / Sjuk i morgon on top of a new absence, so everything is in this one window. */
  quick?: { today: string; tomorrow: string };
  /** The people the viewer may register for (only themselves without the Teamet right). */
  people: readonly { id: string; name: string }[];
  onSaved: () => void;
}) {
  const [value, setValue] = useState<AbsenceDraft>(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  // A new absence from the quick choices is saved only after a choice (resa 2026-11-06: Sjuk i dag stood chosen and one tap on Spara
  // reported the person sick). Nothing is pressed until the person presses it.
  const [chosen, setChosen] = useState(!quick || Boolean(draft.id));
  const set = (patch: Partial<AbsenceDraft>) => { setChosen(true); setValue((current) => {
    const next = { ...current, ...patch };
    if (next.to < next.from) next.to = next.from;
    if (next.from !== next.to) next.hours = null;
    return next;
  }); };
  async function save() {
    setBusy(true); setError("");
    try {
      const result = await api<{ affected?: number }>("/api/absence", { method: "POST", body: JSON.stringify({ action: "save", absence: value }) });
      announce(result.affected ? `Frånvaron är sparad. ${plural(result.affected, "planerad arbetsorder", "planerade arbetsordrar")} behöver planeras om.` : "Frånvaron är sparad.");
      onOpenChange(false); onSaved();
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!value.id) return;
    // Someone else registered it: first a question in the window itself (no browser dialog), then the removal with the yes.
    if (value.byOther && !confirming) { setConfirming(true); return; }
    setBusy(true); setError("");
    try { await api("/api/absence", { method: "POST", body: JSON.stringify({ action: "delete", id: value.id, ...(value.byOther ? { confirm: true } : {}) }) }); announce("Frånvaron är borttagen."); onOpenChange(false); onSaved(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  // Imported and locked (frånvaro och lön, 2026-10-29): shown, not changed – the master system owns it.
  if (value.locked) return <Modal open={open} onOpenChange={onOpenChange} title="Frånvaro" size="compact" nativeScreen>
    <div className="grid gap-3" data-testid="absence-locked">
      <p className="text-sm">{ABSENCE_LABELS[value.type]}{value.type === "OTHER" && value.note ? `: ${value.note}` : ""} · {value.from === value.to ? value.from : `${value.from} – ${value.to}`}{value.hours ? ` ${value.hours.start}–${value.hours.end}` : ""}</p>
      <p className="text-xs text-muted-foreground">{value.locked}</p>
      <DialogActions cancel={{ label: "Stäng", onClick: () => onOpenChange(false) }} />
    </div>
  </Modal>;
  return <Modal open={open} onOpenChange={onOpenChange} title={value.id ? "Ändra frånvaro" : "Anmäl frånvaro"} size="compact" nativeScreen>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); if (chosen) void save(); }} data-testid="absence-dialog">
      {quick && !value.id ? <div className="flex flex-wrap gap-2" role="group" aria-label="Snabbval">
        {([["Sjuk i dag", quick.today, "absence-quick-today"], ["Sjuk i morgon", quick.tomorrow, "absence-quick-tomorrow"]] as const).map(([label, day, testId]) => {
          const on = chosen && value.type === "SICK" && value.from === day && value.to === day && !value.hours;
          return <Button key={testId} type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => set({ type: "SICK", from: day, to: day, hours: null })} data-testid={testId}>{label}</Button>;
        })}
      </div> : null}
      {people.length > 1 ? <Field id="absence-person" label="Person" value={value.userId} onChange={(userId) => set({ userId })}
        options={people.map((person) => person.id)} optionLabels={Object.fromEntries(people.map((person) => [person.id, person.name]))} /> : null}
      {/* Nothing looks chosen before it is (kundresa 2026-11-07, M30: Sjuk stood filled in while Spara was grey). */}
      <Field id="absence-type" label="Orsak" value={chosen ? value.type : ""} onChange={(type) => set({ type: type as AbsenceType })} options={[...ABSENCE_TYPES]} optionLabels={ABSENCE_LABELS} />
      {value.type === "OTHER" ? <Field id="absence-note" label="Skriv orsaken" value={value.note} onChange={(note) => set({ note })} placeholder="Till exempel flytt" required /> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field id="absence-from" label="Från" type="date" value={value.from} onChange={(from) => set({ from })} required />
        <Field id="absence-to" label="Till och med" type="date" value={value.to} onChange={(to) => set({ to })} required />
      </div>
      {value.from === value.to ? <Field id="absence-part" label="Del av dagen" value={partOf(value.hours)}
        onChange={(part) => set({ hours: part === "day" ? null : part === "morning" ? MORNING : part === "afternoon" ? AFTERNOON : { start: "10:00", end: "12:00" } })}
        options={["day", "morning", "afternoon", "own"]} optionLabels={PART_LABELS} /> : null}
      {value.hours ? <div className="grid grid-cols-2 gap-3">
        <Field id="absence-start" label="Från klockan" type="time" value={value.hours.start} onChange={(start) => set({ hours: { ...value.hours!, start } })} required />
        <Field id="absence-end" label="Till klockan" type="time" value={value.hours.end} onChange={(end) => set({ hours: { ...value.hours!, end } })} required />
      </div> : null}
      {/* K2 (användartest 2026-10-31): the supervisor sees the reason, colleagues do not. */}
      <p className="text-xs text-muted-foreground">Arbetsledare och admin ser orsaken. Kollegor som ser teamets planering ser bara att du är borta.</p>
      {confirming ? <div className="notice grid gap-2" role="alert" data-testid="absence-delete-confirm">
        <p className="text-sm">Frånvaron lades in av din arbetsledare. Tar du bort den får arbetsledaren en notis.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void remove()} data-testid="absence-delete-confirm-yes">Ta bort ändå</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Behåll</Button>
        </div>
      </div> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogActions cancel={{ onClick: () => onOpenChange(false) }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…", testId: "absence-save", disabledReason: chosen ? null : "Välj en orsak, eller Sjuk i dag eller Sjuk i morgon." }}>
        {value.id ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()} data-testid="absence-delete">Ta bort</Button> : null}
      </DialogActions>
    </form>
  </Modal>;
}

/** Hantera: the work an absence touches – take it over, move it to the first day back, or leave it. */
export function HandleAbsenceDialog({ row, onOpenChange, onDone }: { row: TeamAffectedRow | null; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function choose(choice: "reassign" | "postpone" | "wait", toUserId?: string) {
    if (!row) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ message?: string }>("/api/absence", { method: "POST", body: JSON.stringify({ action: "handle", key: row.key, choice, toUserId }) });
      announce(result.message ?? "Klart.");
      onOpenChange(false); onDone();
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal open={Boolean(row)} onOpenChange={onOpenChange} title="Planera om" size="compact" nativeScreen>
    {row ? <div className="grid gap-4" data-testid="absence-handle">
      <div>
        <p className="text-sm font-semibold">{row.title}</p>
        <p className="text-xs text-muted-foreground">{row.personName} · {row.label} · {row.kind === "booking" ? "bokad" : "klart senast"} {shortDay(row.day)}</p>
      </div>
      <section aria-label="Byt person" className="grid gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Byt person</h3>
        {row.suggestions.length ? row.suggestions.map((person) => <Button key={person.id} type="button" variant="outline" className="justify-between" disabled={busy}
          onClick={() => void choose("reassign", person.id)} data-testid="absence-reassign">
          <span className="flex items-center gap-2"><UserRoundCheck aria-hidden="true" />{person.name}</span>
          <span className="text-xs text-muted-foreground">{person.freeMinutes ? `${hours(person.freeMinutes)} ledig` : "fullbokad"}</span>
        </Button>) : <p className="text-sm text-muted-foreground">Ingen annan med rätt behörighet har tid den dagen.</p>}
      </section>
      <Button type="button" variant="outline" className="justify-start" disabled={busy} onClick={() => void choose("postpone")} data-testid="absence-postpone">
        <CalendarClock aria-hidden="true" />Skjut upp till {shortDay(row.backOn)}
      </Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogActions cancel={{ label: "Avbryt", onClick: () => onOpenChange(false) }}>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void choose("wait")} data-testid="absence-wait">Låt vänta</Button>
      </DialogActions>
    </div> : null}
  </Modal>;
}
