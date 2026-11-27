"use client";

import { useState } from "react";
import { CalendarRange, Layers, Plus, Trash2, UserRoundPlus } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { ListEmpty, ListGroup, ListRow } from "@/components/native";
import { ListCard, ListCardGrid, ListFilterBar, RegisterRow, RegisterRows, useListPrefs } from "@/components/list-filter-bar";
import { PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { listSortOptions } from "@/lib/list-filter";
import { BackToList, useOpenRecord } from "./record-nav";
import { DialogPage } from "@/features/kfid/dialog-page";
import { useConfirm } from "@/features/kfid/confirm";
import { CheckField, DialogActions, Empty, Field } from "@/features/kfid/ui";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { useNativeTopBar } from "@/components/native";
import type { ExternalPersonView } from "@/lib/self-inspection/model";
import { LEVELS, toLevel, type Level } from "@/lib/self-inspection/levels";
import type { PartProps } from "./roles-page";
import { siDate, Tag } from "./shared";

/**
 * Inhyrd personal (2026-11-24): people from another company for a period, as a list and a quick form. Ingår i
 * programmet is off from the start: then the person is not in the programme, the tree or the appendices, and no level check or
 * read confirmation applies. On, the person is in during the period and the next approved version takes them; the switch is
 * turned off when the period has ended. A person may be linked to an account to get tasks. Only drawing; the backend decides.
 */
type Draft = { id?: string; name: string; companyName: string; companyOrgNumber: string; roleId: string; level: Level; competence: string; periodFrom: string; periodTo: string; included: boolean; userId: string };
const NEW: Draft = { name: "", companyName: "", companyOrgNumber: "", roleId: "", level: 1, competence: "", periodFrom: "", periodTo: "", included: false, userId: "" };
const draftOf = (person: ExternalPersonView): Draft => ({ id: person.id, name: person.name, companyName: person.companyName, companyOrgNumber: person.companyOrgNumber, roleId: person.roleId ?? "", level: toLevel(person.level),
  competence: person.competence, periodFrom: person.periodFrom ?? "", periodTo: person.periodTo ?? "", included: person.included, userId: person.userId ?? "" });
const payload = (draft: Draft) => ({ ...(draft.id ? { id: draft.id } : {}), name: draft.name, companyName: draft.companyName, companyOrgNumber: draft.companyOrgNumber, roleId: draft.roleId || null, level: draft.level,
  competence: draft.competence, periodFrom: draft.periodFrom || null, periodTo: draft.periodTo || null, included: draft.included, userId: draft.userId || null });
const period = (person: Pick<ExternalPersonView, "periodFrom" | "periodTo">) => person.periodFrom || person.periodTo ? `${person.periodFrom ? siDate(person.periodFrom) : "…"} – ${person.periodTo ? siDate(person.periodTo) : "tills vidare"}` : "Ingen period angiven";
type Filter = "all" | "in" | "out";
const EXTERNAL_SORTS = ["title", "due"] as const;
const EXTERNAL_SORT_OPTIONS = listSortOptions(EXTERNAL_SORTS);

export function ExternalPart({ view, busy, run }: PartProps) {
  const native = useNativeMode();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  useNativeTopBar(native ? { title: "Inhyrd personal", add: { label: "Ny inhyrd", onClick: () => setOpen({ ...NEW }), testId: "external-new" } } : null);
  const prefs = useListPrefs("self-inspection-external", view.me.id, { sorts: EXTERNAL_SORTS });
  const people = view.externalPeople ?? [];
  const [open, setOpen, closeOpen] = useOpenRecord<Draft>("hired", (id) => { const person = people.find((item) => item.id === id); return person ? draftOf(person) : null; });
  const needle = query.trim().toLocaleLowerCase("sv");
  const matches = (person: ExternalPersonView, value: Filter) => value === "all" || (value === "in") === person.inProgramme;
  const shown = people.filter((person) => matches(person, filter) && (!needle || `${person.name} ${person.companyName} ${person.roleName}`.toLocaleLowerCase("sv").includes(needle)))
    .sort((a, b) => prefs.sort === "due" ? (a.periodTo ?? "9999").localeCompare(b.periodTo ?? "9999") || a.name.localeCompare(b.name, "sv") : a.name.localeCompare(b.name, "sv"));
  const status = (person: ExternalPersonView) => person.ended ? "Perioden är slut" : person.inProgramme ? "Ingår" : person.included ? "Ingår från periodens start" : "Ingår inte";
  const subtitle = (person: ExternalPersonView) => [person.companyName, person.roleName, `Nivå ${person.level}`, status(person)].filter(Boolean).join(" · ");
  const chips = ([["all", "Alla"], ["in", "Ingår"], ["out", "Ingår inte"]] as const).map(([value, label]) => ({ value, label, count: people.filter((person) => matches(person, value)).length }));
  const filterBar = <ListFilterBar testId="external" label="Sök och sortera inhyrd personal" chips={{ label: "Visa", value: filter, onChange: setFilter, chips, testId: "external-filter" }}
    search={{ label: "Sök", placeholder: "Sök på namn, företag eller roll…", value: query, onChange: setQuery, testId: "external-search" }}
    sort={{ value: prefs.sort, options: EXTERNAL_SORT_OPTIONS, onChange: prefs.setSort }} view={{ value: prefs.view, onChange: prefs.setView }} />;
  const form = open ? <ExternalForm view={view} busy={busy} run={run} draft={open} onClose={closeOpen} /> : null;
  if (native) return <section className="space-y-3" data-testid="self-inspection-external">
    {form}
    {filterBar}
    <ListGroup title={`${shown.length} ${shown.length === 1 ? "person" : "personer"}`} testId="external-rows">{shown.length ? shown.map((person) => <ListRow key={person.id} type="customer" icon={UserRoundPlus} title={person.name} subtitle={subtitle(person)} value={period(person)} onClick={() => setOpen(draftOf(person))} testId="external-row"
      pill={{ label: person.inProgramme ? "Ingår" : "Ingår inte", tone: person.inProgramme ? "success" : "neutral" }} />) : <ListEmpty>Ingen inhyrd personal.</ListEmpty>}</ListGroup>
  </section>;
  const cards = prefs.view === "cards" && shown.length > 0;
  return <section data-testid="self-inspection-external" data-view={prefs.view}>
    <PageHeader title="Inhyrd personal" description="Personal från andra företag under en period. Reglaget Ingår i programmet avgör om personen är med i programmet." actions={<Button onClick={() => setOpen({ ...NEW })} data-testid="external-new"><Plus />Ny inhyrd</Button>} />
    {filterBar}
    {!shown.length ? <div className="mt-4 rounded-xl border bg-card p-4"><Empty title={needle || filter !== "all" ? "Ingen hittades" : "Ingen inhyrd personal"} description="Lägg till en person med Ny inhyrd." /></div>
      : cards ? <div className="mt-4"><ListCardGrid testId="external-cards">{shown.map((person) => <ListCard key={person.id} testId="external-row" onOpen={() => setOpen(draftOf(person))} icon={<AreaIcon area="customer" icon={UserRoundPlus} />}
        title={person.name} subtitle={[person.companyName, person.roleName].filter(Boolean).join(" · ") || undefined} badges={<Tag tone={person.inProgramme ? "primary" : person.ended ? "warning" : "neutral"}>{status(person)}</Tag>}
        facts={[{ icon: Layers, label: "Nivå", value: `Nivå ${person.level}` }, { icon: CalendarRange, label: "Uppdrag", value: period(person) }]} />)}</ListCardGrid></div>
      : <RegisterRows label={`Inhyrd personal, ${shown.length}`} testId="external-rows">{shown.map((person) => <RegisterRow key={person.id} onOpen={() => setOpen(draftOf(person))} label={`Öppna ${person.name}`} testId="external-row"
        icon={<AreaIcon area="customer" icon={UserRoundPlus} />} title={person.name} subtitle={subtitle(person)} aside={period(person)} />)}</RegisterRows>}
    {form}
  </section>;
}

/** The quick form (size="form": a popup on a computer, a page elsewhere). */
function ExternalForm({ view, busy, run, draft: start, onClose }: PartProps & { draft: Draft; onClose: () => void }) {
  const [draft, setDraft] = useState(start);
  const [confirm, confirmElement] = useConfirm();
  const roles = [...(view.program?.roles ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const order = !draft.periodFrom || !draft.periodTo || draft.periodTo >= draft.periodFrom;
  const save = async () => { if (await run({ action: "save_external_person", person: payload(draft) }, draft.id ? "Personen är sparad." : "Personen är tillagd.")) onClose(); };
  const remove = async () => {
    if (!draft.id || !await confirm({ title: "Ta bort personen?", message: `${draft.name} tas bort ur listan. Fastställda versioner påverkas inte.`, confirmLabel: "Ta bort", tone: "danger" })) return;
    if (await run({ action: "remove_external_person", id: draft.id }, "Personen är borttagen.")) onClose();
  };
  // A page of its own like a role and a person (2026-11-24: the same top as an opened customer, with Tillbaka).
  return <DialogPage pageKey="inhyrd" size="page" open onOpenChange={(next) => { if (!next) onClose(); }} title={draft.id ? draft.name || "Inhyrd person" : "Ny inhyrd"} panelTitle="Uppgifter">    {confirmElement}
    <div className="space-y-4" data-testid="external-form">
      <Field id="si-ext-name" label="Namn" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="si-ext-company" label="Uthyrande företag" value={draft.companyName} onChange={(companyName) => setDraft({ ...draft, companyName })} />
        <Field id="si-ext-orgnr" label="Organisationsnummer" value={draft.companyOrgNumber} onChange={(companyOrgNumber) => setDraft({ ...draft, companyOrgNumber })} placeholder="556677-8899" />
        <Field id="si-ext-role" label="Roll" value={draft.roleId} onChange={(roleId) => setDraft({ ...draft, roleId })} options={["", ...roles.map((role) => role.id)]} optionLabels={{ "": "Ingen roll", ...Object.fromEntries(roles.map((role) => [role.id, role.name])) }} />
        <Field id="si-ext-level" label="Nivå" value={String(draft.level)} onChange={(value) => setDraft({ ...draft, level: toLevel(Number(value)) })} options={LEVELS.map(String)} optionLabels={Object.fromEntries(LEVELS.map((level) => [String(level), `Nivå ${level}`]))} />
        <Field id="si-ext-from" type="date" label="Uppdraget från" value={draft.periodFrom} onChange={(periodFrom) => setDraft({ ...draft, periodFrom })} />
        <Field id="si-ext-to" type="date" label="Uppdraget till" value={draft.periodTo} onChange={(periodTo) => setDraft({ ...draft, periodTo })} error={order ? undefined : "Uppdraget kan inte sluta innan det börjar."} />
      </div>
      <Field id="si-ext-competence" label="Kort om kompetensen" value={draft.competence} onChange={(competence) => setDraft({ ...draft, competence })} multiline rows={3} />
      {view.people.length ? <Field id="si-ext-user" label="Konto i Workflow (valfritt)" value={draft.userId} onChange={(userId) => setDraft({ ...draft, userId })} options={["", ...view.people.map((person) => person.id)]}
        optionLabels={{ "": "Inget konto", ...Object.fromEntries(view.people.map((person) => [person.id, person.name])) }} hint="Koppla till ett konto om personen ska få uppgifter." /> : null}
      <CheckField id="si-ext-included" label="Ingår i programmet" description="Av: personen syns inte i programmet, trädet eller bilagorna, och nivåkontroll och läsbekräftelse gäller inte. På: personen är med under perioden och kommer med i nästa fastställda version."
        checked={draft.included} onChange={(included) => setDraft({ ...draft, included })} testId="external-form-included" />
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", busy, disabledReason: !draft.name.trim() ? "Skriv namnet först." : order ? null : "Kontrollera perioden.", onClick: () => void save(), testId: "external-save" }}>
        {draft.id ? <Button type="button" variant="outline" className="text-destructive" disabled={busy} onClick={() => void remove()} data-testid="external-remove"><Trash2 />Ta bort</Button> : null}
        <BackToList list="Inhyrd personal" onBack={onClose} />
      </DialogActions>
    </div>
  </DialogPage>;
}
