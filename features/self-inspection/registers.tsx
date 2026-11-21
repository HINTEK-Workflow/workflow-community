"use client";

import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GraduationCap, History, IdCard, MessageSquarePlus, Paperclip, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogActions, Empty, Field, Modal, Panel } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import { useConfirm } from "@/features/kfid/confirm";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { announce } from "@/lib/workflow/toast";
import { swedishDayKey } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import {
  CREDENTIAL_ORDER_MESSAGE, LANGUAGE_LEVELS, LICENCE_CLASSES, peopleOverview,
  type CardVersion, type CompetenceCardView, type CredentialView, type DueState, type LanguageLevel, type LicenceClass, type SelfInspectionView,
} from "@/lib/self-inspection/model";
import { competenceCsv } from "@/lib/self-inspection/competence-export";
import { siDate, Tag, type CredentialFilesApi, type Run } from "./shared";
import { ListEmpty, ListFact, ListGroup, ListRow, NativeActions, NativePage, useNativeTopBar } from "@/components/native";
import { useShowMoreNote } from "@/features/workflow/use-detail-level";
import type { IndicatorTone } from "@/features/workflow/indicator-tone";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { saveBlob } from "@/lib/download";
import { DownloadButton } from "@/components/ui/download-button";

/**
 * Egenkontroll etapp 2–3 (2026-10-06): the registers beside the programme – competence cards per person. The
 * instrument register has a page of its own since 2026-10-07 (./instruments.tsx) and a customer's special requirements are
 * a field on the customer card. Drawing only; the backend decides who may do what.
 */
const STATE_LABEL: Record<DueState, string> = { NONE: "Inget slutdatum", OK: "Giltig", DUE_SOON: "Går ut inom 30 dagar", OVERDUE: "Har gått ut" };
const stateTone = (state: DueState) => state === "OVERDUE" ? "danger" : state === "DUE_SOON" ? "warning" : state === "OK" ? "success" : "neutral";
export function StateBadge({ state, labels = STATE_LABEL }: { state: DueState; labels?: Record<DueState, string> }) {
  return <span className={cn("rounded-full border px-2.5 py-0.5 text-xs", indicatorBadge(stateTone(state)))}>{labels[state]}</span>;
}
const dayOrNull = (value: string) => value || null;
const kilobytes = (size: number) => size < 100_000 ? `${Math.max(1, Math.ceil(size / 1024))} kB` : `${(size / 1_000_000).toFixed(1).replace(".", ",")} MB`;
const languageText = (item: { language: string; level: LanguageLevel }) => `${item.language} – ${LANGUAGE_LEVELS[item.level].toLocaleLowerCase("sv")}`;

// ---------- competence cards ----------

type CredentialDraft = { id?: string; personId: string; title: string; provider: string; issuedAt: string; validUntil: string; note: string };
type CardDraft = { personId: string; fixed: boolean; groupIds: string[]; licenceClasses: LicenceClass[]; licenceValidUntil: string; languages: { language: string; level: LanguageLevel }[] };
type Person = { personId: string; name: string; items: CredentialView[]; card: CompetenceCardView | null; savedUntil: string | null };

/**
 * Kompetenskort: a card per person with the trainings and certificates, and since v2 (2026-10-08) the company's
 * competence groups, driving licence, languages and a history of every save (admins all cards, a member their own). A
 * member suggests a change of their own card; an admin edits. A person who left the company keeps the card for three
 * months – "Sparas till …" – and then it is deleted by the nightly job; an admin can delete any card at once.
 * Certificates are attached to a line (`files`, Cloud only).
 */
