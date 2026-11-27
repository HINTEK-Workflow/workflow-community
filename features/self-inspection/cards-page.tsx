"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookMarked, CheckCircle2, Download, GraduationCap, Layers, ListChecks, Plus, SlidersHorizontal, Tags, UserPlus } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { ListEmpty, ListGroup, ListRow } from "@/components/native";
import { ListCard, ListCardGrid, ListFilterBar, RegisterRow, RegisterRows, useListPrefs } from "@/components/list-filter-bar";
import { PageHeader } from "@/components/page-shell";
import { listSortOptions } from "@/lib/list-filter";
import { selfInspectionHref } from "@/lib/self-inspection/tabs";
import { BackToList, useOpenRecord } from "./record-nav";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RemoveButton } from "@/components/ui/remove-button";
import { DialogPage } from "@/features/kfid/dialog-page";
import { useConfirm } from "@/features/kfid/confirm";
import { CheckField, DialogActions, Empty, Field, Modal, Panel } from "@/features/kfid/ui";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { NativeActions, useNativeTopBar } from "@/components/native";
import { saveBlob } from "@/lib/download";
import { swedishDayKey } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { LANGUAGE_LEVELS, LICENCE_CLASSES, peopleOverview, programContent, type CardVersion, type CompetenceCardView, type LanguageLevel, type LicenceClass, type SelfInspectionView } from "@/lib/self-inspection/model";
import { competenceCsv } from "@/lib/self-inspection/competence-export";
import { LEVELS, toLevel } from "@/lib/self-inspection/levels";
import { EMPLOYMENT_FORMS, levelRuleText, personLevel, personLevelText, yearsText } from "@/lib/self-inspection/structure";
import { CompetenceTab, GroupsModal } from "./registers";
import { AddNamedPerson, ProgramAssessment } from "./organisation";
import { siDate, Tag, type CredentialFilesApi, type Run } from "./shared";

/**
 * Kompetenskort (2026-11-24): a list of the people and a page of its own per person. The page holds the employment, the
 * company's own title, the experience and the level counted from it, the roles (given here, shown on Rollbeskrivningar), schools,
 * the company's experience areas, practical experience, driving licence and languages, and the trainings, authorisations and
 * certificates with their files, reminders, versions and the three-month rule as before. The employee number is read from
 * Användare. An admin adjusts the level either way only with a reason, and confirms a new level the years have reached.
 * Drawing only; the backend decides who may do what.
 */
type Props = { view: SelfInspectionView; busy: boolean; run: Run; files?: CredentialFilesApi; history?: (personId: string) => Promise<CardVersion[]>; reload: () => Promise<void> };
type Row = { personId: string; name: string; card: CompetenceCardView | null; roles: string[]; trainings: number; left: boolean };
type Filter = "all" | "attention" | "level1" | "level2" | "level3";
const CARD_SORTS = ["title", "updated"] as const;
const CARD_SORT_OPTIONS = listSortOptions(CARD_SORTS);

