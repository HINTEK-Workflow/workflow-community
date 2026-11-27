"use client";

import { useState } from "react";
import { RowChevron } from "@/components/row-chevron";
import { Pencil, Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogActions, Field, Modal, Panel } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import { useConfirm } from "@/features/kfid/confirm";
import { cn } from "@/lib/utils";
import {
  ACTIVITY_GROUPS, ACTIVITY_TYPES, AUTHORIZATION_LEVELS, peopleOverview, programContent, ROLE_CAPABILITIES,
  type ActivityTypeKey, type PersonCompetence, type PersonOverview, type ProgramContent, type ProgramRole, type RoleCapability, type SelfInspectionAction, type SelfInspectionView,
} from "@/lib/self-inspection/model";
import { capabilityLabel, COMPETENCE_HIDDEN_TEXT, limitationsOf, mayDo, orgChart } from "@/lib/self-inspection/outline";
import { LEVELS, LEVEL_TEXTS, toLevel, type Level } from "@/lib/self-inspection/levels";
import { ProgramText, siDate, Tag } from "./shared";
import { RemoveButton } from "@/components/ui/remove-button";

/**
 * Egenkontroll's roles and people in the document (2026-10-06): the organisation chart with clickable roles,
 * the appendix Roller och ansvar and the appendix Personer och kompetens, drawn only to read in the programme (
 * 2026-11-25). The person's assessment is changed on Kompetenskort (ProgramAssessment). Every change is checked again by the backend.
 */
type ContentRole = Omit<ProgramContent["roles"][number], "members"> & { id?: string; members: (ProgramContent["roles"][number]["members"][number] & { authorizationNumber?: string })[] };
/** A change to the draft; the editor fills in the revision it works on. */
export type DraftRun = (action: (revision: number) => SelfInspectionAction, done: string) => Promise<boolean>;
export type EditContext = { view: SelfInspectionView; program: NonNullable<SelfInspectionView["program"]>; busy: boolean; run: DraftRun; namedPeople: boolean };

const personName = (name: string) => name || "Okänd person";
const roleKey = (role: ContentRole) => role.id ?? `${role.key}-${role.name}`;

// ---------- organisation chart ----------

