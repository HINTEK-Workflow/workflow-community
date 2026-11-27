"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Layers, Plus, Settings2, Trash2, UserRound } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { ListEmpty, ListGroup, ListRow } from "@/components/native";
import { ListCard, ListCardGrid, ListFilterBar, RegisterRow, RegisterRows, useListPrefs } from "@/components/list-filter-bar";
import { PageHeader } from "@/components/page-shell";
import { LIST_SORT_LABEL } from "@/lib/list-filter";
import { selfInspectionHref } from "@/lib/self-inspection/tabs";
import { BackToList, useOpenRecord } from "./record-nav";
import { Button } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { DialogPage } from "@/features/kfid/dialog-page";
import { useConfirm } from "@/features/kfid/confirm";
import { CheckField, DialogActions, Empty, Field, Panel } from "@/features/kfid/ui";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { NativeActions, useNativeTopBar } from "@/components/native";
import { ROLE_CAPABILITIES, type DutyGroup, type ProgramRole, type RoleCapability, type SelfInspectionView } from "@/lib/self-inspection/model";
import { LEVELS, toLevel, type Level } from "@/lib/self-inspection/levels";
import { levelRuleText, levelYearsOf, personLevelText } from "@/lib/self-inspection/structure";
import { ProgramText, Tag, type Run } from "./shared";

/**
 * Rollbeskrivningar (2026-11-24): the programme's roles as a list – the list template (PageHeader with Ny roll, the
 * filter bar, rows with an arrow) – and a page of its own per role with its name, short description, level requirement (a
 * warning, never a stop), what the role does in the programme, whether it is the ERE, and its duties under the company's own
 * headings. Who has the role is shown here and changed on the person's competence card. The text every role shares and the
 * level limits are one form beside the list. Drawing only; every change is checked again by the backend.
 */
export type PartProps = { view: SelfInspectionView; busy: boolean; run: Run };

export const LEVEL_REQUIREMENT_TEXTS: Record<Level, string> = {
  1: "Nivå 1 – enklare uppgifter och arbete under handledning",
  2: "Nivå 2 – självständigt arbete",
  3: "Nivå 3 – uppgifter med högre risk och kontroller",
};

type RoleDraft = { id?: string; name: string; description: string; level: Level; isEre: boolean; capabilities: RoleCapability[]; dutyGroups: DutyGroup[] };
const draftOf = (role: ProgramRole): RoleDraft => ({
  id: role.id, name: role.name, description: role.description, level: toLevel(role.level), isEre: role.isEre, capabilities: [...role.capabilities],
  // A role from before 2026-11-24 has its duties as one text: it becomes the first group, under a heading of its own.
  dutyGroups: role.dutyGroups?.length ? role.dutyGroups.map((group) => ({ ...group })) : role.duties.trim() ? [{ title: "Uppgifter", text: role.duties }] : [],
});
const NEW_ROLE: RoleDraft = { name: "", description: "", level: 1, isEre: false, capabilities: [], dutyGroups: [{ title: "", text: "" }] };

/** The people who have a role, with their own level (the card's, else the roles'). */
export function rolePeople(view: SelfInspectionView, role: Pick<ProgramRole, "members">) {
  const cards = new Map((view.competenceCards ?? []).map((card) => [card.personId, card]));
  const levels = new Map(view.levels.people.map((person) => [person.personId, person.level]));
  const names = new Map(view.people.map((person) => [person.id, person.name]));
  return role.members.map((member) => {
    const card = cards.get(member.personId);
    return { personId: member.personId, name: names.get(member.personId) || member.name || card?.name || "Okänd person", level: card?.levelInfo?.level ?? (levels.get(member.personId) || null), card };
  });
}

type RoleFilter = "all" | "with" | "without";
const ROLE_SORTS = ["number", "title"] as const;
const ROLE_SORT_OPTIONS = ROLE_SORTS.map((value) => ({ value, label: value === "number" ? "Programmets ordning" : LIST_SORT_LABEL.title }));

