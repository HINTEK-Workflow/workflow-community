"use client";
import { useCallback, useId, useState } from "react";
import { Pencil, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, Panel, RowsSkeleton } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useLoadEffect } from "@/lib/use-load-effect";
import { ALARM_HOURS, ALARM_HOURS_LABELS, ESCALATION_MINUTES_MAX, ESCALATION_MINUTES_MIN, type AlarmHours } from "@/lib/machine/alarm-escalation";

/**
 * Integrationsmotorn E6 (beslut 2026-10-18: "Ansvarig och ersättare per objekt får larm med kvittens och eskalering"):
 * Larmansvar under Kopplingar → Maskiner. Företagets val – när e-post och push får gå ut (dagtid som förval, dygnet runt
 * bara när en administratör väljer det) och minuter per steg – och ansvarig och ersättare per objekt som källor eller
 * signaler är kopplade till. Ändringarna styr vem som larmas, så servern kräver bekräftelse inom 15 minuter; den gemensamma
 * bekräftelsedialogen frågar och ändringen görs om. Redigeras i raden, aldrig i ett fönster över sidan.
 */
type Person = { userId: string; name: string };
type Contact = { userId: string; name: string | null } | null;
type ObjectRow = { id: string; name: string; isActive: boolean; customerName: string; customerDeleted: boolean; responsible: Contact; deputy: Contact; summary: string };
type Data = { settings: { hours: AlarmHours; escalationMinutes: number }; people: Person[]; objects: ObjectRow[]; safety: string };