export function OrgChart({ roles, people, edit }: { roles: ContentRole[]; people: PersonOverview[]; edit?: EditContext }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = orgChart(roles);
  if (!rows.length) return <p className="text-sm text-muted-foreground">Programmet har inga roller.</p>;
  // The role shown is read again from the current roles, so a change made in the dialog shows at once.
  const shown = open ? roles.find((role) => roleKey(role) === open) ?? null : null;
  return <div className="rounded-xl border bg-muted/20 p-4" data-testid="self-inspection-org-chart">
    <p className="mb-3 text-xs text-muted-foreground">Välj en roll för att se ansvaret och vem som är utsedd.</p>
    <div className="space-y-1">
      {rows.map((row, index) => <div key={row.label}>
        {index > 0 && <div className="mx-auto h-4 w-px bg-border" aria-hidden="true" />}
        <p className="mb-1.5 text-center text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">{row.label}</p>
        <ul className="flex flex-wrap justify-center gap-2.5">
          {row.roles.map((role) => <li key={roleKey(role)} className="w-full max-w-[15rem] sm:w-auto sm:min-w-[11rem]">
            <button type="button" onClick={() => setOpen(roleKey(role))} aria-haspopup="dialog"
              className="group flex h-full w-full items-start justify-between gap-2 rounded-lg border bg-card px-3 py-2.5 text-left shadow-xs transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring">
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-5">{role.name}</span>
                <span className={cn("mt-0.5 block text-xs", role.members.length ? "text-muted-foreground" : "text-amber-800 dark:text-amber-200")}>
                  {role.members.length ? role.members.map((member) => personName(member.name)).join(", ") : "Ingen utsedd"}
                </span>
                {role.level ? <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground" data-testid="self-inspection-role-level">Nivå {role.level}</span> : null}
              </span>
              <RowChevron className="mt-0.5" />
            </button>
          </li>)}
        </ul>
      </div>)}
    </div>
    {shown && <RoleModal role={shown} people={people} edit={edit} onClose={() => setOpen(null)} />}
  </div>;
}

/** The chosen role unfolds under the chart (plan 1O, 2026-10-11: the page itself, not a popup over it). */
function RoleModal({ role, people, edit, onClose }: { role: ContentRole; people: PersonOverview[]; edit?: EditContext; onClose: () => void }) {
  return <Panel title={role.name} className="mt-4" actions={<Button type="button" variant="ghost" size="sm" onClick={onClose} data-testid="self-inspection-role-close">Fäll ihop</Button>}>
    <div className="space-y-4" data-testid="self-inspection-role-detail">
      <RoleBody role={role} people={people} edit={edit} />
    </div>
  </Panel>;
}

/** A role's responsibility and its people: the same in the chart's dialog and in appendix A. */
function RoleBody({ role, people, edit }: { role: ContentRole; people: PersonOverview[]; edit?: EditContext }) {
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const draftRole = edit && role.id ? edit.program.roles.find((item) => item.id === role.id) : undefined;
  return <>
    {(role.isEre || role.level) && <div className="flex flex-wrap gap-1.5">
      {role.isEre && <Tag tone="primary">Elinstallatör för regelefterlevnad</Tag>}
      {role.level ? <span title={LEVEL_TEXTS[toLevel(role.level)]}><Tag tone="primary">Nivå {role.level}</Tag></span> : null}
    </div>}
    {role.description && <p className="text-sm leading-6">{role.description}</p>}
    {/* Rollbeskrivningar (2026-11-24): the duties under the company's own headings, else the one text as before. */}
    {role.dutyGroups?.length ? <div className="space-y-2" data-testid="self-inspection-role-duty-groups">{role.dutyGroups.map((group, index) => <div key={index}>
      <p className="text-xs font-medium text-muted-foreground">{group.title || "Uppgifter"}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-sm">{group.text.split("\n").filter((line) => line.trim()).map((line, row) => <li key={row}>{line.trim()}</li>)}</ul>
    </div>)}</div> : role.duties && <div><p className="text-xs font-medium text-muted-foreground">Ansvar och uppgifter</p><ProgramText text={role.duties} className="mt-1" /></div>}
    {role.responsibility ? <div><p className="text-xs font-medium text-muted-foreground">Ansvar i organisationen</p><p className="mt-0.5 text-sm">{role.responsibility}</p></div> : null}
    {role.capabilities.length > 0 && <div className="flex flex-wrap gap-1.5">{role.capabilities.map((key) => <Tag key={key}>{capabilityLabel(key)}</Tag>)}</div>}
    <div>
      <p className="text-xs font-medium text-muted-foreground">Utsedda</p>
      {role.members.length ? <ul className="mt-1.5 divide-y rounded-lg border" data-testid="self-inspection-role-members">{role.members.map((member) => {
        const person = people.find((item) => item.personId === member.personId);
        return <li key={member.personId} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="font-medium">{personName(member.name)}</span>
            <span className="block text-xs text-muted-foreground">{[member.authorizationLevel && `Auktorisation ${member.authorizationLevel}`, member.authorizationNumber && `nr ${member.authorizationNumber}`, member.registered && "Står i registreringen"].filter(Boolean).join(" · ")}</span>
            {person && <span className="block text-xs text-muted-foreground">Får utföra: {mayDo(person)} · Begränsningar: {limitationsOf(person)}</span>}
          </span>
          {edit && draftRole && <RemoveButton label={`Ta bort ${member.name} från ${role.name}`} disabled={edit.busy}
            onClick={() => void edit.run((revision) => ({ action: "unassign_role", revision, roleId: draftRole.id, personId: member.personId }), "Personen är borttagen från rollen.")} />}
        </li>;
      })}</ul> : <p className="mt-1.5 text-sm text-muted-foreground">Ingen är utsedd.</p>}
    </div>
    {edit && draftRole && <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => setAssigning(true)}><UserPlus />Lägg till person</Button>
      <Button variant="outline" onClick={() => setEditing(true)}><Pencil />Ändra roll</Button>
    </div>}
    {assigning && edit && draftRole && <AssignDialog role={draftRole} edit={edit} onClose={() => setAssigning(false)} />}
    {editing && edit && draftRole && <RoleDialog edit={edit} role={{ id: draftRole.id, name: draftRole.name, description: draftRole.description, duties: draftRole.duties, isEre: draftRole.isEre, level: toLevel(draftRole.level), capabilities: draftRole.capabilities }} onClose={() => setEditing(false)} />}
  </>;
}