export function CardsPart({ view, busy, run, files, history, reload, namedPeople = false }: Props & {
  /** Local: the people are named in the file, so Lägg till person adds one by name (2026-11-25: moved here from the programme's text). */ namedPeople?: boolean }) {
  // Everyone in the programme (a role or an assessment), also before the person has a card: the assessment is kept here.
  const programPeople = useMemo(() => view.program ? peopleOverview(programContent(view.program, undefined, view.program.extras)) : [], [view.program]);
  const native = useNativeMode();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const prefs = useListPrefs("self-inspection-cards", view.me.id, { sorts: CARD_SORTS });
  useNativeTopBar(native ? { title: "Kompetenskort", add: view.canEdit ? { label: "Nytt kompetenskort", onClick: () => setChoosing(true), testId: "cards-new" } : null } : null);
  const nameOf = (personId: string) => view.people.find((person) => person.id === personId)?.name ?? (view.competenceCards ?? []).find((card) => card.personId === personId)?.name
    ?? view.credentials.find((item) => item.personId === personId)?.name ?? programPeople.find((person) => person.personId === personId)?.name ?? null;
  const [open, setOpen, closeOpen] = useOpenRecord<{ personId: string; name: string }>("person", (personId) => { const name = nameOf(personId); return name !== null ? { personId, name } : null; });
  const [choosing, setChoosing] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [areasOpen, setAreasOpen] = useState(false);
  const [addingNamed, setAddingNamed] = useState(false);
  const rows = useMemo<Row[]>(() => {
    const byId = new Map<string, Row>();
    const row = (personId: string, name: string) => byId.get(personId) ?? { personId, name: name || "Okänd person", card: null, roles: [], trainings: 0, left: false };
    for (const card of view.competenceCards ?? []) byId.set(card.personId, { ...row(card.personId, card.name), card, left: Boolean(card.savedUntil) });
    for (const item of view.credentials) { const found = row(item.personId, item.name); byId.set(item.personId, { ...found, trainings: found.trainings + 1, left: found.left || Boolean(item.savedUntil) }); }
    // Admins see everyone in the company, also before their card has anything on it.
    for (const person of view.people) if (!byId.has(person.id)) byId.set(person.id, row(person.id, person.name));
    if (view.canEdit) for (const person of programPeople) if (!byId.has(person.personId)) byId.set(person.personId, row(person.personId, person.name));
    for (const role of view.program?.roles ?? []) for (const member of role.members) { const found = byId.get(member.personId); if (found && !found.roles.includes(role.name)) found.roles.push(role.name); }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "sv"));
  }, [view.competenceCards, view.credentials, view.people, view.program?.roles, view.canEdit, programPeople]);
  const attention = (item: Row) => Boolean(item.card?.levelInfo?.pending || item.card?.suggestion || item.card?.licenceState === "OVERDUE" || item.card?.licenceState === "DUE_SOON"
    || view.credentials.some((line) => line.personId === item.personId && (line.state === "OVERDUE" || line.state === "DUE_SOON")));
  const needle = query.trim().toLocaleLowerCase("sv");
  const levelOf = (item: Row) => item.card?.levelInfo?.level ?? null;
  const matches = (item: Row, value: Filter) => value === "all" || (value === "attention" ? attention(item) : levelOf(item) === Number(value.slice(-1)));
  const shown = rows.filter((item) => matches(item, filter) && (!needle || `${item.name} ${item.card?.ownTitle ?? ""} ${item.roles.join(" ")}`.toLocaleLowerCase("sv").includes(needle)))
    .sort((a, b) => prefs.sort === "updated" ? (b.card?.updatedAt ?? "").localeCompare(a.card?.updatedAt ?? "") : a.name.localeCompare(b.name, "sv"));
  const subtitle = (item: Row) => [item.card?.ownTitle, item.roles.join(", "), item.left ? "har lämnat företaget" : ""].filter(Boolean).join(" · ") || "Ingen roll";
  const levelText = (item: Row) => item.card?.levelInfo?.level ? personLevelText(item.card.levelInfo) : "Ingen nivå";
  const pill = (item: Row) => item.card?.levelInfo?.pending ? { label: `Ny nivå ${item.card.levelInfo.pending}`, tone: "warning" as const } : attention(item) ? { label: "Att se över", tone: "warning" as const } : null;
  const chips = ([["all", "Alla"], ["attention", "Att se över"], ["level1", "Nivå 1"], ["level2", "Nivå 2"], ["level3", "Nivå 3"]] as const).map(([value, label]) => ({ value, label, count: rows.filter((item) => matches(item, value)).length }));
  const withoutCard = view.people.filter((person) => !(view.competenceCards ?? []).some((card) => card.personId === person.id));
  const exportCsv = () => saveBlob(competenceCsv(view.credentials, view.competenceCards ?? []), `kompetenskort-${swedishDayKey(new Date())}.csv`, "text/csv;charset=utf-8");
  const actions = view.canEdit ? <>
    <Button variant="outline" onClick={() => setAreasOpen(true)} data-testid="cards-areas-open"><ListChecks />Erfarenhetsområden</Button>
    <Button variant="outline" onClick={() => setGroupsOpen(true)} data-testid="competence-groups-open"><Tags />Kompetensgrupper</Button>
    <Button variant="outline" onClick={exportCsv} disabled={!rows.length} data-testid="competence-export"><Download />Exportera</Button>
    {namedPeople && view.program ? <Button variant="outline" onClick={() => setAddingNamed(true)} data-testid="cards-add-named"><UserPlus />Lägg till person</Button> : null}
    <Button onClick={() => setChoosing(true)} disabled={!withoutCard.length} data-testid="cards-new"><Plus />Nytt kompetenskort</Button>
  </> : null;
  const description = view.canEdit ? "En sida per person med anställning, erfarenhet, nivå, roller, utbildningar och intyg. Klockan påminner 30 dagar innan något går ut." : "Ditt kompetenskort. Administratören håller kortet aktuellt – föreslå en ändring om något saknas.";
  const dialogs = <>
    {open && <PersonPage key={open.personId} view={view} busy={busy} run={run} files={files} history={history} reload={reload} person={open} onClose={closeOpen} />}
    {groupsOpen && <GroupsModal view={view} busy={busy} run={run} onClose={() => setGroupsOpen(false)} />}
    {areasOpen && <AreasPage view={view} busy={busy} run={run} onClose={() => setAreasOpen(false)} />}
    {addingNamed && <AddNamedPerson view={view} busy={busy} run={run} onClose={() => setAddingNamed(false)} />}
    {choosing && <Modal open onOpenChange={(next) => { if (!next) setChoosing(false); }} title="Nytt kompetenskort" size="compact">
      <ChoosePerson people={withoutCard} onCancel={() => setChoosing(false)} onChoose={(person) => { setChoosing(false); setOpen(person); }} />
    </Modal>}
  </>;
  const filterBar = <ListFilterBar testId="cards" label="Sök och sortera kompetenskort" chips={{ label: "Visa", value: filter, onChange: setFilter, chips, testId: "cards-filter" }}
    search={{ label: "Sök person", placeholder: "Sök på namn, benämning eller roll…", value: query, onChange: setQuery, testId: "cards-search" }}
    sort={{ value: prefs.sort, options: CARD_SORT_OPTIONS, onChange: prefs.setSort }} view={{ value: prefs.view, onChange: prefs.setView }} />;
  const openRow = (item: Row) => setOpen({ personId: item.personId, name: item.name });
  // The phone's app view (as Kunder): the list's own rows, Ny in the top bar, the lists' own pages under the list.
  if (native) return <section className="space-y-3" data-testid="self-inspection-cards">
    {dialogs}
    {filterBar}
    <ListGroup title={`${shown.length} ${shown.length === 1 ? "person" : "personer"}`} testId="self-inspection-card-rows">
      {shown.length ? shown.map((item) => <ListRow key={item.personId} type="customer" icon={GraduationCap} title={item.name} subtitle={subtitle(item)} value={levelText(item)} onClick={() => openRow(item)} pill={pill(item)} testId="card-row" />)
        : <ListEmpty>Inga kompetenskort hittades.</ListEmpty>}
    </ListGroup>
    {view.canEdit ? <NativeActions>
      <Button type="button" variant="ghost" onClick={() => setAreasOpen(true)} data-testid="cards-areas-open"><ListChecks />Erfarenhetsområden</Button>
      <Button type="button" variant="ghost" onClick={() => setGroupsOpen(true)} data-testid="competence-groups-open"><Tags />Kompetensgrupper</Button>
      {namedPeople && view.program ? <Button type="button" variant="ghost" onClick={() => setAddingNamed(true)} data-testid="cards-add-named"><UserPlus />Lägg till person</Button> : null}
    </NativeActions> : null}
  </section>;
  const cards = prefs.view === "cards" && shown.length > 0;
  return <section data-testid="self-inspection-cards" data-view={prefs.view}>
    <PageHeader title="Kompetenskort" description={description} actions={actions} />
    {filterBar}
    {!shown.length ? <div className="mt-4 rounded-xl border bg-card p-4"><Empty title={needle || filter !== "all" ? "Inga kompetenskort hittades" : "Inga kompetenskort ännu"} description={view.canEdit ? "Lägg till ett kort med Nytt kompetenskort." : "Inget är registrerat för dig ännu."} /></div>
      : cards ? <div className="mt-4"><ListCardGrid testId="self-inspection-card-cards">{shown.map((item) => { const tag = pill(item); return <ListCard key={item.personId} testId="card-row" onOpen={() => openRow(item)}
        icon={<AreaIcon area="customer" icon={GraduationCap} />} title={item.name} subtitle={subtitle(item)} badges={tag ? <Tag tone="warning">{tag.label}</Tag> : undefined}
        facts={[{ icon: Layers, label: "Nivå", value: levelText(item) }, { icon: BookMarked, label: "Utbildningar", value: `${item.trainings} ${item.trainings === 1 ? "utbildning" : "utbildningar"}` }]} />; })}</ListCardGrid></div>
      : <RegisterRows label={`Kompetenskort, ${shown.length}`} testId="self-inspection-card-rows">{shown.map((item) => { const tag = pill(item); return <RegisterRow key={item.personId} onOpen={() => openRow(item)} label={`Kompetenskortet för ${item.name}`} testId="card-row"
        icon={<AreaIcon area="customer" icon={GraduationCap} />} title={item.name} subtitle={subtitle(item)} aside={levelText(item)} badge={tag ? <Tag tone="warning">{tag.label}</Tag> : undefined} />; })}</RegisterRows>}
    {dialogs}
  </section>;
}