export function MachineAlarmSection({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ hours: AlarmHours; minutes: string } | null>(null);
  const prefix = useId();
  const load = useCallback(async () => {
    try { setData(await api<Data>("/api/machine-sources?alarms=1", { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(load);
  const send = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { await api("/api/machine-sources", { method: "POST", body: JSON.stringify(payload) }); notify(done); await load(); return true; }
    catch (cause) { notify((cause as Error).message, true); return false; } finally { setBusy(false); }
  };
  const settings = data?.settings;
  const current = draft ?? (settings ? { hours: settings.hours, minutes: String(settings.escalationMinutes) } : null);
  const changed = Boolean(settings && current && (current.hours !== settings.hours || Number(current.minutes) !== settings.escalationMinutes));
  const saveSettings = async () => {
    if (!current) return;
    if (await send({ action: "set_alarm_settings", hours: current.hours, escalationMinutes: Math.round(Number(current.minutes.replace(",", "."))) }, "Larmnotiserna är sparade.")) setDraft(null);
  };
  const label = "field-label text-xs font-medium";
  // Ett eget kort (2026-11-12) under källornas kort, not a part inside the Maskiner card.
  return <div data-testid="machine-alarm-section"><Panel icon={ShieldAlert} title="Larmansvar" description="Vem som får ett maskinlarm först, och när larmet går vidare om ingen kvitterar med Jag tar den.">
    <div className="space-y-3">
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : !data || !current ? <RowsSkeleton rows={2} dense label="Hämtar larmansvaret…" /> : <>
      <form className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }} data-testid="machine-alarm-settings">
        <div className="grid gap-1.5"><label htmlFor={`${prefix}-hours`} className={label}>E-post och push för maskinlarm</label>
          <select id={`${prefix}-hours`} className="form-select" value={current.hours} disabled={busy} onChange={(event) => setDraft({ ...current, hours: event.target.value as AlarmHours })} data-testid="machine-alarm-hours">
            {ALARM_HOURS.map((hours) => <option key={hours} value={hours}>{ALARM_HOURS_LABELS[hours]}</option>)}
          </select></div>
        <div className="grid gap-1.5"><label htmlFor={`${prefix}-minutes`} className={label}>Minuter per steg</label>
          <Input id={`${prefix}-minutes`} inputMode="numeric" value={current.minutes} disabled={busy} onChange={(event) => setDraft({ ...current, minutes: event.target.value })} data-testid="machine-alarm-minutes" /></div>
        <Button type="submit" size="sm" disabled={busy || !changed} data-testid="machine-alarm-settings-save">Spara</Button>
        <p className="text-xs text-muted-foreground sm:col-span-3">{`Klockan i appen visar alltid larmet. Dygnet runt gäller bara den som själv sagt ja under Mina inställningar → Notiser. ${ESCALATION_MINUTES_MIN}–${ESCALATION_MINUTES_MAX} minuter.`}</p>
      </form>
      {!data.objects.length ? <Empty compact title="Ingen källa är kopplad till en maskindel än" description="Koppla en källa eller en signal till en maskindel först. Utan larmansvar får alla som får maskinlarm larmet direkt." />
        : <ul className="divide-y rounded-lg border" aria-label="Larmansvar per maskindel">{data.objects.map((object) => <li key={object.id} className="p-3 text-sm" data-testid="machine-alarm-object">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <p className="flex flex-wrap items-center gap-2 font-medium">{object.name}<span className="font-normal text-muted-foreground">· {object.customerName}</span>
                {!object.isActive ? <Badge variant="outline" className={indicatorBadge("neutral")}>Pausad</Badge> : null}</p>
              <p className="mt-0.5 text-xs text-muted-foreground" data-testid="machine-alarm-summary">{object.summary}</p>
              {(object.responsible && !object.responsible.name) || (object.deputy && !object.deputy.name)
                ? <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300" data-testid="machine-alarm-missing">En vald person får inte längre läsa arbetsordrar och hoppas över.</p> : null}
            </div>
            {editing !== object.id ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(object.id)} data-testid="machine-alarm-edit"><Pencil />Ändra</Button> : null}
          </div>
          {editing === object.id ? <ContactEditor object={object} people={data.people} busy={busy} onCancel={() => setEditing(null)}
            onSave={async (responsibleUserId, deputyUserId) => { if (await send({ action: "set_alarm_contacts", partId: object.id, responsibleUserId, deputyUserId }, "Larmansvaret är sparat.")) setEditing(null); }} /> : null}
        </li>)}</ul>}
      <p className="text-xs text-muted-foreground" data-testid="machine-alarm-safety">{data.safety}</p>
    </>}
    </div>
  </Panel></div>;
}

function ContactEditor({ object, people, busy, onCancel, onSave }: { object: ObjectRow; people: Person[]; busy: boolean; onCancel: () => void; onSave: (responsible: string | null, deputy: string | null) => Promise<void> }) {
  const [responsible, setResponsible] = useState(object.responsible?.name ? object.responsible.userId : "");
  const [deputy, setDeputy] = useState(object.deputy?.name ? object.deputy.userId : "");
  const prefix = useId();
  const label = "field-label text-xs font-medium";
  const same = Boolean(responsible) && responsible === deputy;
  return <form className="mt-2 grid gap-3 rounded-lg border p-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void onSave(responsible || null, deputy || null); }} data-testid="machine-alarm-editor">
    <div className="grid gap-1.5"><label htmlFor={`${prefix}-responsible`} className={label}>Ansvarig (får larmet först)</label>
      <select id={`${prefix}-responsible`} className="form-select" value={responsible} onChange={(event) => setResponsible(event.target.value)} data-testid="machine-alarm-responsible">
        <option value="">Ingen</option>{people.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
      </select></div>
    <div className="grid gap-1.5"><label htmlFor={`${prefix}-deputy`} className={label}>Ersättare (om ingen kvitterat)</label>
      <select id={`${prefix}-deputy`} className="form-select" value={deputy} onChange={(event) => setDeputy(event.target.value)} data-testid="machine-alarm-deputy">
        <option value="">Ingen</option>{people.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
      </select></div>
    {same ? <p role="alert" className="text-xs text-destructive sm:col-span-2">Ansvarig och ersättare ska vara två olika personer.</p> : null}
    <p className="text-xs text-muted-foreground sm:col-span-2">Bara medlemmar som får läsa arbetsordrar. E-post och push följer personens egna val under Mina inställningar → Notiser.</p>
    <div className="flex flex-wrap gap-2 sm:col-span-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>Avbryt</Button>
      <Button type="submit" size="sm" disabled={busy || same} data-testid="machine-alarm-save" busy={busy} busyLabel="Sparar…">Spara</Button>
    </div>
  </form>;
}