// ---------- appendix A: roles ----------

export function RolesAppendix({ roles, people, edit }: { roles: ContentRole[]; people: PersonOverview[]; edit?: EditContext }) {
  const [creating, setCreating] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  return <div className="space-y-4">
    {confirmElement}
    {edit && <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">Varje roll har en nivå (1–3). Nivån avgör vilka uppgifter personen får arbeta i.</p>
      <Button variant="outline" onClick={() => setCreating(true)}><Plus />Ny roll</Button>
    </div>}
    {roles.map((role) => <section key={role.id ?? `${role.key}-${role.name}`} aria-label={role.name} className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-sm font-semibold">{role.name}</h4>
        {edit && role.id && <RemoveButton label={`Ta bort ${role.name}`} disabled={edit.busy} onClick={async () => {
          if (await confirm({ title: "Ta bort rollen?", message: `”${role.name}” och vilka som har den tas bort ur utkastet. Fastställda versioner påverkas inte.`, confirmLabel: "Ta bort", tone: "danger" }))
            await edit.run((revision) => ({ action: "remove_role", revision, roleId: role.id! }), "Rollen är borttagen ur utkastet.");
        }} />}
      </div>
      <div className="mt-2 space-y-3"><RoleBody role={role} people={people} edit={edit} /></div>
    </section>)}
    {creating && edit && <RoleDialog edit={edit} role={{ name: "", description: "", duties: "", isEre: false, level: 1, capabilities: [] }} onClose={() => setCreating(false)} />}
  </div>;
}

type RoleDraft = { id?: string; name: string; description: string; duties: string; isEre: boolean; level: Level; capabilities: RoleCapability[] };
function RoleDialog({ role, edit, onClose }: { role: RoleDraft; edit: EditContext; onClose: () => void }) {
  const [draft, setDraft] = useState(role);
  return <DialogPage pageKey="roll" size="page" open onOpenChange={(open) => { if (!open) onClose(); }} title={role.id ? "Ändra roll" : "Ny roll"} panelTitle="Rollens uppgifter">
    <div className="space-y-4">
      <Field id="si-role-name" label="Namn" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
      <div className="space-y-1.5">
        <Field id="si-role-level" label="Nivå" value={String(draft.level)} onChange={(value) => setDraft({ ...draft, level: toLevel(Number(value)) })} options={LEVELS.map(String)}
          optionLabels={Object.fromEntries(LEVELS.map((level) => [String(level), LEVEL_TEXTS[level]]))} className="max-w-xl" />
        <p className="text-xs text-muted-foreground">Personens nivå är den högsta bland rollerna.</p>
      </div>
      <label className="grid gap-1.5"><span className="text-xs font-medium">Beskrivning</span><textarea className="form-textarea" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="grid gap-1.5"><span className="text-xs font-medium">Ansvar och uppgifter</span><textarea className="form-textarea min-h-32" value={draft.duties} onChange={(event) => setDraft({ ...draft, duties: event.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.isEre} onCheckedChange={(value) => setDraft({ ...draft, isEre: value === true })} />Elinstallatör för regelefterlevnad</label>
      <fieldset className="field-group rounded-lg border p-3"><legend className="px-1 text-xs font-medium">Rollen i programmet</legend>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{ROLE_CAPABILITIES.map((item) => <label key={item.key} className="flex items-center gap-2 text-sm">
          <Checkbox checked={draft.capabilities.includes(item.key)} onCheckedChange={(value) => setDraft({ ...draft, capabilities: value === true ? [...draft.capabilities, item.key] : draft.capabilities.filter((key) => key !== item.key) })} />{item.label}
        </label>)}</div>
      </fieldset>
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", disabled: edit.busy || !draft.name.trim(), onClick: async () => {
        if (await edit.run((revision) => ({ action: "save_role", revision, role: draft }), draft.id ? "Rollen är ändrad." : "Rollen är tillagd.")) onClose();
      } }} />
    </div>
  </DialogPage>;
}