function ChoosePerson({ people, onChoose, onCancel }: { people: { id: string; name: string }[]; onChoose: (person: { personId: string; name: string }) => void; onCancel: () => void }) {
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  return <div className="space-y-4">
    <Field id="si-card-new-person" label="Person" value={personId} onChange={setPersonId} options={people.map((person) => person.id)} optionLabels={Object.fromEntries(people.map((person) => [person.id, person.name]))} />
    <DialogActions cancel={{ onClick: onCancel }} primary={{ label: "Öppna kortet", disabled: !personId, onClick: () => onChoose({ personId, name: people.find((person) => person.id === personId)?.name ?? "" }) }} />
  </div>;
}

type ExperienceMode = "since" | "years";
type ProfileDraft = {
  employedAt: string; employmentForm: string; ownTitle: string; mode: ExperienceMode; experienceSince: string; experienceYears: string; experienceYearsAt: string;
  practicalExperience: string; licenceCheckedAt: string; educations: { title: string; school: string; from: string; to: string }[]; areaIds: string[];
  groupIds: string[]; licenceClasses: LicenceClass[]; licenceValidUntil: string; languages: { language: string; level: LanguageLevel }[]; roleIds: string[];
};
function draftOf(card: CompetenceCardView | null, roleIds: string[]): ProfileDraft {
  return {
    employedAt: card?.employedAt ?? "", employmentForm: card?.employmentForm ?? "", ownTitle: card?.ownTitle ?? "",
    mode: card?.experienceSince || card?.experienceYears === null || card?.experienceYears === undefined ? "since" : "years",
    experienceSince: card?.experienceSince ?? "", experienceYears: card?.experienceYears === null || card?.experienceYears === undefined ? "" : String(card.experienceYears), experienceYearsAt: card?.experienceYearsAt ?? "",
    practicalExperience: card?.practicalExperience ?? "", licenceCheckedAt: card?.licenceCheckedAt ?? "",
    educations: (card?.educations ?? []).map((item) => ({ title: item.title, school: item.school, from: item.from ?? "", to: item.to ?? "" })), areaIds: [...(card?.areaIds ?? [])],
    groupIds: [...(card?.groupIds ?? [])], licenceClasses: [...(card?.licenceClasses ?? [])], licenceValidUntil: card?.licenceValidUntil ?? "", languages: (card?.languages ?? []).map((item) => ({ ...item })), roleIds,
  };
}
const dayOrNull = (value: string) => value || null;
const toggle = <T extends string>(list: T[], value: T) => list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