export function CompetenceTab({ view, busy, run, files, history, reload, native = false }: { view: SelfInspectionView; busy: boolean; run: Run; files?: CredentialFilesApi;
  history?: (personId: string) => Promise<CardVersion[]>; reload: () => Promise<void>;
  /** Nivå 1 på mobil: the people as rows, a person's card as a screen of its own (`&person=`). */
  native?: boolean }) {
  const personParam = useSearchParams().get("person");
  const [draft, setDraft] = useState<CredentialDraft | null>(null);
  const [cardDraft, setCardDraft] = useState<CardDraft | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<{ personId: string; name: string; versions: CardVersion[] | null } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploadFor = useRef<string | null>(null);
  // Admins choose among the company's people and the people already in the programme (named ones in Local).
  const people = useMemo(() => {
    const known = new Map(view.people.map((person) => [person.id, person.name]));
    if (view.program) for (const person of peopleOverview({ roles: view.program.roles, people: view.program.people })) if (!known.has(person.personId)) known.set(person.personId, person.name);
    return [...known].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "sv"));
  }, [view.people, view.program]);
  const byPerson = useMemo(() => {
    const groups = new Map<string, Person>();
    const person = (personId: string, name: string) => groups.get(personId) ?? { personId, name: name || "Okänd person", items: [], card: null, savedUntil: null };
    for (const item of view.credentials) {
      const group = person(item.personId, item.name);
      group.items.push(item);
      group.savedUntil ??= item.savedUntil;
      groups.set(item.personId, group);
    }
    for (const card of view.competenceCards ?? []) {
      const group = person(card.personId, card.name);
      group.card = card;
      group.savedUntil ??= card.savedUntil;
      groups.set(card.personId, group);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "sv"));
  }, [view.credentials, view.competenceCards]);
  const groups = view.competenceGroups ?? [];
  const myCard = byPerson.find((person) => person.personId === view.me.id);

  const remove = async (item: CredentialView) => {
    if (!await confirm({ title: "Ta bort utbildningen?", message: `${item.title} tas bort från ${item.name || "personens"} kompetenskort${item.files.length ? `, med ${item.files.length === 1 ? "den bifogade filen" : "de bifogade filerna"}` : ""}.`, confirmLabel: "Ta bort", tone: "danger" })) return;
    await run({ action: "remove_credential", id: item.id }, "Utbildningen är borttagen.");
  };
  // The whole card at any time (2026-10-07), in the in-app confirmation card.
  const removeCard = async (personId: string, name: string, left: boolean) => {
    if (!await confirm({ title: "Ta bort kompetenskortet?", message: `Hela kortet för ${name} tas bort${left ? " innan de tre månaderna har gått" : ""}. Det går inte att ångra.`, confirmLabel: "Ta bort kortet", tone: "danger" })) return;
    await run({ action: "remove_credential_card", personId }, "Kompetenskortet är borttaget.");
  };
  const attach = async (credentialId: string, picked: File[]) => {
    if (!files || !picked.length) return;
    setUploading(true);
    try {
      for (const file of picked) await files.upload(credentialId, file);
      announce(picked.length === 1 ? "Filen är tillagd." : "Filerna är tillagda.");
    } catch (cause) { announce((cause as Error).message, true); } finally { setUploading(false); await reload(); }
  };
  const removeFile = async (file: CredentialView["files"][number]) => {
    if (!files || !await confirm({ title: "Ta bort filen?", message: `${file.filename} tas bort från utbildningen.`, confirmLabel: "Ta bort", tone: "danger" })) return;
    setUploading(true);
    try { await files.remove(file.id); announce("Filen är borttagen."); } catch (cause) { announce((cause as Error).message, true); } finally { setUploading(false); await reload(); }
  };
  const openCard = (personId: string, fixed: boolean) => {
    const card = byPerson.find((person) => person.personId === personId)?.card;
    setCardDraft({ personId, fixed, groupIds: card?.groupIds ?? [], licenceClasses: card?.licenceClasses ?? [], licenceValidUntil: card?.licenceValidUntil ?? "", languages: card?.languages ?? [] });
  };
  const openHistory = async (personId: string, name: string) => {
    if (!history) return;
    setHistoryOf({ personId, name, versions: null });
    try { setHistoryOf({ personId, name, versions: await history(personId) }); } catch (cause) { announce((cause as Error).message, true); setHistoryOf(null); }
  };
  const exportCsv = () => {
    saveBlob(competenceCsv(view.credentials, view.competenceCards ?? []), `kompetenskort-${swedishDayKey(new Date())}.csv`, "text/csv;charset=utf-8");
  };

  const dialogs = <>
    {draft && <DialogPage pageKey="utbildning" size="page" open onOpenChange={(open) => { if (!open) setDraft(null); }} title={draft.id ? "Ändra utbildning" : "Lägg till utbildning"} panelTitle="Utbildning">
      <div className="space-y-4">
        <Field id="si-credential-person" label="Person" value={draft.personId} onChange={(personId) => setDraft({ ...draft, personId })} options={people.map((person) => person.id)} optionLabels={Object.fromEntries(people.map((person) => [person.id, person.name]))} />
        <Field id="si-credential-title" label="Utbildning eller intyg" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} />
        <Field id="si-credential-provider" label="Utbildare" value={draft.provider} onChange={(provider) => setDraft({ ...draft, provider })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="si-credential-issued" type="date" label="Genomförd" value={draft.issuedAt} onChange={(issuedAt) => setDraft({ ...draft, issuedAt })} />
          <Field id="si-credential-valid" type="date" label="Giltig till" value={draft.validUntil} onChange={(validUntil) => setDraft({ ...draft, validUntil })} />
        </div>
        <label className="grid gap-1.5"><span className="text-xs font-medium">Anteckning</span><textarea className="form-textarea" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        <p className="text-xs text-muted-foreground">Visas bara för administratörer och personen själv.{files ? " Intyg bifogas när utbildningen är sparad (högst 10 MB per fil)." : ""}</p>
        <DialogActions cancel={{ onClick: () => setDraft(null) }} primary={{ label: "Spara", icon: <GraduationCap />, disabled: busy || !draft.title.trim() || !draft.personId, testId: "credential-save", onClick: async () => {
            if (draft.issuedAt && draft.validUntil && draft.validUntil < draft.issuedAt) { announce(CREDENTIAL_ORDER_MESSAGE, true); return; }
            const done = await run({ action: "save_credential", credential: { ...(draft.id ? { id: draft.id } : {}), personId: draft.personId, name: people.find((person) => person.id === draft.personId)?.name ?? "",
              title: draft.title, provider: draft.provider, issuedAt: dayOrNull(draft.issuedAt), validUntil: dayOrNull(draft.validUntil), note: draft.note } }, draft.id ? "Utbildningen är uppdaterad." : "Utbildningen är tillagd.");
            if (done) setDraft(null);
          } }} />
      </div>
    </DialogPage>}

    {cardDraft && <CardModal draft={cardDraft} setDraft={setCardDraft} people={people} groups={groups} byPerson={byPerson} busy={busy} onSave={async () => {
      const done = await run({ action: "save_competence_card", card: { personId: cardDraft.personId, name: people.find((person) => person.id === cardDraft.personId)?.name ?? "", groupIds: cardDraft.groupIds,
        licenceClasses: cardDraft.licenceClasses, licenceValidUntil: dayOrNull(cardDraft.licenceValidUntil), languages: cardDraft.languages.filter((item) => item.language.trim()) } }, "Kompetenskortet är sparat.");
      if (done) setCardDraft(null);
    }} />}

    {groupsOpen && <GroupsModal view={view} busy={busy} run={run} onClose={() => setGroupsOpen(false)} />}

    {suggesting !== null && <Modal open onOpenChange={(open) => { if (!open) setSuggesting(null); }} title="Föreslå en ändring av ditt kompetenskort" size="compact">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Skriv vad som saknas eller är fel. Administratören får förslaget.</p>
        <label className="grid gap-1.5"><span className="text-xs font-medium">Förslag</span>
          <textarea className="form-textarea" maxLength={2000} value={suggesting} onChange={(event) => setSuggesting(event.target.value)} data-testid="competence-suggest-text" /></label>
        <DialogActions cancel={{ onClick: () => setSuggesting(null) }} primary={{ label: "Skicka förslaget", icon: <MessageSquarePlus />, disabled: busy || !suggesting.trim(), testId: "competence-suggest-send", onClick: async () => {
          if (await run({ action: "suggest_competence_change", text: suggesting }, "Förslaget är skickat till administratören.")) setSuggesting(null);
        } }} />
      </div>
    </Modal>}

    {historyOf && <DialogPage pageKey="historik" size="page" open onOpenChange={(open) => { if (!open) setHistoryOf(null); }} title={`Historik – ${historyOf.name}`} panelTitle="Versioner av kompetenskortet">
      {historyOf.versions === null ? <p role="status" className="text-sm">Hämtar historiken…</p>
        : historyOf.versions.length ? <ol className="max-h-[60vh] space-y-2 overflow-y-auto" data-testid="competence-history">{historyOf.versions.map((version) => <li key={version.id} className="rounded-lg border p-3">
          <details>
            <summary className="cursor-pointer text-sm"><span className="font-medium">Version {version.number}</span> · {siDate(version.savedAt)}{version.savedByName ? ` · ${version.savedByName}` : ""}
              {version.change ? <span className="block text-xs text-muted-foreground">{version.change}</span> : null}</summary>
            <div className="mt-2 space-y-1 text-sm">
              {version.content.trainings.length ? <ul className="list-disc space-y-0.5 pl-5">{version.content.trainings.map((item, index) => <li key={index}>{[item.title, item.provider, item.issuedAt && `genomförd ${siDate(item.issuedAt)}`, item.validUntil && `giltig till ${siDate(item.validUntil)}`, item.files.length ? `${item.files.length} ${item.files.length === 1 ? "fil" : "filer"}` : ""].filter(Boolean).join(" · ")}</li>)}</ul>
                : <p className="text-muted-foreground">Inga utbildningar.</p>}
              <p><span className="text-muted-foreground">Kompetensgrupper:</span> {version.content.groups.join(", ") || "inga"}</p>
              <p><span className="text-muted-foreground">Körkort:</span> {[version.content.licenceClasses.join(", "), version.content.licenceValidUntil ? `giltigt till ${siDate(version.content.licenceValidUntil)}` : ""].filter(Boolean).join(" · ") || "inte angivet"}</p>
              <p><span className="text-muted-foreground">Språk:</span> {version.content.languages.map(languageText).join(", ") || "inte angivet"}</p>
            </div>
          </details>
        </li>)}</ol>
        : <p className="text-sm text-muted-foreground">Ingen historik ännu. Varje sparning av kortet sparas som en version.</p>}
    </DialogPage>}
  </>;
  const fileField = files ? <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,.docx,.xlsx" className="sr-only" aria-label="Ladda upp intyg" data-testid="credential-file-input"
    onChange={(event) => { const picked = Array.from(event.target.files ?? []); event.target.value = ""; if (uploadFor.current) void attach(uploadFor.current, picked); }} /> : null;
  const newCredential = (personId: string) => setDraft({ personId, title: "", provider: "", issuedAt: "", validUntil: "", note: "" });

  if (native) return <NativeCompetence view={view} busy={busy} run={run} files={files} byPerson={byPerson} personId={personParam} hasHistory={Boolean(history)}
    onNew={(personId) => newCredential(personId ?? people[0]?.id ?? "")} canNew={people.length > 0}
    onEdit={(item) => setDraft({ id: item.id, personId: item.personId, title: item.title, provider: item.provider ?? "", issuedAt: item.issuedAt ?? "", validUntil: item.validUntil ?? "", note: item.note })}
    onCard={openCard} onGroups={() => setGroupsOpen(true)} onExport={exportCsv} onSuggest={() => setSuggesting(myCard?.card?.suggestion ?? "")}
    onHistory={(personId, name) => void openHistory(personId, name)} onRemoveCard={(personId, name, left) => void removeCard(personId, name, left)}
    onAttach={(credentialId) => { uploadFor.current = credentialId; fileInput.current?.click(); }} uploading={uploading}>
    {confirmElement}{fileField}{dialogs}
  </NativeCompetence>;

  return <div className="space-y-5">
    {confirmElement}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">{view.canEdit
        ? "Utbildningar, grupper, körkort och språk per person. Klockan påminner 30 dagar innan något går ut. Kortet sparas i tre månader när personen lämnar."
        : "Ditt kompetenskort. Administratören håller kortet aktuellt – föreslå en ändring om något saknas."}</p>
      <div className="flex flex-wrap gap-2">
        {view.canEdit ? <>
          <Button onClick={() => newCredential(people[0]?.id ?? "")} disabled={!people.length}><Plus />Lägg till utbildning</Button>
          <Button variant="outline" onClick={() => openCard(people[0]?.id ?? "", false)} disabled={!people.length} data-testid="competence-card-open"><IdCard />Körkort, språk, grupper</Button>
          <Button variant="outline" onClick={() => setGroupsOpen(true)} data-testid="competence-groups-open"><Tags />Kompetensgrupper</Button>
          <DownloadButton onClick={exportCsv} disabled={!byPerson.length} data-testid="competence-export">Exportera CSV</DownloadButton>
        </> : <Button variant="outline" onClick={() => setSuggesting(myCard?.card?.suggestion ?? "")} data-testid="competence-suggest-open"><MessageSquarePlus />Föreslå ändring</Button>}
      </div>
    </div>
    {fileField}
    {byPerson.length ? <div className="space-y-4" data-testid="self-inspection-competence-cards">{byPerson.map((person) => {
      const left = person.savedUntil !== null;
      const card = person.card;
      return <Panel key={person.personId} title={person.name} description={left ? "Kompetenskort · har lämnat företaget" : "Kompetenskort"}
        actions={<div className="flex flex-wrap gap-2">
          {history ? <Button size="sm" variant="outline" aria-label={`Historik för ${person.name}`} data-testid="competence-history-open" onClick={() => void openHistory(person.personId, person.name)}><History />Historik</Button> : null}
          {view.canEdit && !left ? <Button size="sm" variant="outline" aria-label={`Ändra körkort, språk och grupper för ${person.name}`} onClick={() => openCard(person.personId, true)}><Pencil />Ändra</Button> : null}
          {view.canEdit ? <Button size="sm" variant="outline" disabled={busy} aria-label={`Ta bort kompetenskortet för ${person.name}`} data-testid="credential-card-remove" onClick={() => void removeCard(person.personId, person.name, left)}><Trash2 />Ta bort kortet</Button> : null}
        </div>}>
        {left ? <p className="notice mb-4 flex flex-wrap items-center gap-2" data-testid="credential-saved-until"><Tag tone="warning">Har lämnat företaget</Tag><span>Sparas till {siDate(person.savedUntil)}. Därefter raderas kortet automatiskt{view.canEdit ? ", eller så tar du bort det tidigare" : ""}.</span></p> : null}
        {card?.suggestion ? <div className={cn("mb-4 rounded-lg border p-3 text-sm", indicatorBadge("warning"))} data-testid="competence-suggestion">
          <p className="text-xs font-medium">{person.personId === view.me.id ? "Ditt förslag" : "Förslag från personen"}{card.suggestedAt ? `, ${siDate(card.suggestedAt)}` : ""}</p>
          <p className="mt-1 whitespace-pre-line">{card.suggestion}</p>
          {view.canEdit ? <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => void run({ action: "clear_competence_suggestion", personId: person.personId }, "Förslaget är markerat som klart.")}>Klart</Button> : null}
        </div> : null}
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Utbildningar och intyg</h3>
        {person.items.length ? <ul className="divide-y">{person.items.map((item) => <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0" data-testid="credential-line">
          <div className="min-w-0">
            <p className="text-sm font-medium">{item.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{[item.provider, item.issuedAt && `Genomförd ${siDate(item.issuedAt)}`, item.validUntil && `giltig till ${siDate(item.validUntil)}`].filter(Boolean).join(" · ") || "Inga datum angivna"}</p>
            {item.note && <p className="mt-1 whitespace-pre-line text-sm">{item.note}</p>}
            {item.files.length || (files && view.canEdit && !left) ? <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="credential-files">
              {item.files.map((file) => <span key={file.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs" data-testid="credential-file">
                <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                {files ? <a href={files.href(file.id)} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline" aria-label={`Öppna ${file.filename}`}>{file.filename}</a> : <span className="min-w-0 truncate">{file.filename}</span>}
                <span className="shrink-0 text-muted-foreground">{kilobytes(file.size)}</span>
                {view.canEdit && files ? <button type="button" className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Ta bort filen ${file.filename}`} disabled={uploading} onClick={() => void removeFile(file)}><X className="size-3" /></button> : null}
              </span>)}
              {files && view.canEdit && !left ? <Button type="button" size="sm" variant="outline" className="h-7" disabled={uploading || busy || item.files.length >= 10} aria-label={`Lägg till fil på ${item.title}`} onClick={() => { uploadFor.current = item.id; fileInput.current?.click(); }}><Paperclip />Lägg till fil</Button> : null}
            </div> : null}
          </div>
          <div className="flex items-center gap-1">
            <StateBadge state={item.state} />
            {view.canEdit && <>
              {!left && <IconButton label={`Ändra ${item.title}`} onClick={() => setDraft({ id: item.id, personId: item.personId, title: item.title, provider: item.provider ?? "", issuedAt: item.issuedAt ?? "", validUntil: item.validUntil ?? "", note: item.note })}><Pencil /></IconButton>}
              <RemoveButton label={`Ta bort ${item.title}`} disabled={busy} onClick={() => void remove(item)} />
            </>}
          </div>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga utbildningar registrerade.</p>}
        <dl className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-3" data-testid="competence-card-facts">
          <div className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">Kompetensgrupper</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">{card?.groupNames.length ? card.groupNames.map((name) => <Tag key={name} tone="primary">{name}</Tag>) : <span className="text-muted-foreground">Inga</span>}</dd></div>
          <div className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">Körkort</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2">{card && (card.licenceClasses.length || card.licenceValidUntil)
              ? <><span>{card.licenceClasses.join(", ") || "Behörighet inte angiven"}{card.licenceValidUntil ? ` · giltigt till ${siDate(card.licenceValidUntil)}` : ""}</span>{card.licenceValidUntil ? <StateBadge state={card.licenceState} /> : null}</>
              : <span className="text-muted-foreground">Inte angivet</span>}</dd></div>
          <div className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">Språk</dt>
            <dd className="mt-1">{card?.languages.length ? card.languages.map(languageText).join(", ") : <span className="text-muted-foreground">Inte angivet</span>}</dd></div>
        </dl>
      </Panel>;
    })}</div> : <Empty title="Inga kompetenskort ännu" description={view.canEdit ? "Lägg till utbildningar och intyg, körkort, språk och kompetensgrupper för personerna i programmet." : "Inget är registrerat för dig ännu. Föreslå en ändring om något saknas."} />}

    {dialogs}
  </div>;
}

const DUE_PILL: Record<DueState, { label: string; tone: IndicatorTone } | null> = {
  NONE: null, OK: { label: "Giltig", tone: "success" }, DUE_SOON: { label: "Går ut snart", tone: "warning" }, OVERDUE: { label: "Har gått ut", tone: "danger" },
};
/** The most urgent state on a card: something that has run out, then something running out soon. */
function cardState(person: Person): DueState {
  const states = [...person.items.map((item) => item.state), ...(person.card?.licenceValidUntil ? [person.card.licenceState] : [])];
  return states.includes("OVERDUE") ? "OVERDUE" : states.includes("DUE_SOON") ? "DUE_SOON" : states.includes("OK") ? "OK" : "NONE";
}

/**
 * Kompetenskort at level 1 on a phone (2026-10-10: the phone's own lists): the people as rows with the most
 * urgent state; a person's card is a screen of its own (`&person=`) – the trainings and certificates as rows (a tap
 * opens the shared form, a screen with Avbryt/Spara), the attached files as links, the card's facts (groups, driving
 * licence, languages) and the card's actions as rows. The dialogs, rights and server rules are the same as on the computer.
 */
function NativeCompetence({ view, busy, run, files, byPerson, personId, hasHistory, onNew, canNew, onEdit, onCard, onGroups, onExport, onSuggest, onHistory, onRemoveCard, onAttach, uploading, children }: {
  view: SelfInspectionView; busy: boolean; run: Run; files?: CredentialFilesApi; byPerson: Person[]; personId: string | null; hasHistory: boolean;
  onNew: (personId?: string) => void; canNew: boolean; onEdit: (item: CredentialView) => void; onCard: (personId: string, fixed: boolean) => void; onGroups: () => void; onExport: () => void;
  onSuggest: () => void; onHistory: (personId: string, name: string) => void; onRemoveCard: (personId: string, name: string, left: boolean) => void; onAttach: (credentialId: string) => void;
  uploading: boolean; children: React.ReactNode;
}) {
  const person = personId ? byPerson.find((item) => item.personId === personId) ?? null : null;
  useNativeTopBar({ title: person ? person.name : "Kompetenskort" });
  // Removing a training is office work: on a phone the ordinary page with Visa mer (A2).
  const removeNote = useShowMoreNote("Att ta bort en utbildning eller ett intyg görs i visning 2 (Lagom).");
  const personHref = (id: string) => `/?view=self_inspection&tab=competence&person=${encodeURIComponent(id)}`;
  if (personId) {
    if (!person) return <NativePage testId="native-competence-card"><ListGroup><ListEmpty>Kortet finns inte längre.</ListEmpty></ListGroup>{children}</NativePage>;
    const left = person.savedUntil !== null;
    const card = person.card;
    const licenceWarning = Boolean(card?.licenceValidUntil && (card.licenceState === "OVERDUE" || card.licenceState === "DUE_SOON"));
    return <NativePage testId="native-competence-card">
      {left ? <ListGroup testId="credential-saved-until"><ListFact label="Har lämnat företaget" tone="warning">Sparas till {siDate(person.savedUntil)}. Därefter raderas kortet automatiskt{view.canEdit ? ", eller så tar du bort det tidigare" : ""}.</ListFact></ListGroup> : null}
      {card?.suggestion ? <ListGroup title={person.personId === view.me.id ? "Ditt förslag" : "Förslag från personen"} testId="competence-suggestion">
        <ListFact label={card.suggestedAt ? siDate(card.suggestedAt) : "Förslag"} tone="warning">{card.suggestion}</ListFact>
      </ListGroup> : null}
      {card?.suggestion && view.canEdit ? <NativeActions><Button type="button" variant="ghost" disabled={busy} onClick={() => void run({ action: "clear_competence_suggestion", personId: person.personId }, "Förslaget är markerat som klart.")}>Markera förslaget som klart</Button></NativeActions> : null}
      <ListGroup title="Utbildningar och intyg" testId="native-credentials">
        {person.items.length ? person.items.map((item) => <ListRow key={item.id} title={item.title} twoLines testId="credential-line"
          subtitle={[item.provider, item.issuedAt && `Genomförd ${siDate(item.issuedAt)}`, item.validUntil && `giltig till ${siDate(item.validUntil)}`, item.files.length ? `${item.files.length} ${item.files.length === 1 ? "fil" : "filer"}` : ""].filter(Boolean).join(" · ") || "Inga datum angivna"}
          pill={DUE_PILL[item.state]} onClick={view.canEdit && !left ? () => onEdit(item) : undefined} ariaLabel={view.canEdit && !left ? `Ändra ${item.title}` : undefined} />)
          : <ListEmpty>Inga utbildningar registrerade.</ListEmpty>}
      </ListGroup>
      {person.items.some((item) => item.files.length) ? <NativeActions title="Intyg" testId="credential-files">
        {person.items.flatMap((item) => item.files.map((file) => files
          ? <a key={file.id} href={files.href(file.id)} target="_blank" rel="noreferrer" data-testid="credential-file"><Paperclip />{`${file.filename} · ${kilobytes(file.size)}`}</a>
          : <span key={file.id} className="flex min-h-13 items-center gap-3 px-3.5 text-[0.9375rem]" data-testid="credential-file"><Paperclip className="size-[1.125rem]" aria-hidden="true" />{file.filename}</span>))}
      </NativeActions> : null}
      <ListGroup title="Kortet" testId="competence-card-facts">
        <ListFact label="Kompetensgrupper">{card?.groupNames.length ? card.groupNames.join(", ") : "Inga"}</ListFact>
        <ListFact label={card?.licenceValidUntil && DUE_PILL[card.licenceState] ? `Körkort · ${DUE_PILL[card.licenceState]!.label}` : "Körkort"} tone={licenceWarning ? "warning" : undefined}>
          {card && (card.licenceClasses.length || card.licenceValidUntil) ? `${card.licenceClasses.join(", ") || "Behörighet inte angiven"}${card.licenceValidUntil ? ` · giltigt till ${siDate(card.licenceValidUntil)}` : ""}` : "Inte angivet"}
        </ListFact>
        <ListFact label="Språk">{card?.languages.length ? card.languages.map(languageText).join(", ") : "Inte angivet"}</ListFact>
      </ListGroup>
      <NativeActions testId="native-competence-actions" footer={view.canEdit ? removeNote : undefined}>
        {view.canEdit && !left ? <Button type="button" variant="ghost" disabled={!canNew} onClick={() => onNew(person.personId)}><Plus />Lägg till utbildning</Button> : null}
        {view.canEdit && !left ? <Button type="button" variant="ghost" onClick={() => onCard(person.personId, true)}><IdCard />Ändra körkort, språk och grupper</Button> : null}
        {files && view.canEdit && !left ? person.items.filter((item) => item.files.length < 10).map((item) => <Button key={item.id} type="button" variant="ghost" disabled={uploading || busy} onClick={() => onAttach(item.id)}><Paperclip />Lägg till intyg på {item.title}</Button>) : null}
        {!view.canEdit && person.personId === view.me.id ? <Button type="button" variant="ghost" onClick={onSuggest} data-testid="competence-suggest-open"><MessageSquarePlus />Föreslå ändring</Button> : null}
        {hasHistory ? <Button type="button" variant="ghost" onClick={() => onHistory(person.personId, person.name)} data-testid="competence-history-open"><History />Historik</Button> : null}
        {view.canEdit ? <Button type="button" variant="ghost" className="!text-destructive" disabled={busy} onClick={() => onRemoveCard(person.personId, person.name, left)} data-testid="credential-card-remove"><Trash2 />Ta bort kortet</Button> : null}
      </NativeActions>
      {children}
    </NativePage>;
  }
  return <NativePage testId="native-competence">
    <ListGroup title={view.canEdit ? "Personer" : undefined} testId="self-inspection-competence-cards"
      footer={view.canEdit ? "Klockan påminner 30 dagar innan något går ut. Kortet sparas i tre månader när personen lämnar." : "Ditt kompetenskort. Administratören håller kortet aktuellt – föreslå en ändring om något saknas."}>
      {byPerson.length ? byPerson.map((item) => {
        const left = item.savedUntil !== null;
        const state = cardState(item);
        return <ListRow key={item.personId} type="customer" icon={GraduationCap} title={item.name} href={personHref(item.personId)} testId="native-competence-person"
          subtitle={[`${item.items.length} ${item.items.length === 1 ? "utbildning" : "utbildningar"}`, item.card?.licenceClasses.length ? `körkort ${item.card.licenceClasses.join(", ")}` : "", item.card?.suggestion ? "förslag att se över" : ""].filter(Boolean).join(" · ")}
          pill={left ? { label: "Har lämnat", tone: "neutral" } : state === "OVERDUE" || state === "DUE_SOON" ? DUE_PILL[state] : null} />;
      }) : <ListEmpty>{view.canEdit ? "Inga kompetenskort ännu." : "Inget är registrerat för dig ännu."}</ListEmpty>}
    </ListGroup>
    <NativeActions>
      {view.canEdit ? <>
        <Button type="button" variant="ghost" disabled={!canNew} onClick={() => onNew()}><Plus />Lägg till utbildning</Button>
        <Button type="button" variant="ghost" disabled={!canNew} onClick={() => onCard(byPerson[0]?.personId ?? "", false)} data-testid="competence-card-open"><IdCard />Körkort, språk och grupper</Button>
        <Button type="button" variant="ghost" onClick={onGroups} data-testid="competence-groups-open"><Tags />Kompetensgrupper</Button>
        <DownloadButton variant="ghost" disabled={!byPerson.length} onClick={onExport} data-testid="competence-export">Exportera CSV</DownloadButton>
      </> : <Button type="button" variant="ghost" onClick={onSuggest} data-testid="competence-suggest-open"><MessageSquarePlus />Föreslå ändring</Button>}
    </NativeActions>
    {children}
  </NativePage>;
}


/** Driving licence, languages and the company's groups of one person (admins). */
function CardModal({ draft, setDraft, people, groups, byPerson, busy, onSave }: { draft: CardDraft; setDraft: (draft: CardDraft | null) => void; people: { id: string; name: string }[];
  groups: SelfInspectionView["competenceGroups"]; byPerson: Person[]; busy: boolean; onSave: () => Promise<void> }) {
  const choose = (personId: string) => {
    const card = byPerson.find((person) => person.personId === personId)?.card;
    setDraft({ ...draft, personId, groupIds: card?.groupIds ?? [], licenceClasses: card?.licenceClasses ?? [], licenceValidUntil: card?.licenceValidUntil ?? "", languages: card?.languages ?? [] });
  };
  const toggle = <T extends string>(list: T[], value: T) => list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  const name = people.find((person) => person.id === draft.personId)?.name ?? byPerson.find((person) => person.personId === draft.personId)?.name ?? "";
  return <DialogPage pageKey="kompetenskort" size="page" open onOpenChange={(open) => { if (!open) setDraft(null); }} title={draft.fixed ? `Körkort, språk och grupper – ${name}` : "Körkort, språk och grupper"} panelTitle="Körkort, språk och grupper">
    <div className="space-y-5" data-testid="competence-card-modal">
      {!draft.fixed ? <Field id="si-card-person" label="Person" value={draft.personId} onChange={choose} options={people.map((person) => person.id)} optionLabels={Object.fromEntries(people.map((person) => [person.id, person.name]))} /> : null}
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Kompetensgrupper</legend>
        {groups.length ? <div className="grid gap-2 sm:grid-cols-2">{groups.map((group) => <label key={group.id} className="flex items-start gap-2 text-sm">
          <Checkbox checked={draft.groupIds.includes(group.id)} onCheckedChange={() => setDraft({ ...draft, groupIds: toggle(draft.groupIds, group.id) })} aria-label={group.name} />
          <span className="min-w-0"><span className="block">{group.name}</span>{group.description ? <span className="block text-xs text-muted-foreground">{group.description}</span> : null}</span>
        </label>)}</div> : <p className="text-sm text-muted-foreground">Företaget har inga kompetensgrupper ännu. Skapa dem under Kompetensgrupper.</p>}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Körkort</legend>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Körkortsbehörigheter">{LICENCE_CLASSES.map((value) => {
          const on = draft.licenceClasses.includes(value);
          return <button key={value} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, licenceClasses: toggle(draft.licenceClasses, value) })}
            className={cn("h-9 min-w-11 rounded-md border px-2 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "bg-muted/40 hover:bg-muted")}>{value}</button>;
        })}</div>
        <Field id="si-card-licence-valid" type="date" label="Giltigt till" value={draft.licenceValidUntil} onChange={(licenceValidUntil) => setDraft({ ...draft, licenceValidUntil })} className="max-w-xs" />
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Språk</legend>
        {draft.languages.map((item, index) => <div key={index} className="flex flex-wrap items-end gap-2">
          <Field id={`si-card-language-${index}`} label="Språk" value={item.language} className="min-w-40 flex-1" onChange={(language) => setDraft({ ...draft, languages: draft.languages.map((entry, at) => at === index ? { ...entry, language } : entry) })} />
          <Field id={`si-card-level-${index}`} label="Nivå" value={item.level} options={Object.keys(LANGUAGE_LEVELS)} optionLabels={LANGUAGE_LEVELS} className="min-w-40"
            onChange={(level) => setDraft({ ...draft, languages: draft.languages.map((entry, at) => at === index ? { ...entry, level: level as LanguageLevel } : entry) })} />
          <RemoveButton label={`Ta bort språket ${item.language || index + 1}`} onClick={() => setDraft({ ...draft, languages: draft.languages.filter((_, at) => at !== index) })} />
        </div>)}
        <Button variant="outline" size="sm" disabled={draft.languages.length >= 20} onClick={() => setDraft({ ...draft, languages: [...draft.languages, { language: "", level: "WORK" }] })}><Plus />Lägg till språk</Button>
      </fieldset>
      <p className="text-xs text-muted-foreground">Klockan påminner 30 dagar innan körkortet går ut.</p>
      <DialogActions cancel={{ onClick: () => setDraft(null) }} primary={{ label: "Spara", icon: <IdCard />, disabled: busy || !draft.personId, onClick: () => void onSave(), testId: "competence-card-save" }} />
    </div>
  </DialogPage>;
}

/** The company's own competence groups (admins): add, rename, describe, remove. */
function GroupsModal({ view, busy, run, onClose }: { view: SelfInspectionView; busy: boolean; run: Run; onClose: () => void }) {
  const [confirm, confirmElement] = useConfirm();
  const [fresh, setFresh] = useState({ name: "", description: "" });
  const [editing, setEditing] = useState<{ id: string; name: string; description: string } | null>(null);
  const groups = view.competenceGroups ?? [];
  const members = (groupId: string) => (view.competenceCards ?? []).filter((card) => card.groupIds.includes(groupId)).length;
  return <DialogPage pageKey="kompetensgrupper" size="page" open onOpenChange={(open) => { if (!open) onClose(); }} title="Kompetensgrupper" panelTitle="Företagets grupper">
    {confirmElement}
    <div className="space-y-4" data-testid="competence-groups">
      <p className="text-sm text-muted-foreground">Företagets egna grupper, till exempel per sorts arbete. En person kan höra till flera.</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
        <Field id="si-group-new-name" label="Ny grupp" value={fresh.name} onChange={(name) => setFresh({ ...fresh, name })} />
        <Field id="si-group-new-description" label="Beskrivning" value={fresh.description} onChange={(description) => setFresh({ ...fresh, description })} />
        <Button disabled={busy || !fresh.name.trim() || groups.length >= 100} data-testid="competence-group-add" onClick={async () => {
          if (await run({ action: "save_competence_group", group: fresh }, "Gruppen är tillagd.")) setFresh({ name: "", description: "" });
        }}><Plus />Lägg till</Button>
      </div>
      {groups.length ? <ul className="divide-y rounded-lg border">{groups.map((group) => <li key={group.id} className="p-3">
        {editing?.id === group.id ? <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
          <Field id={`si-group-name-${group.id}`} label="Namn" value={editing.name} onChange={(name) => setEditing({ ...editing, name })} />
          <Field id={`si-group-description-${group.id}`} label="Beskrivning" value={editing.description} onChange={(description) => setEditing({ ...editing, description })} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Avbryt</Button>
            <Button disabled={busy || !editing.name.trim()} onClick={async () => { if (await run({ action: "save_competence_group", group: editing }, "Gruppen är uppdaterad.")) setEditing(null); }}>Spara</Button>
          </div>
        </div> : <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{group.name}</p>
            <p className="text-xs text-muted-foreground">{[group.description, `${members(group.id)} ${members(group.id) === 1 ? "person" : "personer"}`].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <IconButton label={`Ändra ${group.name}`} onClick={() => setEditing({ id: group.id, name: group.name, description: group.description })}><Pencil /></IconButton>
            <RemoveButton label={`Ta bort ${group.name}`} disabled={busy} onClick={async () => {
              if (!await confirm({ title: "Ta bort gruppen?", message: `${group.name} tas bort och försvinner från ${members(group.id) === 1 ? "en persons kompetenskort" : `${members(group.id)} personers kompetenskort`}. Korten behåller den i sin historik.`, confirmLabel: "Ta bort", tone: "danger" })) return;
              await run({ action: "remove_competence_group", id: group.id }, "Gruppen är borttagen.");
            }} />
          </div>
        </div>}
      </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga grupper ännu.</p>}
      <DialogActions cancel={{ label: "Stäng", onClick: onClose }} />
    </div>
  </DialogPage>;
}
