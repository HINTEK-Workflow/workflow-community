"use client";

import { useCallback, useState, type ReactNode } from "react";
import { CalendarClock, CircleCheck, ExternalLink, Eye, FilePen, Mail, Newspaper, Plus, Save, Send, SkipForward, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckField, Empty, Field, Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { formatSwedish, fromSwedishDateTimeInput, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { describeNextDraft, WEEKDAYS } from "@/lib/mail/release-newsletter";
import { ChoiceCard } from "@/components/ui/choice-card";
import { useInstance } from "@/components/instance-provider";
import { MailingEditor } from "@/features/workflow/mailing-editor";
import { mailingProblems, starterMailing, type MailingDocument } from "@/lib/mail/mailing-document";
import { useLoadEffect } from "@/lib/use-load-effect";
import { PageHeader } from "@/components/page-shell";
import { RemoveButton } from "@/components/ui/remove-button";
import { DownloadButton } from "@/components/ui/download-button";

type Audience = "NEWSLETTER" | "ADMINS";
type Row = { id: string; subject: string; audience: Audience; status: "SCHEDULED" | "QUEUED" | "SENT" | "DISMISSED"; createdAt: string; finishedAt: string | null; scheduledAt: string | null; releaseVersion: string | null; socialPostId?: string | null; webVersion: string; sent: number; pending: number; failed: number; skipped: number };
/** `available`: false in Community, which has no weekly letter of the release notes (2026-11-10). */
type Weekly = { available?: boolean; enabled: boolean; weekday: number; time: string; next: string | null };
/** What is new since the last veckobrev, as a newsletter that could be written. */
type ReleaseDraft = { subject: string; document: MailingDocument; version: string; versions: string[] };
/** A veckobrev draft that waits for the superadmin's approval (2026-10-07). */
type StoredDraft = { id: string; subject: string; releaseVersion: string | null; createdAt: string; document: MailingDocument };
type Data = { audiences: Record<Audience, number>; subscribers?: number; blockedReason: string | null; keptMonths: number; mailings: Row[]; drafts: StoredDraft[];
  release: { current: string; baseline: string | null; draft: ReleaseDraft | null }; weekly: Weekly };

const AUDIENCE: Record<Audience, { label: string; description: string }> = {
  NEWSLETTER: { label: "Nyhetsbrev", description: "Till dem som har sagt ja till nyheter. Varje utskick får en länk för att avböja." },
  ADMINS: { label: "Viktig information", description: "Till ägare och administratörer i alla aktiva företag. Bara om tjänsten, till exempel driftstopp eller ändrade villkor – aldrig marknadsföring." },
};

const NEXT_FORMAT: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" };
const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
const WEEKDAY_OPTIONS = WEEKDAYS.map((_, index) => String(index));
const WEEKDAY_LABELS = Object.fromEntries(WEEKDAYS.map((day, index) => [String(index), day[0].toUpperCase() + day.slice(1)]));
const versionsText =(versions: string[]) => versions.length === 1 ? `version ${versions[0]}` : `versionerna ${versions.join(", ")}`;

/**
 * Utskick (2026-10-03): the superadmin writes a newsletter or important information, tries it on themselves and
 * sends it. A blank line starts a new paragraph; web addresses become links. The queue sends it within minutes.
 * Veckobrev (2026-10-07): the weekly newsletter is never sent by itself – a draft is made, the bell tells the superadmin,
 * who reads it here and approves it with "Godkänn och skicka". Since 2026-10-15 a part of Installation →
 * E-post och utskick, since C6 (2026-10-21) its own page under Webbplats och utskick (`embedded`): the page heading "Utskick" names it.
 * Nytt utskick is the page's main action (2026-11-15): always top right in the page header (`header` draws the page's
 * own heading with it), never only in the editor's row while a draft is open.
 */
export function Mailings({ notify, embedded = false, header }: {
  notify: (text: string, error?: boolean) => void; embedded?: boolean;
  /** The page's heading with the page's main actions (the workspace's heading when embedded). */
  header?: (actions: ReactNode) => ReactNode;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [audience, setAudience] = useState<Audience>("NEWSLETTER");
  const [subject, setSubject] = useState("");
  const [document, setDocument] = useState<MailingDocument>(starterMailing);
  const instance = useInstance();
  const [busy, setBusy] = useState<"" | "test" | "send" | "schedule" | "weekly" | "draft" | "make" | "approve">("");
  // Veckobrev (2026-10-06): the version notes a newsletter in the editor carries, and the time to send it.
  const [releaseVersion, setReleaseVersion] = useState<string | null>(null);
  // The stored draft that is open in the editor (2026-10-07), if any.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [sendAt, setSendAt] = useState("");
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { const next = await api<Data>("/api/superadmin/mailings", { cache: "no-store" }); setData(next); setWeekly((current) => current ?? next.weekly); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(load);

  const clearEditor = () => { setSubject(""); setDocument(starterMailing()); setReleaseVersion(null); setSendAt(""); setDraftId(null); };
  const post = (path: string, input: unknown) => api<Record<string, unknown>>(path, { method: "POST", body: JSON.stringify(input) });

  const run = async (action: "test" | "send" | "schedule") => {
    if (action === "send") {
      const count = data?.audiences[audience] ?? 0;
      if (!(await confirm({ title: "Skicka utskicket?", message: `”${subject}” skickas som ${AUDIENCE[audience].label.toLowerCase()} till ${count} mottagare. Det går inte att ångra.`, confirmLabel: "Skicka" }))) return;
    }
    setBusy(action);
    try {
      const result = await api<{ to?: string; recipients?: number; scheduledAt?: string }>("/api/superadmin/mailings", { method: "POST",
        body: JSON.stringify({ action, audience, subject, document, releaseVersion: audience === "NEWSLETTER" ? releaseVersion : null, scheduledAt: action === "schedule" ? sendAt : undefined }) });
      if (action === "test") notify(`Testmejlet är skickat till ${result.to}.`);
      else {
        notify(action === "schedule" && result.scheduledAt ? `Utskicket är schemalagt till ${formatSwedish(result.scheduledAt, DATE_TIME)}.` : `Utskicket köas till ${result.recipients} mottagare och skickas inom några minuter.`);
        clearEditor();
      }
      await load();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(""); }
  };

  // Nytt utskick empties the editor; what was written in a new one is asked about first (an open draft stays stored).
  const startNew = async () => {
    if (!draftId && subject.trim() && !(await confirm({ title: "Börja på ett nytt utskick?", message: "Det du har skrivit här sparas inte.", confirmLabel: "Börja om", tone: "danger" }))) return;
    clearEditor();
  };
  const newMailing = <Button type="button" disabled={!data || Boolean(busy)} onClick={() => void startNew()} data-testid="mailing-new"><Plus />Nytt utskick</Button>;
  const top = header ? header(newMailing) : embedded ? null : <PageHeader title="Utskick" description="Nyhetsbrev och viktig information till användarna, via installationens e-postserver." actions={newMailing} />;
  // The page heading already says Utskick: no second one while the list loads.
  if (error) return <>{top}{embedded ? <p role="alert" className="text-sm text-destructive">{error}</p> : <Panel icon={Newspaper} title="Utskick"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>}</>;
  if (!data) return <>{top}{embedded ? <p role="status" className="text-sm text-muted-foreground">Hämtar utskicken…</p> : <Panel icon={Newspaper} title="Utskick"><p className="text-sm text-muted-foreground">Hämtar…</p></Panel>}</>;
  const problems = mailingProblems(document);
  const draft = data.release.draft;
  const waiting = data.drafts;
  const fillDraft = async () => {
    if (!draft) return;
    if (subject.trim() && !(await confirm({ title: "Ersätta utkastet?", message: "Ämnet och blocken i det nya utskicket ersätts av veckobrevet.", confirmLabel: "Ersätt" }))) return;
    setAudience("NEWSLETTER"); setSubject(draft.subject); setDocument(draft.document); setReleaseVersion(draft.version); setDraftId(null);
    notify(`Veckobrevet är ifyllt med ${versionsText(draft.versions)}. Redigera det och skicka eller schemalägg.`);
  };
  const saveWeekly = async () => {
    if (!weekly) return;
    setBusy("weekly");
    try {
      const saved = await api<Weekly>("/api/superadmin/mailings/weekly", { method: "PUT", body: JSON.stringify({ enabled: weekly.enabled, weekday: weekly.weekday, time: weekly.time }) });
      setWeekly(saved);
      notify(saved.enabled && saved.next ? `Utkast görs automatiskt. Nästa tillfälle: ${formatSwedish(saved.next, NEXT_FORMAT)}.` : "Utkast görs inte längre automatiskt.");
      await load();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(""); }
  };
  const makeDraft = async () => {
    setBusy("make");
    try { await post("/api/superadmin/mailings/draft", { action: "make" }); notify("Utkastet är gjort. Läs det under Utkast som väntar på godkännande."); await load(); }
    catch (cause) { notify((cause as Error).message, true); } finally { setBusy(""); }
  };
  // "Läs och redigera": the draft opens in the editor below, where it can be changed, tried on yourself and approved.
  const openDraft = async (item: StoredDraft) => {
    if (draftId !== item.id && subject.trim() && !(await confirm({ title: "Ersätta det du skriver?", message: "Ämnet och blocken i det nya utskicket ersätts av utkastet.", confirmLabel: "Ersätt" }))) return;
    setAudience("NEWSLETTER"); setSubject(item.subject); setDocument(item.document); setReleaseVersion(item.releaseVersion); setDraftId(item.id);
    notify("Utkastet är öppet i redigeraren. Inget skickas förrän du godkänner det.");
  };
  const saveAsDraft = async () => {
    setBusy("draft");
    try {
      if (draftId) { await post("/api/superadmin/mailings/draft", { action: "save", id: draftId, subject, document }); notify("Utkastet är sparat."); }
      else { const created = await post("/api/superadmin/mailings/draft", { action: "create", subject, document, releaseVersion }); setDraftId(String(created.id)); notify("Utkastet är sparat. Det väntar på ditt godkännande."); }
      await load();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(""); }
  };
  // Godkänn och skicka: always asks first, and is the only way a veckobrev draft is sent. `edited` carries what is open in the editor.
  const approve = async (item: { id: string; subject: string }, edited?: { subject: string; document: MailingDocument }, at?: string) => {
    const name = edited?.subject ?? item.subject;
    const atDate = at ? fromSwedishDateTimeInput(at) : null;
    if (!(await confirm({ title: atDate ? "Godkänna och schemalägga veckobrevet?" : "Godkänna och skicka veckobrevet?",
      message: atDate ? `”${name}” godkänns och skickas ${formatSwedish(atDate, DATE_TIME)} (svensk tid) till dem som har sagt ja till nyheter då. Det går inte att ångra.`
        : `”${name}” godkänns och skickas till ${data.audiences.NEWSLETTER} mottagare som har sagt ja till nyheter. Det går inte att ångra.`,
      confirmLabel: atDate ? "Godkänn och schemalägg" : "Godkänn och skicka" }))) return;
    setBusy("approve");
    try {
      const result = await post("/api/superadmin/mailings/draft", { action: "approve", id: item.id, ...(edited ?? {}), scheduledAt: at || undefined });
      notify(at && result.scheduledAt ? `Veckobrevet är godkänt och schemalagt till ${formatSwedish(String(result.scheduledAt), DATE_TIME)}.` : `Veckobrevet är godkänt och köas till ${String(result.recipients)} mottagare. Det skickas inom några minuter.`);
      if (draftId === item.id) clearEditor();
      await load();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(""); }
  };
  const dismiss = async (item: StoredDraft) => {
    if (!(await confirm({ title: "Hoppa över veckobrevet?", message: `”${item.subject}” skickas inte${item.releaseVersion ? ` och versionsnyheterna till och med version ${item.releaseVersion} tas inte med i något veckobrev` : ""}.`, confirmLabel: "Hoppa över", cancelLabel: "Behåll", tone: "danger" }))) return;
    setBusy("approve");
    try { await post("/api/superadmin/mailings/draft", { action: "dismiss", id: item.id }); notify("Utkastet är överhoppat."); if (draftId === item.id) clearEditor(); await load(); }
    catch (cause) { notify((cause as Error).message, true); } finally { setBusy(""); }
  };
  const minimumTime = toSwedishDateTimeInput(new Date().getTime() + 5 * 60_000);
  const ready = subject.trim().length >= 3 && !problems.length;
  const removeMailing = async (row: Row) => {
    const scheduled = row.status === "SCHEDULED";
    if (!(await confirm(scheduled
      ? { title: "Avbryta utskicket?", message: `”${row.subject}” skickas inte och tas bort.`, confirmLabel: "Avbryt utskicket", cancelLabel: "Behåll", tone: "danger" }
      : { title: "Ta bort utskicket?", message: `”${row.subject}” och dess mottagarlista tas bort ur historiken. E-post som redan har skickats påverkas inte.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
    try { await api(`/api/superadmin/mailings?id=${encodeURIComponent(row.id)}`, { method: "DELETE" }); notify(scheduled ? "Utskicket är avbrutet." : "Utskicket är borttaget ur historiken."); await load(); }
    catch (cause) { notify((cause as Error).message, true); }
  };
  const editorTitle = draftId ? `Utkast: ${waiting.find((item) => item.id === draftId)?.subject ?? subject}` : "Nytt utskick";
  const statusText = (item: Row) => item.status === "SCHEDULED" ? `Schemalagt till ${item.scheduledAt ? formatSwedish(item.scheduledAt, DATE_TIME) : "–"}`
    : item.status === "DISMISSED" ? "Överhoppat – skickades inte"
      : `${item.status === "SENT" ? "Klart" : "Skickas"} · ${item.sent} skickade${item.pending ? ` · ${item.pending} i kö` : ""}${item.failed ? ` · ${item.failed} misslyckades` : ""}${item.skipped ? ` · ${item.skipped} hoppades över` : ""}`;
  return <div className="space-y-6">
    {confirmElement}
    {top}
    {/* Embedded, the e-mail settings right above already say why nothing is sent. */}
    {data.blockedReason && !embedded ? <div className="notice" role="status"><p>{data.blockedReason}</p></div> : null}
    {waiting.length ? <Panel title={data.weekly.available === false ? "Utkast väntar på godkännande" : "Veckobrev väntar på godkännande"} description={data.weekly.available === false ? "Ett utkast skickas aldrig av sig självt. Läs det, ändra vid behov och godkänn det – först då skickas det." : "Veckobrevet skickas aldrig av sig självt. Läs utkastet, ändra vid behov och godkänn det – först då skickas det."}
      icon={Newspaper}>
      <ul className="divide-y rounded-lg border text-sm" data-testid="draft-list">
        {waiting.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3" data-testid="draft-row">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{item.subject}</span>
            <span className="block text-xs text-muted-foreground">Utkast gjort {formatSwedish(item.createdAt, DATE_TIME)}{item.releaseVersion ? ` · versionsnyheterna till och med version ${item.releaseVersion}` : ""} · {data.audiences.NEWSLETTER} mottagare</span>
          </span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void openDraft(item)}><Eye />Läs och redigera</Button>
            <Button type="button" disabled={Boolean(busy) || !data.audiences.NEWSLETTER} onClick={() => void approve(item)}><CircleCheck />Godkänn och skicka</Button>
            <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void dismiss(item)}><SkipForward />Hoppa över</Button>
          </div>
        </li>)}
      </ul>
      {!data.audiences.NEWSLETTER ? <p className="mt-3 text-xs text-muted-foreground">Ingen har sagt ja till nyheter ännu, så det finns ingen att skicka till.</p> : null}
    </Panel> : null}
    <Panel title={editorTitle} icon={Mail}>
      {data.weekly.available === false ? null : <div className="mb-4 flex flex-wrap items-center gap-3" data-testid="release-draft">
        <Button type="button" variant="outline" disabled={!draft} onClick={() => void fillDraft()}><Newspaper />Skapa veckobrev från versionsnyheterna</Button>
        <span className="text-xs text-muted-foreground">{draft
          ? `Nytt sedan förra veckobrevet: ${draft.versions.map((version) => `version ${version}`).join(", ")}.`
          : waiting.length ? "Ett veckobrev väntar redan på godkännande, se ovan."
            : `Inga nya versionsnyheter sedan förra veckobrevet (version ${data.release.baseline ?? data.release.current}).`}</span>
      </div>}
      <fieldset className="grid gap-3 sm:grid-cols-2" data-testid="mailing-audience">
        <legend className="sr-only">Mottagare</legend>
        {(Object.keys(AUDIENCE) as Audience[]).map((key) => <ChoiceCard key={key} name="mailing-audience" value={key} checked={audience === key} onChange={() => setAudience(key)} disabled={Boolean(draftId) && key !== "NEWSLETTER"}
          title={AUDIENCE[key].label} badge={`${data.audiences[key]} mottagare`} description={AUDIENCE[key].description} />)}
      </fieldset>
      <label className="mt-4 grid gap-1.5 text-xs font-medium text-muted-foreground">Ämne<Input value={subject} maxLength={150} onChange={(event) => setSubject(event.target.value)} /></label>
      {releaseVersion && audience === "NEWSLETTER" ? <p className="mt-2 text-xs text-muted-foreground" data-testid="release-version">Veckobrev med versionsnyheterna till och med version {releaseVersion}. Nästa veckobrev börjar efter den.</p> : null}
      <div className="mt-4"><MailingEditor document={document} onChange={setDocument} name={instance.name} newsletter={audience === "NEWSLETTER"} notify={notify} /></div>
      {problems.length ? <p className="mt-3 text-xs text-muted-foreground" data-testid="mailing-problems">Innan det kan skickas: {problems.join(" ")}</p> : null}
      <div className="mt-4 flex flex-wrap gap-3" data-testid="mailing-actions">
        <Button type="button" variant="outline" disabled={!ready || Boolean(busy) || Boolean(data.blockedReason)} onClick={() => void run("test")} busy={busy === "test"} busyLabel="Skickar…"><Mail />Skicka test till mig</Button>
        {draftId ? <>
          <Button type="button" variant="outline" disabled={subject.trim().length < 3 || Boolean(busy)} onClick={() => void saveAsDraft()} busy={busy === "draft"} busyLabel="Sparar…"><Save />Spara utkast</Button>
          <Button type="button" disabled={!ready || Boolean(busy) || !data.audiences.NEWSLETTER} onClick={() => void approve({ id: draftId, subject }, { subject, document })} busy={busy === "approve"} busyLabel="Köar…"><CircleCheck />Godkänn och skicka</Button>
        </> : <>
          <Button type="button" disabled={!ready || Boolean(busy) || !data.audiences[audience]} onClick={() => void run("send")} busy={busy === "send"} busyLabel="Köar…"><Send />Skicka</Button>
          {audience === "NEWSLETTER" ? <Button type="button" variant="outline" disabled={subject.trim().length < 3 || Boolean(busy)} onClick={() => void saveAsDraft()} busy={busy === "draft"} busyLabel="Sparar…"><FilePen />Spara som utkast</Button> : null}
        </>}
      </div>
      {/* Schemalägg (2026-10-06): the day and time in Swedish time; the recipients are those of that moment. */}
      {/* 2026-10-09: the label above the field (it ended up in front of a narrow field), the field as wide as the
          other settings fields and the button beside it at the field's height, under it on a phone. */}
      <div className="mt-4 grid items-end gap-3 border-t pt-4 sm:grid-cols-2" data-testid="mailing-schedule">
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Skicka vid (svensk tid)
          <Input type="datetime-local" value={sendAt} min={minimumTime} onChange={(event) => setSendAt(event.target.value)} />
        </label>
        <Button type="button" variant="outline" className="justify-self-start" disabled={!ready || Boolean(busy) || !sendAt} onClick={() => void (draftId ? approve({ id: draftId, subject }, { subject, document }, sendAt) : run("schedule"))}><CalendarClock />{draftId ? "Godkänn och schemalägg" : busy === "schedule" ? "Schemalägger…" : "Schemalägg"}</Button>
      </div>
    </Panel>
    {data.weekly.available === false ? null : <Panel title="Veckobrev" description="Nyhetsbrev med versionsnyheterna sedan förra veckobrevet, till dem som sagt ja till nyheter. Det skickas aldrig av sig självt: när en ny version finns får du ett utkast och en notis i klockan, och godkänner själv."
      icon={Newspaper}>
      {/* 2026-10-09: the tick box on its own row, the two fields with their labels above, the status under them and
          the buttons in a row of their own – no text in front of a field. */}
      <div className="space-y-4" data-testid="weekly-newsletter">
        {weekly ? <>
          <CheckField id="weekly-enabled" label="Gör ett utkast automatiskt" checked={weekly.enabled} onChange={(enabled) => setWeekly({ ...weekly, enabled })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="weekly-weekday" label="Veckodag" value={String(weekly.weekday)} options={WEEKDAY_OPTIONS} optionLabels={WEEKDAY_LABELS}
              onChange={(value) => setWeekly({ ...weekly, weekday: Number(value) })} />
            <Field id="weekly-time" type="time" label="Tid (svensk tid)" value={weekly.time} onChange={(time) => setWeekly({ ...weekly, time })} />
          </div>
        </> : null}
        <p className="text-xs text-muted-foreground" data-testid="weekly-status">{data.weekly.enabled && data.weekly.next
          ? describeNextDraft(formatSwedish(data.weekly.next, NEXT_FORMAT), draft && !waiting.length ? draft.versions : null)
          : "Av. Inget utkast görs av sig självt. Du kan ändå skapa ett veckobrev med knappen under Nytt utskick, eller ett utkast med Skapa utkast nu."}</p>
        {weekly ? <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" disabled={Boolean(busy) || !/^\d{2}:\d{2}$/.test(weekly.time)} onClick={() => void saveWeekly()} busy={busy === "weekly"} busyLabel="Sparar…"><Save />Spara</Button>
          <Button type="button" variant="outline" disabled={Boolean(busy) || !draft || waiting.length > 0} title={waiting.length ? "Ett utkast väntar redan på godkännande." : !draft ? "Inga nya versionsnyheter." : undefined} onClick={() => void makeDraft()} busy={busy === "make"} busyLabel="Gör utkast…"><FilePen />Skapa utkast nu</Button>
        </div> : null}
      </div>
    </Panel>}
    <Panel icon={CalendarClock} title="Schemalagda och skickade" description={`De senaste tjugo. Ett utskick och dess mottagarlista tas bort av sig självt efter ${data.keptMonths} månader.`}>
      {data.mailings.length ? <ul className="divide-y rounded-lg border text-sm" data-testid="mailing-history">
        {data.mailings.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
          <span className="min-w-0 flex-1 font-medium">{item.subject}</span>
          <span className="text-xs text-muted-foreground">{AUDIENCE[item.audience].label} · {formatSwedish(item.createdAt, DATE_TIME)}</span>
          <span className="text-xs" data-testid="mailing-counts">{statusText(item)}{item.releaseVersion ? ` · version ${item.releaseVersion}` : ""}</span>
          {/* Även som nyhetsbrev (2026-11-12): the post it was made from, under Inlägg. */}
          {item.socialPostId ? <a href={`/?view=company_posts&post=${encodeURIComponent(item.socialPostId)}`} className="text-xs font-medium text-primary hover:underline" data-testid="mailing-post-link">Från inlägg</a> : null}
          {item.status !== "DISMISSED" ? <Button asChild size="icon" variant="ghost" className="size-8"><a href={item.webVersion} target="_blank" rel="noopener noreferrer" aria-label={`Visa ${item.subject} i webbläsaren`} title="Visa i webbläsaren"><ExternalLink /></a></Button> : null}
          {item.status !== "QUEUED" && item.status !== "DISMISSED" ? <RemoveButton label={item.status === "SCHEDULED" ? `Avbryt ${item.subject}` : `Ta bort ${item.subject}`} onClick={() => void removeMailing(item)} /> : null}
        </li>)}
      </ul> : <Empty title="Inga utskick ännu" description="Det du skickar visas här med hur många som fick det." />}
    </Panel>
    <Panel icon={Users} title="Listan över nyhetsbrev" description="De som har sagt ja till e-post om ändringar och förbättringar, när kontot skapades eller under Mina inställningar.">
      <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="newsletter-recipients">
        <span>{data.audiences.NEWSLETTER === 1 ? "1 mottagare" : `${data.audiences.NEWSLETTER} mottagare`}</span>
        {data.subscribers !== undefined ? <span className="text-xs text-muted-foreground" data-testid="newsletter-subscribers">Bekräftade prenumeranter från webbplatsen: {data.subscribers}</span> : null}
        <DownloadButton size="sm" href="/api/newsletter?format=csv" download>Ladda ner listan (CSV)</DownloadButton>
      </div>
    </Panel>
  </div>;
}