function AssignDialog({ role, edit, onClose }: { role: ProgramRole; edit: EditContext; onClose: () => void }) {
  const available = edit.view.people.filter((person) => !role.members.some((member) => member.personId === person.id));
  const [personId, setPersonId] = useState("");
  const [name, setName] = useState("");
  const [level, setLevel] = useState<"" | "A" | "AL" | "B">("");
  const [number, setNumber] = useState("");
  const [registered, setRegistered] = useState(false);
  const chosen = edit.namedPeople ? Boolean(name.trim() || personId) : Boolean(personId);
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={`Lägg till person – ${role.name}`} size="form">
    <div className="space-y-4">
      {available.length > 0 && <Field id="si-assign-person" label="Person" value={personId} onChange={setPersonId} options={["", ...available.map((person) => person.id)]}
        optionLabels={{ "": edit.namedPeople ? "Annan person (skriv namnet nedan)" : "Välj…", ...Object.fromEntries(available.map((person) => [person.id, person.name])) }} />}
      {edit.namedPeople && !personId && <Field id="si-assign-name" label="Namn" value={name} onChange={setName} />}
      {!available.length && !edit.namedPeople && <p className="notice">Alla aktiva medlemmar har redan rollen. Bjud in fler under Användare.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="si-assign-level" label="Auktorisation (valfritt)" value={level} onChange={(value) => setLevel(value as typeof level)} options={["", ...AUTHORIZATION_LEVELS]} optionLabels={{ "": "Ingen angiven" }} />
        <Field id="si-assign-number" label="Auktorisationsnummer (valfritt)" value={number} onChange={setNumber} />
      </div>
      <p className="text-xs text-muted-foreground">Auktorisationsnumret syns bara för administratörer och personen själv.</p>
      {role.isEre && <label className="flex items-center gap-2 text-sm"><Checkbox checked={registered} onCheckedChange={(value) => setRegistered(value === true)} />Står i företagets registrering hos Elsäkerhetsverket</label>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Avbryt</Button>
        <Button disabled={edit.busy || !chosen} onClick={async () => {
          if (await edit.run((revision) => ({ action: "assign_role", revision, roleId: role.id, personId: personId || undefined, name: name.trim(), authorizationLevel: level, authorizationNumber: number.trim(), registered }), "Personen har fått rollen.")) onClose();
        }}>Lägg till</Button>
      </div>
    </div>
  </Modal>;
}

// ---------- ERE ----------

export function EreList({ roles }: { roles: ContentRole[] }) {
  const members = roles.filter((role) => role.isEre).flatMap((role) => role.members);
  return <div className="rounded-xl border p-4" data-testid="self-inspection-ere">
    <p className="text-xs font-medium text-muted-foreground">Utsedda elinstallatörer för regelefterlevnad</p>
    {members.length ? <ul className="mt-2 space-y-1.5 text-sm">{members.map((member) => <li key={member.personId} className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{personName(member.name)}</span>
      {member.authorizationLevel && <Tag>Auktorisation {member.authorizationLevel}</Tag>}
      {member.registered && <Tag tone="primary">Står i registreringen</Tag>}
    </li>)}</ul> : <p className="mt-2"><Tag tone="warning">Ingen utsedd</Tag></p>}
  </div>;
}

// ---------- who may do what ----------

/** The compact table in the competence section: person, roles, the work the person may do, limitations. */
export function PeopleTable({ people }: { people: PersonOverview[] }) {
  if (!people.length) return <p className="rounded-xl border p-4 text-sm text-muted-foreground">Inga personer är kopplade till programmet ännu. Ge personer roller i bilaga A.</p>;
  return <div className="overflow-hidden rounded-xl border" data-testid="self-inspection-people-table">
    <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,1.4fr)_minmax(0,1.2fr)] gap-3 bg-muted/60 px-4 py-2 text-xs font-medium text-muted-foreground md:grid" aria-hidden="true">
      <span>Person</span><span>Roller</span><span>Nivå</span><span>Får utföra</span><span>Begränsningar</span>
    </div>
    <ul className="divide-y">{people.map((person) => <li key={person.personId} className="grid gap-1 break-words px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,1.4fr)_minmax(0,1.2fr)] md:gap-3">
      <span className="font-medium">{personName(person.name)}</span>
      <span><span className="text-xs text-muted-foreground md:hidden">Roller: </span>{person.roles.join(", ") || "–"}</span>
      <span data-testid="self-inspection-person-level"><span className="text-xs text-muted-foreground md:hidden">Nivå: </span>{person.level || "–"}</span>
      <span><span className="text-xs text-muted-foreground md:hidden">Får utföra: </span>{mayDo(person)}</span>
      <span className={cn(!person.competence && !person.competenceHidden && person.capabilities.some((key) => key === "perform" || key === "inspect") && "text-amber-800 dark:text-amber-200")}>
        <span className="text-xs text-muted-foreground md:hidden">Begränsningar: </span>{limitationsOf(person)}</span>
    </li>)}</ul>
  </div>;
}