/** One person's card on a page of its own (`page=person`): Avbryt and Spara top right; the level's own buttons in its panel. */
function PersonPage({ view, busy, run, files, history, reload, person, onClose }: Props & { person: { personId: string; name: string }; onClose: () => void }) {
  const card = (view.competenceCards ?? []).find((item) => item.personId === person.personId) ?? null;
  const roles = useMemo(() => [...(view.program?.roles ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [view.program?.roles]);
  const heldRoles = roles.filter((role) => role.members.some((member) => member.personId === person.personId)).map((role) => role.id);
  const [draft, setDraft] = useState(() => draftOf(card, heldRoles));
  const [adjusting, setAdjusting] = useState(false);
  const left = Boolean(card?.savedUntil);
  const editable = view.canEdit && !left;
  const today = swedishDayKey(new Date());
  // The level as the draft would count it, so the person sees it change while typing the experience.
  const counted = personLevel({ experienceSince: draft.mode === "since" ? dayOrNull(draft.experienceSince) : null,
    experienceYears: draft.mode === "years" && draft.experienceYears !== "" ? Number(draft.experienceYears) : null, experienceYearsAt: draft.mode === "years" ? dayOrNull(draft.experienceYearsAt) : null }, view.program?.levelYears, today);
  const info = card?.levelInfo ?? null;
  const start = draftOf(card, heldRoles);
  const experienceEdited = draft.mode !== start.mode || draft.experienceSince !== start.experienceSince || draft.experienceYears !== start.experienceYears || draft.experienceYearsAt !== start.experienceYearsAt;
  // The level that applies: an adjustment, else the confirmed one – or, while the experience is being changed, what it will give.
  const level = info?.adjusted ? info.level : experienceEdited ? counted.counted : info?.level ?? counted.counted;
  const requirementWarnings = roles.filter((role) => draft.roleIds.includes(role.id) && level !== null && level < role.level);
  const save = async () => {
    const years = draft.mode === "years" && draft.experienceYears !== "" ? Number(draft.experienceYears) : null;
    const done = await run({ action: "save_competence_card", card: { personId: person.personId, name: person.name, groupIds: draft.groupIds, licenceClasses: draft.licenceClasses, licenceValidUntil: dayOrNull(draft.licenceValidUntil),
      languages: draft.languages.filter((item) => item.language.trim()), employedAt: dayOrNull(draft.employedAt), employmentForm: draft.employmentForm, ownTitle: draft.ownTitle,
      experienceSince: draft.mode === "since" ? dayOrNull(draft.experienceSince) : null, experienceYears: years, experienceYearsAt: draft.mode === "years" ? dayOrNull(draft.experienceYearsAt) : null,
      practicalExperience: draft.practicalExperience, licenceCheckedAt: dayOrNull(draft.licenceCheckedAt),
      educations: draft.educations.filter((item) => item.title.trim()).map((item) => ({ title: item.title, school: item.school, from: dayOrNull(item.from), to: dayOrNull(item.to) })), areaIds: draft.areaIds } }, "Kompetenskortet är sparat.");
    if (!done) return;
    // The roles are part of the programme's draft: given here, shown on Rollbeskrivningar.
    const changedRoles = JSON.stringify([...draft.roleIds].sort()) !== JSON.stringify([...heldRoles].sort());
    if (changedRoles && done.program) { if (!await run({ action: "set_person_roles", revision: done.program.revision, personId: person.personId, name: person.name, roleIds: draft.roleIds }, "Kompetenskortet och rollerna är sparade.")) return; }
    onClose();
  };
  const areas = view.experienceAreas ?? [];
  const groups = view.competenceGroups ?? [];
  const read = (value: string | null | undefined) => value ? siDate(value) : "–";
  return <DialogPage pageKey="person" size="page" open onOpenChange={(next) => { if (!next) onClose(); }} title={person.name || "Kompetenskort"} panelTitle={false}>
    <div className="space-y-5" data-testid="competence-person-page">
      {editable ? <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", busy, busyLabel: "Sparar…", onClick: () => void save(), testId: "competence-card-save" }}><BackToList list="Kompetenskort" onBack={onClose} /></DialogActions>
        : <DialogActions><BackToList list="Kompetenskort" onBack={onClose} /></DialogActions>}
      {left ? <p className="notice" data-testid="competence-person-left">Personen har lämnat företaget. Kortet sparas till {siDate(card?.savedUntil)} och kan inte ändras, bara tas bort.</p> : null}
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Anställning">
          <div className="grid gap-4 sm:grid-cols-2" data-testid="competence-employment">
            <div className="grid gap-1.5"><span className="text-xs font-medium">Anställningsnummer</span><span className="text-sm" data-testid="competence-employee-number">{card?.employeeNumber || "–"}</span>
              <span className="text-xs text-muted-foreground">Hämtas från Användare.</span></div>
            <Field id="si-card-employed" type="date" label="Anställd" value={draft.employedAt} onChange={(employedAt) => setDraft({ ...draft, employedAt })} disabled={!editable} />
            <Field id="si-card-form" label="Anställningsform" value={draft.employmentForm} onChange={(employmentForm) => setDraft({ ...draft, employmentForm })} suggestions={[...EMPLOYMENT_FORMS]} disabled={!editable} />
            <Field id="si-card-title" label="Företagets benämning" value={draft.ownTitle} onChange={(ownTitle) => setDraft({ ...draft, ownTitle })} placeholder="Till exempel lärling" disabled={!editable} />
          </div>
        </Panel>
        <Panel title="Erfarenhet och nivå" actions={editable && card ? <Button size="sm" variant="outline" onClick={() => setAdjusting(true)} data-testid="competence-level-adjust"><SlidersHorizontal />Justera nivån</Button> : null}>
          <div className="space-y-4" data-testid="competence-level">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold" data-testid="competence-level-value">{level ? `Nivå ${level}` : "Ingen nivå"}</span>
              {info?.adjusted ? <Tag tone="primary">Justerad (räknad: {info.counted ?? "–"})</Tag> : null}
              {counted.years !== null ? <span className="text-sm text-muted-foreground">{yearsText(counted.years)} erfarenhet</span> : null}
            </div>
            {info?.adjusted && info.reason ? <p className="text-sm"><span className="text-muted-foreground">Motivering: </span>{info.reason}</p> : null}
            {info?.pending ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm dark:bg-amber-950/30" data-testid="competence-level-pending">
              <span>Erfarenheten räcker nu till nivå {info.pending}. Nivån ändras när du bekräftar.</span>
              {editable ? <Button size="sm" disabled={busy} onClick={() => void run({ action: "confirm_competence_level", personId: person.personId }, `Nivå ${info.pending} är bekräftad.`)} data-testid="competence-level-confirm"><CheckCircle2 />Bekräfta nivå {info.pending}</Button> : null}
            </div> : null}
            <fieldset className="space-y-3" disabled={!editable}>
              <legend className="text-xs font-medium">Erfarenhet</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="si-experience-mode" checked={draft.mode === "since"} onChange={() => setDraft({ ...draft, mode: "since" })} />Sedan ett datum</label>
                <label className="flex items-center gap-2"><input type="radio" name="si-experience-mode" checked={draft.mode === "years"} onChange={() => setDraft({ ...draft, mode: "years" })} />Antal år per ett datum</label>
              </div>
              {draft.mode === "since" ? <Field id="si-card-since" type="date" label="Erfarenhet sedan" value={draft.experienceSince} onChange={(experienceSince) => setDraft({ ...draft, experienceSince })} className="max-w-xs" />
                : <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="si-card-years" type="number" label="Antal år" value={draft.experienceYears} onChange={(experienceYears) => setDraft({ ...draft, experienceYears })} />
                  <Field id="si-card-years-at" type="date" label="Per datum" value={draft.experienceYearsAt} onChange={(experienceYearsAt) => setDraft({ ...draft, experienceYearsAt })} hint="Lämnas tomt räknas det från i dag." />
                </div>}
              <p className="text-xs text-muted-foreground" data-testid="competence-level-rule">{levelRuleText(view.program?.levelYears)}{counted.counted ? ` Erfarenheten ger nivå ${counted.counted}.` : ""}</p>
            </fieldset>
          </div>
        </Panel>
      </div>
      {view.program ? <Panel title="Roller" description="Rollen ges här och visas på Rollbeskrivningar och i programmet. Nivåkravet är en varning.">
        <div className="space-y-3" data-testid="competence-roles">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{roles.map((role) => <CheckField key={role.id} id={`si-card-role-${role.id}`} disabled={!editable}
            label={<span>{role.name} <span className="text-xs text-muted-foreground">· nivåkrav {role.level}</span></span>} checked={draft.roleIds.includes(role.id)} onChange={() => setDraft({ ...draft, roleIds: toggle(draft.roleIds, role.id) })} />)}</div>
          {heldRoles.length ? <p className="text-sm" data-testid="competence-role-links">Rollbeskrivningar: {roles.filter((role) => heldRoles.includes(role.id)).map((role, index) => <span key={role.id}>{index ? ", " : ""}
            <Link href={selfInspectionHref("roles", { role: role.id })} className="text-primary hover:underline">{role.name}</Link></span>)}</p> : null}
          {requirementWarnings.length ? <p className="notice" data-testid="competence-role-warning">{requirementWarnings.map((role) => `${role.name} har nivåkrav ${role.level}`).join(", ")}, och personens nivå är {level}. Personen kan ändå ha rollen.</p> : null}
        </div>
      </Panel> : null}
      {/* The assessment in the programme's appendix B (2026-11-25): changed here, never in the programme's text. */}
      <ProgramAssessment view={view} busy={busy} run={run} personId={person.personId} name={person.name} editable={editable} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Skolutbildningar">
          <div className="space-y-3" data-testid="competence-educations">
            {draft.educations.map((item, index) => <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
              <Field id={`si-edu-title-${index}`} label="Utbildning" value={item.title} disabled={!editable} onChange={(title) => setDraft({ ...draft, educations: draft.educations.map((entry, at) => at === index ? { ...entry, title } : entry) })} />
              <Field id={`si-edu-school-${index}`} label="Skola" value={item.school} disabled={!editable} onChange={(school) => setDraft({ ...draft, educations: draft.educations.map((entry, at) => at === index ? { ...entry, school } : entry) })} />
              <Field id={`si-edu-from-${index}`} type="date" label="Från" value={item.from} disabled={!editable} onChange={(from) => setDraft({ ...draft, educations: draft.educations.map((entry, at) => at === index ? { ...entry, from } : entry) })} />
              <div className="flex items-end gap-2">
                <Field id={`si-edu-to-${index}`} type="date" label="Till" value={item.to} disabled={!editable} className="min-w-0 flex-1" onChange={(to) => setDraft({ ...draft, educations: draft.educations.map((entry, at) => at === index ? { ...entry, to } : entry) })} />
                {editable ? <RemoveButton label={`Ta bort ${item.title || "utbildningen"}`} onClick={() => setDraft({ ...draft, educations: draft.educations.filter((_, at) => at !== index) })} /> : null}
              </div>
            </div>)}
            {!draft.educations.length ? <p className="text-sm text-muted-foreground">Inga skolutbildningar angivna.</p> : null}
            {editable ? <Button size="sm" variant="outline" disabled={draft.educations.length >= 30} onClick={() => setDraft({ ...draft, educations: [...draft.educations, { title: "", school: "", from: "", to: "" }] })} data-testid="competence-education-add"><Plus />Lägg till skolutbildning</Button> : null}
          </div>
        </Panel>
        <Panel title="Erfarenhetsområden">
          <div className="space-y-3" data-testid="competence-areas">
            {areas.length ? <div className="grid gap-2 sm:grid-cols-2">{areas.map((area) => <label key={area.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.areaIds.includes(area.id)} disabled={!editable} onCheckedChange={() => setDraft({ ...draft, areaIds: toggle(draft.areaIds, area.id) })} />{area.name}</label>)}</div>
              : <p className="text-sm text-muted-foreground">Företaget har inga erfarenhetsområden ännu.</p>}
            {!areas.length && view.canEdit ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ action: "add_starter_lists", lists: ["areas"] }, "Startlistan är tillagd. Ändra den under Erfarenhetsområden.")}><ListChecks />Lägg till startlistan</Button> : null}
            <Field id="si-card-practical" label="Praktisk erfarenhet" value={draft.practicalExperience} disabled={!editable} onChange={(practicalExperience) => setDraft({ ...draft, practicalExperience })} multiline rows={4} />
          </div>
        </Panel>
      </div>
      <Panel title="Körkort, språk och kompetensgrupper">
        <div className="grid gap-5 lg:grid-cols-3" data-testid="competence-card-modal">
          <fieldset className="space-y-2" disabled={!editable}>
            <legend className="text-xs font-medium">Körkort</legend>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Körkortsbehörigheter">{LICENCE_CLASSES.map((value) => {
              const on = draft.licenceClasses.includes(value);
              return <button key={value} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, licenceClasses: toggle(draft.licenceClasses, value) })}
                className={cn("h-9 min-w-11 rounded-md border px-2 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "bg-muted/40 hover:bg-muted")}>{value}</button>;
            })}</div>
            <Field id="si-card-licence-valid" type="date" label="Giltigt till" value={draft.licenceValidUntil} onChange={(licenceValidUntil) => setDraft({ ...draft, licenceValidUntil })} />
            <Field id="si-card-licence-checked" type="date" label="Körkortet kontrollerat" value={draft.licenceCheckedAt} onChange={(licenceCheckedAt) => setDraft({ ...draft, licenceCheckedAt })} />
          </fieldset>
          <fieldset className="space-y-2" disabled={!editable}>
            <legend className="text-xs font-medium">Språk</legend>
            {draft.languages.map((item, index) => <div key={index} className="flex flex-wrap items-end gap-2">
              <Field id={`si-card-language-${index}`} label="Språk" value={item.language} className="min-w-28 flex-1" onChange={(language) => setDraft({ ...draft, languages: draft.languages.map((entry, at) => at === index ? { ...entry, language } : entry) })} />
              <Field id={`si-card-language-level-${index}`} label="Nivå" value={item.level} options={Object.keys(LANGUAGE_LEVELS)} optionLabels={LANGUAGE_LEVELS} className="min-w-36"
                onChange={(value) => setDraft({ ...draft, languages: draft.languages.map((entry, at) => at === index ? { ...entry, level: value as LanguageLevel } : entry) })} />
              {editable ? <RemoveButton label={`Ta bort språket ${item.language || index + 1}`} onClick={() => setDraft({ ...draft, languages: draft.languages.filter((_, at) => at !== index) })} /> : null}
            </div>)}
            {editable ? <Button variant="outline" size="sm" disabled={draft.languages.length >= 20} onClick={() => setDraft({ ...draft, languages: [...draft.languages, { language: "", level: "WORK" }] })}><Plus />Lägg till språk</Button>
              : !draft.languages.length ? <p className="text-sm text-muted-foreground">Inte angivet.</p> : null}
          </fieldset>
          <fieldset className="space-y-2" disabled={!editable}>
            <legend className="text-xs font-medium">Kompetensgrupper</legend>
            {groups.length ? <div className="grid gap-2">{groups.map((group) => <label key={group.id} className="flex items-start gap-2 text-sm">
              <Checkbox checked={draft.groupIds.includes(group.id)} onCheckedChange={() => setDraft({ ...draft, groupIds: toggle(draft.groupIds, group.id) })} aria-label={group.name} />
              <span className="min-w-0"><span className="block">{group.name}</span>{group.description ? <span className="block text-xs text-muted-foreground">{group.description}</span> : null}</span>
            </label>)}</div> : <p className="text-sm text-muted-foreground">Inga kompetensgrupper ännu.</p>}
            {!groups.length && view.canEdit ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ action: "add_starter_lists", lists: ["groups"] }, "Startlistan är tillagd.")}><Tags />Lägg till startlistan</Button> : null}
          </fieldset>
        </div>
        {!editable && card ? <p className="mt-3 text-xs text-muted-foreground">Anställd {read(card.employedAt)} · körkortet kontrollerat {read(card.licenceCheckedAt)}</p> : null}
      </Panel>
      <CompetenceTab view={view} busy={busy} run={run} files={files} history={history} reload={reload} onlyPerson={person} />
    </div>
    {adjusting && card && <AdjustLevel busy={busy} counted={info?.counted ?? null} current={info} onCancel={() => setAdjusting(false)}
      onSave={async (value, reason) => { if (await run({ action: "set_competence_level", personId: person.personId, level: value, reason }, value ? `Nivån är justerad till ${value}.` : "Justeringen är borttagen.")) setAdjusting(false); }} />}
  </DialogPage>;
}