export function RolesPart({ view, busy, run }: PartProps) {
  const program = view.program;
  const native = useNativeMode();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RoleFilter>("all");
  const newRole = () => setOpen({ ...NEW_ROLE, dutyGroups: [{ title: "", text: "" }] });
  useNativeTopBar(native ? { title: "Rollbeskrivningar", add: program ? { label: "Ny roll", onClick: newRole, testId: "roles-new" } : null } : null);
  const prefs = useListPrefs("self-inspection-roles", view.me.id, { sorts: ROLE_SORTS });
  const roles = useMemo(() => [...(program?.roles ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [program?.roles]);
  const [open, setOpen, closeOpen] = useOpenRecord<RoleDraft>("role", (id) => { const role = program?.roles.find((item) => item.id === id); return role ? draftOf(role) : null; });
  const [settings, setSettings] = useState(false);
  const needle = query.trim().toLocaleLowerCase("sv");
  const matches = (role: ProgramRole, value: RoleFilter) => value === "all" || (value === "with") === role.members.length > 0;
  const shown = roles.filter((role) => matches(role, filter) && (!needle || `${role.name} ${role.description}`.toLocaleLowerCase("sv").includes(needle)))
    .sort((a, b) => prefs.sort === "title" ? a.name.localeCompare(b.name, "sv") : a.sortOrder - b.sortOrder);
  const below = (role: ProgramRole) => rolePeople(view, role).filter((person) => person.level !== null && person.level < role.level).length;
  const subtitle = (role: ProgramRole) => [`Nivåkrav ${role.level}`, role.isEre ? "Elinstallatör för regelefterlevnad" : "", role.description].filter(Boolean).join(" · ");
  const people = (role: ProgramRole) => `${role.members.length} ${role.members.length === 1 ? "person" : "personer"}`;
  const chips = (["all", "with", "without"] as const).map((value) => ({ value, label: value === "all" ? "Alla" : value === "with" ? "Med personer" : "Utan personer", count: roles.filter((role) => matches(role, value)).length }));
  const actions = program ? <>
    <Button variant="outline" onClick={() => setSettings(true)} data-testid="roles-settings-open"><Settings2 />Gemensamt för alla roller</Button>
    <Button onClick={() => setOpen({ ...NEW_ROLE, dutyGroups: [{ title: "", text: "" }] })} data-testid="roles-new"><Plus />Ny roll</Button>
  </> : null;
  const description = "Varje roll med uppgifter, nivåkrav och vilka som har rollen. Rollerna visas i programmets bilaga.";
  const dialogs = <>
    {open && program && <RolePage view={view} busy={busy} run={run} draft={open} onClose={closeOpen} />}
    {settings && program && <RoleSettings view={view} busy={busy} run={run} onClose={() => setSettings(false)} />}
  </>;
  if (!program) return <section data-testid="self-inspection-roles">
    <PageHeader title="Rollbeskrivningar" description={description} />
    <Empty title="Inget program ännu" description="Skapa programmet från mallen under Program. Då får du Workflows förslag på roller att utgå från." />
  </section>;
  const filterBar = <ListFilterBar testId="roles" label="Sök och sortera roller" chips={{ label: "Visa", chips, value: filter, onChange: setFilter, testId: "roles-filter" }}
    search={{ label: "Sök roll", placeholder: "Sök på namn eller beskrivning…", value: query, onChange: setQuery, testId: "roles-search" }}
    sort={{ value: prefs.sort, options: ROLE_SORT_OPTIONS, onChange: prefs.setSort }} view={{ value: prefs.view, onChange: prefs.setView }} />;
  // The phone's app view (as Kunder): the list's own rows under the search and Filter, Ny in the top bar, the rest under the list.
  if (native) return <section className="space-y-3" data-testid="self-inspection-roles">
    {dialogs}
    {filterBar}
    <ListGroup title={`${shown.length} ${shown.length === 1 ? "roll" : "roller"}`} testId="self-inspection-role-rows">
      {shown.length ? shown.map((role) => <ListRow key={role.id} type="customer" icon={BadgeCheck} title={role.name} subtitle={subtitle(role)} value={people(role)} onClick={() => setOpen(draftOf(role))} testId="role-row"
        pill={below(role) ? { label: "Under nivåkravet", tone: "warning" } : null} />) : <ListEmpty>Inga roller hittades.</ListEmpty>}
    </ListGroup>
    <NativeActions><Button type="button" variant="ghost" onClick={() => setSettings(true)} data-testid="roles-settings-open"><Settings2 />Gemensamt för alla roller</Button></NativeActions>
  </section>;
  const cards = prefs.view === "cards" && shown.length > 0;
  return <section data-testid="self-inspection-roles" data-view={prefs.view}>
    <PageHeader title="Rollbeskrivningar" description={description} actions={actions} />
    {filterBar}
    {!shown.length ? <div className="mt-4 rounded-xl border bg-card p-4"><Empty title={needle || filter !== "all" ? "Inga roller hittades" : "Inga roller ännu"} description={needle || filter !== "all" ? "Prova ett annat sökord eller filter." : "Lägg till företagets roller med Ny roll."} /></div>
      : cards ? <div className="mt-4"><ListCardGrid testId="self-inspection-role-cards">{shown.map((role) => <ListCard key={role.id} testId="role-row" onOpen={() => setOpen(draftOf(role))} icon={<AreaIcon area="customer" icon={BadgeCheck} />}
        title={role.name} subtitle={role.description || undefined} badges={below(role) ? <Tag tone="warning">Under nivåkravet</Tag> : undefined}
        facts={[{ icon: Layers, label: "Nivåkrav", value: `Nivåkrav ${role.level}` }, { icon: UserRound, label: "Personer", value: people(role) }]} />)}</ListCardGrid></div>
      : <RegisterRows label={`Roller, ${shown.length}`} testId="self-inspection-role-rows">{shown.map((role) => <RegisterRow key={role.id} onOpen={() => setOpen(draftOf(role))} label={`Öppna rollen ${role.name}`} testId="role-row"
        icon={<AreaIcon area="customer" icon={BadgeCheck} />} title={role.name} subtitle={subtitle(role)} aside={people(role)} badge={below(role) ? <Tag tone="warning">Under nivåkravet</Tag> : undefined} />)}</RegisterRows>}
    {dialogs}
  </section>;
}

/** One role on a page of its own: Avbryt and Spara top right, Ta bort beside them. */
function RolePage({ view, busy, run, draft: start, onClose }: PartProps & { draft: RoleDraft; onClose: () => void }) {
  const program = view.program!;
  const [draft, setDraft] = useState(start);
  const [confirm, confirmElement] = useConfirm();
  const role = start.id ? program.roles.find((item) => item.id === start.id) : undefined;
  const people = role ? rolePeople(view, role) : [];
  const setGroup = (index: number, patch: Partial<DutyGroup>) => setDraft({ ...draft, dutyGroups: draft.dutyGroups.map((group, at) => at === index ? { ...group, ...patch } : group) });
  const save = async () => {
    const groups = draft.dutyGroups.filter((group) => group.title.trim() || group.text.trim());
    const done = await run({ action: "save_role", revision: program.revision, role: { ...(draft.id ? { id: draft.id } : {}), name: draft.name, description: draft.description, duties: "", isEre: draft.isEre,
      capabilities: draft.capabilities, level: draft.level, dutyGroups: groups } }, draft.id ? "Rollen är sparad." : "Rollen är tillagd.");
    if (done) onClose();
  };
  const remove = async () => {
    if (!role || !await confirm({ title: "Ta bort rollen?", message: `”${role.name}” och vilka som har den tas bort ur utkastet. Roller under den i trädet flyttas upp. Fastställda versioner påverkas inte.`, confirmLabel: "Ta bort", tone: "danger" })) return;
    if (await run({ action: "remove_role", revision: program.revision, roleId: role.id }, "Rollen är borttagen ur utkastet.")) onClose();
  };
  return <DialogPage pageKey="roll" size="page" open onOpenChange={(next) => { if (!next) onClose(); }} title={start.id ? start.name || "Roll" : "Ny roll"} panelTitle={false}>
    {confirmElement}
    <div className="space-y-5" data-testid="self-inspection-role-page">
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", busy, busyLabel: "Sparar…", disabledReason: draft.name.trim() ? null : "Ge rollen ett namn först.", onClick: () => void save(), testId: "role-save" }}>
        {role ? <Button type="button" variant="outline" className="text-destructive" disabled={busy} onClick={() => void remove()} data-testid="role-remove"><Trash2 />Ta bort</Button> : null}
        <BackToList list="Rollbeskrivningar" onBack={onClose} />
      </DialogActions>
      <Panel title="Rollen">
        <div className="space-y-4">
          <Field id="si-role-name" label="Namn" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
          <Field id="si-role-description" label="Kort beskrivning" value={draft.description} onChange={(description) => setDraft({ ...draft, description })} multiline rows={2} />
          <div className="space-y-1.5">
            <Field id="si-role-level" label="Nivåkrav" value={String(draft.level)} onChange={(value) => setDraft({ ...draft, level: toLevel(Number(value)) })} options={LEVELS.map(String)}
              optionLabels={Object.fromEntries(LEVELS.map((level) => [String(level), LEVEL_REQUIREMENT_TEXTS[level]]))} className="max-w-xl" />
            <p className="text-xs text-muted-foreground">Nivåkravet är en varning. Den som har en lägre nivå än kravet kan ändå ha rollen, men det syns här och på kompetenskortet.</p>
          </div>
          <fieldset className="field-group rounded-lg border p-3"><legend className="px-1 text-xs font-medium">Funktioner i programmet</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">{ROLE_CAPABILITIES.map((item) => <CheckField key={item.key} id={`si-role-cap-${item.key}`} label={item.label} checked={draft.capabilities.includes(item.key)}
              onChange={(on) => setDraft({ ...draft, capabilities: on ? [...draft.capabilities, item.key] : draft.capabilities.filter((key) => key !== item.key) })} />)}</div>
          </fieldset>
          <CheckField id="si-role-ere" label="Elinstallatör för regelefterlevnad (ERE)" description="Rollen är den som enligt programmet ansvarar för att arbetet följer reglerna." checked={draft.isEre} onChange={(isEre) => setDraft({ ...draft, isEre })} testId="role-ere" />
        </div>
      </Panel>
      <Panel title="Arbetsuppgifter" description="Skriv uppgifterna under egna rubriker, en uppgift per rad.">
        <div className="space-y-4" data-testid="role-duty-groups">
          {draft.dutyGroups.map((group, index) => <div key={index} className="space-y-2 rounded-lg border p-3" data-testid="role-duty-group">
            <div className="flex items-end gap-2">
              <Field id={`si-role-group-${index}`} label="Rubrik" value={group.title} onChange={(title) => setGroup(index, { title })} className="min-w-0 flex-1" placeholder="Till exempel Planering" />
              <RemoveButton label={`Ta bort rubriken ${group.title || index + 1}`} onClick={() => setDraft({ ...draft, dutyGroups: draft.dutyGroups.filter((_, at) => at !== index) })} />
            </div>
            <Field id={`si-role-group-text-${index}`} label="Uppgifter" value={group.text} onChange={(text) => setGroup(index, { text })} multiline rows={3} />
          </div>)}
          <Button type="button" variant="outline" size="sm" disabled={draft.dutyGroups.length >= 30} onClick={() => setDraft({ ...draft, dutyGroups: [...draft.dutyGroups, { title: "", text: "" }] })} data-testid="role-duty-group-add"><Plus />Ny rubrik</Button>
          {program.commonDuties?.trim() ? <div className="rounded-lg bg-muted/40 p-3" data-testid="role-common-duties">
            <p className="text-xs font-medium text-muted-foreground">Gemensamt för alla roller</p>
            <ProgramText text={program.commonDuties} className="mt-1" />
          </div> : null}
        </div>
      </Panel>
      {role ? <Panel title="Personer med rollen" description="Rollen ges till en person på personens kompetenskort.">
        {/* Each person leads to their competence card (2026-11-24), the register's row with the level to the right. */}
        {people.length ? <ul className="-mx-4 divide-y border-y sm:-mx-5" data-testid="role-people">{people.map((person) => {
          const low = person.level !== null && person.level < draft.level;
          return <RegisterRow key={person.personId} href={selfInspectionHref("cards", { person: person.personId })} label={`Kompetenskortet för ${person.name}`} testId="role-person-link"
            icon={<AreaIcon area="customer" icon={UserRound} />} title={person.name} subtitle={person.card?.ownTitle || undefined}
            badge={low ? <Tag tone="warning">Under nivåkravet {draft.level}</Tag> : undefined}
            aside={person.card?.levelInfo ? personLevelText(person.card.levelInfo) : person.level ? `Nivå ${person.level}` : "Ingen nivå"} />;
        })}</ul> : <p className="text-sm text-muted-foreground">Ingen har rollen ännu. Rollen ges på <Link href={selfInspectionHref("cards")} className="text-primary hover:underline">Kompetenskort</Link>.</p>}
      </Panel> : null}
    </div>
  </DialogPage>;
}