// ---------- appendix B: people and competence ----------

/**
 * Appendix B, only to read (2026-11-25: "vid redigering av egenkontrollprogrammet skall det bara vara den delen (texten),
 * resten sköts från menyknapparna"): the roles are given and the assessment is written on the person's page under Kompetenskort.
 */
export function PeopleAppendix({ people }: { people: PersonOverview[] }) {
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Roller och kompetensbedömning för var och en finns under Kompetenskort. Så fort någon har en roll gäller nivåerna för alla. En medarbetare ser bara sin egen bedömning.</p>
    {!people.length && <p className="rounded-xl border p-4 text-sm text-muted-foreground">Inga personer är kopplade till programmet ännu.</p>}
    <ul className="space-y-3" data-testid="self-inspection-people">{people.map((person) => {
      const doer = person.capabilities.some((key) => key === "perform" || key === "inspect");
      const competence = person.competence;
      return <li key={person.personId} className="rounded-xl border p-4" aria-label={personName(person.name)}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{personName(person.name)}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">{person.roles.length ? person.roles.map((role) => <Tag key={role}>{role}</Tag>) : <Tag>Ingen roll</Tag>}
              {person.level > 0 && <Tag tone="primary">Nivå {person.level}</Tag>}
              {competence?.supervised && <Tag tone="warning">Under handledning</Tag>}</div>
          </div>
        </div>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-medium text-muted-foreground">Får utföra</dt><dd className="mt-0.5">{mayDo(person)}</dd></div>
          <div><dt className="text-xs font-medium text-muted-foreground">Begränsningar</dt><dd className="mt-0.5">{limitationsOf(person)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Kompetensbedömning{competence?.assessedAt ? ` ${siDate(competence.assessedAt)}` : ""}</dt>
            <dd className="mt-0.5 whitespace-pre-line" data-testid="self-inspection-person-assessment">{person.competenceHidden ? <span className="text-muted-foreground">{COMPETENCE_HIDDEN_TEXT}</span>
              : competence?.assessment || (doer ? <Tag tone="warning">Saknas</Tag> : "–")}</dd></div>
        </dl>
      </li>;
    })}</ul>
  </div>;
}

/**
 * The person's assessment in the programme (appendix B) on the person's page under Kompetenskort (2026-11-25): what the
 * person may do, the limitations and what the assessment rests on, with Ändra and Ta bort. It changes the programme's draft and
 * reaches the employees with the next approved version. The roles are ticked in the page's own Roller panel.
 */
/** Local (named people, no member list): a person added by name with an assessment, so the person gets a card and roles. */
export function AddNamedPerson({ view, busy, run, onClose }: { view: SelfInspectionView; busy: boolean; run: (action: SelfInspectionAction, done: string) => Promise<unknown>; onClose: () => void }) {
  const program = view.program;
  if (!program) return null;
  const edit: EditContext = { view, program, busy, namedPeople: true, run: async (build, done) => Boolean(await run(build(view.program?.revision ?? program.revision), done)) };
  const content = programContent(program, undefined, program.extras);
  return <CompetenceDialog edit={edit} personId="" name="" competence={null} activityTypes={program.activityTypes} exclude={peopleOverview(content).map((person) => person.personId)} onClose={onClose} />;
}

export function ProgramAssessment({ view, busy, run, personId, name, editable }: { view: SelfInspectionView; busy: boolean;
  run: (action: SelfInspectionAction, done: string) => Promise<unknown>; personId: string; name: string; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const program = view.program;
  if (!program) return null;
  const content = programContent(program, undefined, program.extras);
  const person = peopleOverview(content).find((item) => item.personId === personId) ?? null;
  const competence = person?.competence ?? null;
  const doer = Boolean(person?.capabilities.some((key) => key === "perform" || key === "inspect"));
  const edit: EditContext = { view, program, busy, namedPeople: false,
    run: async (build, done) => Boolean(await run(build(view.program?.revision ?? program.revision), done)) };
  const actions = editable ? <div className="flex flex-wrap gap-1">
    <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="competence-assessment-edit"><Pencil />{competence ? "Ändra bedömning" : "Lägg till bedömning"}</Button>
    {competence ? <RemoveButton label={`Ta bort bedömningen för ${personName(name)}`} disabled={busy} onClick={async () => {
      if (await confirm({ title: "Ta bort bedömningen?", message: `Bedömningen av ${personName(name)} tas bort ur programmets utkast. Fastställda versioner påverkas inte.`, confirmLabel: "Ta bort", tone: "danger" }))
        await edit.run((revision) => ({ action: "remove_competence", revision, personId }), "Bedömningen är borttagen ur utkastet.");
    }} /> : null}
  </div> : null;
  return <Panel title="Bedömning i egenkontrollprogrammet" description="Står i programmets bilaga B och gäller från nästa fastställda version." actions={actions}>
    {confirmElement}
    <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="competence-assessment">
      <div><dt className="text-xs font-medium text-muted-foreground">Får utföra</dt><dd className="mt-0.5">{person ? mayDo(person) : "–"}</dd></div>
      <div><dt className="text-xs font-medium text-muted-foreground">Begränsningar</dt><dd className="mt-0.5">{person ? limitationsOf(person) : "–"}</dd></div>
      <div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Kompetensbedömning{competence?.assessedAt ? ` ${siDate(competence.assessedAt)}` : ""}</dt>
        <dd className="mt-0.5 whitespace-pre-line">{person?.competenceHidden ? <span className="text-muted-foreground">{COMPETENCE_HIDDEN_TEXT}</span>
          : competence?.assessment || (doer ? <Tag tone="warning">Saknas</Tag> : "–")}</dd></div>
    </dl>
    {editing ? <CompetenceDialog edit={edit} personId={personId} name={name} competence={competence} activityTypes={program.activityTypes} onClose={() => setEditing(false)} /> : null}
  </Panel>;
}

function CompetenceDialog({ edit, personId: initialPerson, name: initialName, competence, activityTypes, exclude = [], onClose }: {
  edit: EditContext; personId: string; name: string; competence: PersonCompetence | null; activityTypes: readonly ActivityTypeKey[]; exclude?: string[]; onClose: () => void;
}) {
  const choosing = !initialPerson;
  const available = edit.view.people.filter((person) => !exclude.includes(person.id));
  const [personId, setPersonId] = useState(initialPerson || "");
  const [name, setName] = useState("");
  const [workTypes, setWorkTypes] = useState<ActivityTypeKey[]>(competence?.workTypes ?? []);
  const [scope, setScope] = useState(competence?.scope ?? "");
  const [assessment, setAssessment] = useState(competence?.assessment ?? "");
  const [assessedAt, setAssessedAt] = useState(competence?.assessedAt ?? "");
  const [limitations, setLimitations] = useState(competence?.limitations ?? "");
  const [supervised, setSupervised] = useState(competence?.supervised ?? false);
  // The company's own activity types first; all of them when none is chosen yet.
  const offered = ACTIVITY_TYPES.filter((type) => !activityTypes.length || activityTypes.includes(type.key) || workTypes.includes(type.key));
  const ready = choosing ? Boolean(personId || (edit.namedPeople && name.trim())) : true;
  return <DialogPage pageKey="kompetens" size="page" open onOpenChange={(open) => { if (!open) onClose(); }} title={choosing ? "Lägg till person" : `Kompetens – ${personName(initialName)}`} panelTitle="Kompetens">
    <div className="space-y-4" data-testid="self-inspection-competence-dialog">
      {choosing && <>
        {available.length > 0 && <Field id="si-competence-person" label="Person" value={personId} onChange={setPersonId} options={["", ...available.map((person) => person.id)]}
          optionLabels={{ "": edit.namedPeople ? "Annan person (skriv namnet nedan)" : "Välj…", ...Object.fromEntries(available.map((person) => [person.id, person.name])) }} />}
        {edit.namedPeople && !personId && <Field id="si-competence-name" label="Namn" value={name} onChange={setName} />}
        {!available.length && !edit.namedPeople && <p className="notice">Alla aktiva medlemmar finns redan med. Bjud in fler under Användare.</p>}
      </>}
      <fieldset className="field-group rounded-lg border p-3">
        <legend className="px-1 text-xs font-medium">Verksamhetstyper personen får arbeta i</legend>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{offered.map((type) => <label key={type.key} className="flex items-center gap-2 text-sm">
          <Checkbox checked={workTypes.includes(type.key)} onCheckedChange={(value) => setWorkTypes((current) => value === true ? [...current, type.key] : current.filter((key) => key !== type.key))} />
          {type.label}{activityTypes.length ? "" : <span className="text-xs text-muted-foreground"> · {ACTIVITY_GROUPS.find((group) => group.key === type.group)?.label}</span>}
        </label>)}</div>
      </fieldset>
      <label className="grid gap-1.5"><span className="text-xs font-medium">Arbeten personen får utföra (egna ord)</span>
        <textarea className="form-textarea" value={scope} onChange={(event) => setScope(event.target.value)} placeholder="Till exempel service och mindre ändringar i bostäder" /></label>
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <label className="grid gap-1.5"><span className="text-xs font-medium">Kompetensbedömning – vad bygger den på?</span>
          <textarea className="form-textarea" value={assessment} onChange={(event) => setAssessment(event.target.value)} placeholder="Utbildning, erfarenhet och arbeten personen har gjort" /></label>
        <Field id="si-competence-date" type="date" label="Bedömd" value={assessedAt} onChange={setAssessedAt} />
      </div>
      <label className="grid gap-1.5"><span className="text-xs font-medium">Begränsningar</span>
        <textarea className="form-textarea" value={limitations} onChange={(event) => setLimitations(event.target.value)} placeholder="Till exempel inga arbeten nära spänning" /></label>
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={supervised} onCheckedChange={(value) => setSupervised(value === true)} />Arbetar under handledning</label>
        <p className="pl-6 text-xs text-muted-foreground">Personen får arbeta i uppgifter över sin nivå när en handledare med rätt nivå är ansvarig.</p>
      </div>
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", disabled: edit.busy || !ready, onClick: async () => {
        const value = { personId: personId || `named:${name.trim().toLocaleLowerCase("sv")}`, name: name.trim(), workTypes, scope, assessment, assessedAt: assessedAt || null, limitations, supervised };
        if (await edit.run((revision) => ({ action: "save_competence", revision, competence: value }), "Kompetensuppgifterna är sparade i utkastet.")) onClose();
      } }} />
    </div>
  </DialogPage>;
}