/** Justera nivån: either way, always with a reason; the card then shows "Justerad (räknad: N)" and the history keeps it. */
function AdjustLevel({ busy, counted, current, onCancel, onSave }: { busy: boolean; counted: number | null; current: ReturnType<typeof personLevel> | null; onCancel: () => void; onSave: (level: 1 | 2 | 3 | null, reason: string) => Promise<void> }) {
  const [value, setValue] = useState(current?.adjusted && current.level ? String(current.level) : String(counted ?? 1));
  const [reason, setReason] = useState("");
  return <Modal open onOpenChange={(next) => { if (!next) onCancel(); }} title="Justera nivån" size="compact">
    <div className="space-y-4" data-testid="competence-level-dialog">
      <p className="text-sm text-muted-foreground">Räknad från erfarenheten: {counted ? `nivå ${counted}` : "ingen nivå"}. Justeringen sparas i kortets historik.</p>
      <Field id="si-level-value" label="Nivå" value={value} onChange={setValue} options={[...LEVELS.map(String), ...(current?.adjusted ? [""] : [])]}
        optionLabels={{ ...Object.fromEntries(LEVELS.map((level) => [String(level), `Nivå ${level}`])), "": "Ta bort justeringen" }} />
      <Field id="si-level-reason" label="Motivering" value={reason} onChange={setReason} multiline rows={3} required />
      <DialogActions cancel={{ onClick: onCancel }} primary={{ label: "Spara", busy, disabledReason: reason.trim() ? null : "Skriv en motivering.", testId: "competence-level-save",
        onClick: () => void onSave(value ? toLevel(Number(value)) : null, reason.trim()) }} />
    </div>
  </Modal>;
}