/** The text every role shares, and the company's level limits (part of the draft). */
function RoleSettings({ view, busy, run, onClose }: PartProps & { onClose: () => void }) {
  const program = view.program!;
  const [first, second] = levelYearsOf(program.levelYears);
  const [text, setText] = useState(program.commonDuties ?? "");
  const [limits, setLimits] = useState({ first: String(first), second: String(second) });
  const numbers = [Number(limits.first), Number(limits.second)] as const;
  const valid = Number.isInteger(numbers[0]) && Number.isInteger(numbers[1]) && numbers[0] >= 1 && numbers[1] > numbers[0] && numbers[1] <= 60;
  return <DialogPage pageKey="gemensamt" size="form" open onOpenChange={(next) => { if (!next) onClose(); }} title="Gemensamt för alla roller" panelTitle={false}>
    <div className="space-y-4" data-testid="roles-settings">
      <Field id="si-common-duties" label="Gemensamma uppgifter" value={text} onChange={setText} multiline rows={5} hint="Visas i varje rollbeskrivning och i programmet." />
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Nivågränser i år</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field id="si-level-first" type="number" label="Nivå 2 från" value={limits.first} onChange={(value) => setLimits({ ...limits, first: value })} />
          <Field id="si-level-second" type="number" label="Nivå 3 efter" value={limits.second} onChange={(value) => setLimits({ ...limits, second: value })} />
        </div>
        <p className="text-xs text-muted-foreground" data-testid="roles-level-rule">{valid ? levelRuleText(numbers) : "Den andra gränsen måste vara större än den första."}</p>
      </fieldset>
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", busy, disabledReason: valid ? null : "Kontrollera nivågränserna.", testId: "roles-settings-save", onClick: async () => {
        if (await run({ action: "save_role_settings", revision: program.revision, commonDuties: text, levelYears: [numbers[0], numbers[1]] }, "Det gemensamma är sparat.")) onClose();
      } }} />
    </div>
  </DialogPage>;
}