/** The company's own experience areas: add, rename and remove (the cards that ticked a removed one lose it). */
function AreasPage({ view, busy, run, onClose }: { view: SelfInspectionView; busy: boolean; run: Run; onClose: () => void }) {
  const [confirm, confirmElement] = useConfirm();
  const [fresh, setFresh] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const areas = view.experienceAreas ?? [];
  const used = (areaId: string) => (view.competenceCards ?? []).filter((card) => card.areaIds?.includes(areaId)).length;
  return <DialogPage pageKey="omraden" size="page" open onOpenChange={(next) => { if (!next) onClose(); }} title="Erfarenhetsområden" panelTitle="Företagets lista">
    {confirmElement}
    <div className="space-y-4" data-testid="experience-areas">
      <p className="text-sm text-muted-foreground">Områden som kryssas i på kompetenskortet. Listan är företagets egen.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field id="si-area-new" label="Nytt område" value={fresh} onChange={setFresh} className="min-w-48 flex-1" />
        <Button disabled={busy || !fresh.trim()} onClick={async () => { if (await run({ action: "save_experience_area", area: { name: fresh } }, "Området är tillagt.")) setFresh(""); }} data-testid="experience-area-add"><Plus />Lägg till</Button>
        {!areas.length ? <Button variant="outline" disabled={busy} onClick={() => void run({ action: "add_starter_lists", lists: ["areas"] }, "Startlistan är tillagd.")}><ListChecks />Lägg till startlistan</Button> : null}
      </div>
      {areas.length ? <ul className="divide-y rounded-lg border">{areas.map((area) => <li key={area.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
        {editing?.id === area.id ? <div className="flex flex-1 flex-wrap items-end gap-2">
          <Field id={`si-area-${area.id}`} label="Namn" value={editing.name} onChange={(name) => setEditing({ ...editing, name })} className="min-w-48 flex-1" />
          <Button variant="outline" onClick={() => setEditing(null)}>Avbryt</Button>
          <Button disabled={busy || !editing.name.trim()} onClick={async () => { if (await run({ action: "save_experience_area", area: editing }, "Området är ändrat.")) setEditing(null); }}>Spara</Button>
        </div> : <>
          <button type="button" className="min-w-0 text-left text-sm font-medium hover:text-primary" onClick={() => setEditing({ id: area.id, name: area.name })}>{area.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{used(area.id)} {used(area.id) === 1 ? "person" : "personer"}</span></button>
          <RemoveButton label={`Ta bort ${area.name}`} disabled={busy} onClick={async () => {
            if (!await confirm({ title: "Ta bort området?", message: `${area.name} tas bort ur listan och från korten där det är ikryssat.`, confirmLabel: "Ta bort", tone: "danger" })) return;
            await run({ action: "remove_experience_area", id: area.id }, "Området är borttaget.");
          }} />
        </>}
      </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga områden ännu.</p>}
      <DialogActions cancel={{ label: "Stäng", onClick: onClose }} />
    </div>
  </DialogPage>;
}
