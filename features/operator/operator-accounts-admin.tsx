"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Cog, ExternalLink, HardHat, Hourglass, KeyRound, Link2, LogIn, Pencil, PlayCircle, Plus, QrCode, RefreshCw, ShieldBan, Trash2, UserRound, Users, Wrench } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { useEntryState } from "@/components/history-nav";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { PageBackButton, PageHeader, usePageTrail } from "@/components/page-shell";
import { DelayedSkeleton, RowsSkeleton } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { CheckField, DangerZone, DialogActions, Empty, Field, Modal, Panel } from "@/features/kfid/ui";
import { useConfirm } from "@/features/kfid/confirm";
import { api } from "@/features/kfid/api";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useLoadEffect } from "@/lib/use-load-effect";
import { formatSwedish } from "@/lib/swedish-time";
import { OPERATOR_ADMIN_HREF, operatorAccountHref } from "@/lib/operator/admin-notice";
import { INACTIVITY_MAX, INACTIVITY_MIN, INTAKE_LABELS, INTAKES, OPERATOR_PASSWORD_MIN, OPERATOR_PASSWORD_RULES, operatorPasswordProblem, type Intake } from "@/lib/operator/rules";
import type { operatorAdminView } from "@/lib/operator/accounts-server";

/**
 * Operatörskonton (2026-10-30; as Kunder 2026-10-31; a button on the page Användare since 2026-11-02), Cloud, the
 * company's admin. The page is cards: Operatörssidans adress, Konton (the shared filter bar; a row opens the account's own
 * page, `&account=<id>`), the approval list, Felanmälan (causes, where a report goes, the inactivity time, the prepared AI
 * switch), Maskiner som syns (the machines' links and QR codes), Inloggning med Microsoft (folded, optional) and
 * Lösenordsregler. The server checks admin, company, Cloud and Origin on every call.
 */
type View = Awaited<ReturnType<typeof operatorAdminView>>;
type Account = View["accounts"][number];
type Draft = { id: string | null; username: string; password: string; active: boolean; nodeIds: string[] };
type AccountFilter = "all" | "active" | "blocked";
type AccountSort = "name" | "login";
const URL_PATH = "/api/operator-accounts";
const ACCOUNT_FILTERS: readonly AccountFilter[] = ["all", "active", "blocked"];
const ACCOUNT_FILTER_LABEL: Record<AccountFilter, string> = { all: "Alla", active: "Aktiva", blocked: "Spärrade" };
const ACCOUNT_SORTS = ["name", "login"] as const;
const ACCOUNT_SORT_OPTIONS: readonly { value: AccountSort; label: string }[] = [{ value: "name", label: "Namn" }, { value: "login", label: "Senast inloggad" }];

const MS_RESULT: Record<string, string> = {
  connected: "Katalogen är kopplad. Be katalogens administratör ge medgivandet.",
  consented: "Medgivandet är sparat. Välj grupp och kontrollera.",
  expired: "Kopplingen tog för lång tid. Försök igen.",
  token: "Microsoft-inloggningen kunde inte kontrolleras. Försök igen.",
  tenant: "Installationens Microsoft-inställning godtar inte katalogen.",
  locked: "Företaget har låst Microsoft-inloggning till en annan katalog.",
  "no-consent": "Medgivandet gavs inte.",
  off: "Microsoft-inloggning är inte påslagen för installationen. Kontakta installationens administratör.",
};

const kindLabel = (account: Account) => account.kind === "microsoft" ? "Microsoft" : account.shared ? "Terminal" : "E-post";
const StatusBadge = ({ active }: { active: boolean }) => <Badge variant="outline" className={indicatorBadge(active ? "success" : "neutral")} data-testid="operator-account-status">{active ? "Aktiv" : "Spärrad"}</Badge>;
const NEEDS_MACHINES = "Nytt konto via Microsoft. Välj maskiner.";

/** Two columns from 56 rem of the page's own width, one below it (a container query, 2026-10-29); nothing moves when a card fills. */
const CardGrid = ({ children }: { children: ReactNode }) => <div className="@container"><div className="grid items-start gap-4 @4xl:grid-cols-2">{children}</div></div>;
const FULL = "min-w-0 @4xl:col-span-2";

export function OperatorAccountsAdmin({ notify, personId, msResult = "" }: { notify: (message: string, error?: boolean) => void; personId: string; msResult?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const accountParam = params.get("account");
  const [data, setData] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { setData(await api<View>(URL_PATH, { cache: "no-store" })); } catch (error) { notify((error as Error).message, true); }
  }, [notify]);
  useLoadEffect(load);
  const post = async (input: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { const answer = await api<{ workOrder?: string; message?: string; ok?: boolean }>(URL_PATH, { method: "POST", body: JSON.stringify(input) }); notify(answer.message ?? (answer.workOrder ? `${done} Arbetsorder ${answer.workOrder}.` : done), answer.ok === false); await load(); return true; }
    catch (error) { notify((error as Error).message, true); return false; }
    finally { setBusy(false); }
  };

  const tree = useMemo(() => data?.tree ?? [], [data]);
  const editing = draft ? data?.accounts.find((item) => item.id === draft.id) ?? null : null;
  const openAccount = accountParam ? data?.accounts.find((item) => item.id === accountParam) ?? null : null;
  usePageTrail(openAccount ? { heading: openAccount.name } : {});
  const passwordProblem = draft && (draft.id === null || draft.password) ? operatorPasswordProblem(draft.password, { username: editing?.username ?? draft.username }) : "";
  const save = async () => {
    if (!draft) return;
    const ok = draft.id === null
      ? await post({ action: "create", username: draft.username, password: draft.password, active: draft.active, nodeIds: draft.nodeIds }, `Operatörskontot ${draft.username.trim()} är skapat.`)
      : await post({ action: "update", id: draft.id, active: draft.active, nodeIds: draft.nodeIds }, "Operatörskontot är sparat.")
        && (!draft.password || await post({ action: "password", id: draft.id, password: draft.password }, "Lösenordet är bytt. Kontot loggas ut på alla enheter."));
    if (ok) setDraft(null);
  };
  const toggleNode = (id: string) => setDraft((current) => current ? { ...current, nodeIds: current.nodeIds.includes(id) ? current.nodeIds.filter((item) => item !== id) : [...current.nodeIds, id] } : current);
  const depth = useMemo(() => new Map(tree.map((node) => [node.id, node.path.split(" › ").length - 1])), [tree]);
  const startEdit = (account: Account) => setDraft({ id: account.id, username: account.username, password: "", active: account.active, nodeIds: account.nodeIds });

  const modal = <Modal open={Boolean(draft)} onOpenChange={(value) => { if (!value) setDraft(null); }} title={draft?.id ? `Redigera ${editing?.name ?? "operatörskonto"}` : "Nytt operatörskonto"} size="form">
    {draft ? <div className="grid gap-4" data-testid="operator-account-form">
      {draft.id === null ? <Field id="op-new-name" label="Användarnamn" value={draft.username} onChange={(username) => setDraft({ ...draft, username })} help="E-post, eller ett namn som Press 4, Linje 2 eller Avdelning Montering." /> : null}
      {editing?.kind === "microsoft" ? null : <Field id="op-new-password" label={draft.id ? "Nytt lösenord (frivilligt)" : "Lösenord"} type="password" value={draft.password} onChange={(password) => setDraft({ ...draft, password })}
        help={draft.password ? passwordProblem || "Lösenordet duger." : `Minst ${OPERATOR_PASSWORD_MIN} tecken, inte ett vanligt lösenord.`} />}
      <fieldset className="grid gap-1" data-testid="operator-account-machines">
        <legend className="mb-1 text-xs font-medium">Ser maskiner</legend>
        {tree.length ? <ul className="max-h-64 overflow-y-auto rounded-md border p-2 text-sm">{tree.map((node) => <li key={node.id} style={{ paddingLeft: `${(depth.get(node.id) ?? 0) * 1.25}rem` }}>
          <CheckField id={`op-node-${node.id}`} label={node.name} description={node.objectType || undefined} checked={draft.nodeIds.includes(node.id)} onChange={() => toggleNode(node.id)} />
        </li>)}</ul> : <p className="text-sm text-muted-foreground">Det finns inga maskiner i Underhåll än.</p>}
        <p className="text-xs text-muted-foreground">En vald maskin tar med allt under den. Väljer du inget ser kontot inga maskiner.</p>
      </fieldset>
      <CheckField id="op-new-active" label="Aktivt" description="Ett spärrat konto kan inte logga in." checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} />
      <DialogActions cancel={{ onClick: () => setDraft(null) }} primary={{ label: draft.id ? "Spara" : "Skapa", onClick: () => void save(), busy,
        disabledReason: draft.id === null && !draft.username.trim() ? "Skriv ett användarnamn." : passwordProblem || null, testId: "operator-account-save" }} />
    </div> : null}
  </Modal>;

  // The account's own page.
  if (accountParam) {
    const back = <PageBackButton href={OPERATOR_ADMIN_HREF} testId="operator-account-back" />;
    if (!data || leaving) return <div className="min-w-0" data-testid="operator-account-page">
      {confirmElement}
      <PageHeader title={openAccount?.name ?? "Operatörskonto"} actions={back} />
      <DelayedSkeleton testId="operator-account-loading"><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={5} label="Hämtar kontot…" /></div></DelayedSkeleton>
    </div>;
    if (!openAccount) return <div className="min-w-0" data-testid="operator-account-page">
      <PageHeader title="Operatörskonto" actions={back} />
      <Empty title="Kontot finns inte" description="Det kan ha tagits bort." />
    </div>;
    const machines = tree.filter((node) => openAccount.nodeIds.includes(node.id));
    return <div className="min-w-0" data-testid="operator-account-page">
      {confirmElement}
      {modal}
      <PageHeader title={openAccount.name} description={kindLabel(openAccount)} actions={<>{back}
        <Button type="button" disabled={busy} onClick={() => startEdit(openAccount)} data-testid="operator-account-edit"><Pencil />Redigera</Button></>}>
        <div className="mt-2 flex flex-wrap gap-2"><StatusBadge active={openAccount.active} /></div>
      </PageHeader>
      <CardGrid>
        <Panel className="min-w-0" icon={UserRound} title="Uppgifter">
          <dl className="grid gap-3" data-testid="operator-account-facts">
            <Fact label="Användarnamn">{openAccount.username}</Fact>
            <Fact label="Inloggning">{openAccount.kind === "microsoft" ? "Microsoft" : "Lösenord"}{openAccount.shared ? " · delat konto, frågar efter ”Ditt namn” vid varje anmälan" : ""}</Fact>
            <Fact label="Senast inloggad">{openAccount.lastLoginAt ? formatSwedish(openAccount.lastLoginAt) : "Aldrig"}</Fact>
          </dl>
          {!openAccount.active ? <Button type="button" variant="outline" className="mt-4" disabled={busy} data-testid="operator-account-activate"
            onClick={() => void post({ action: "update", id: openAccount.id, active: true }, `${openAccount.name} är aktivt.`)}><PlayCircle />Aktivera</Button> : null}
        </Panel>
        <Panel className="min-w-0" icon={Cog} title="Ser maskiner" actions={<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => startEdit(openAccount)}><Pencil />Välj</Button>}>
          {openAccount.needsMachines ? <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-400">{NEEDS_MACHINES}</p> : null}
          {machines.length ? <ul className="space-y-1 text-sm" data-testid="operator-account-scope">{machines.map((node) => <li key={node.id} className="break-words">{node.path}</li>)}</ul>
            : <p className="text-sm text-muted-foreground" data-testid="operator-account-scope">Inga maskiner. Kontot kan inte felanmäla något.</p>}
        </Panel>
      </CardGrid>
      <DangerZone className="mt-4" testId="operator-account-danger-zone" description="Ett spärrat konto loggas ut och kan aktiveras igen. Felanmälningarna finns kvar om kontot tas bort.">
        {openAccount.active ? <Button type="button" variant="outline" disabled={busy} data-testid="operator-account-block"
          onClick={() => void post({ action: "update", id: openAccount.id, active: false }, `${openAccount.name} är spärrat och utloggat.`)}><ShieldBan />Spärra</Button> : null}
        <Button type="button" variant="outline" className="text-destructive" disabled={busy} data-testid="operator-account-remove" onClick={async () => {
          if (!(await confirm({ title: `Ta bort ${openAccount.name}?`, message: "Kontot loggas ut och kan inte logga in igen. Dess felanmälningar finns kvar.", confirmLabel: "Ta bort", tone: "danger" }))) return;
          setLeaving(true);
          if (await post({ action: "remove", id: openAccount.id }, `${openAccount.name} är borttaget.`)) router.replace(OPERATOR_ADMIN_HREF);
          setLeaving(false);
        }}><Trash2 />Ta bort</Button>
      </DangerZone>
    </div>;
  }

  const newAccount = <Button type="button" disabled={busy || !data} onClick={() => setDraft({ id: null, username: "", password: "", active: true, nodeIds: [] })} data-testid="operator-account-new"><Plus />Nytt operatörskonto</Button>;
  return <div className="min-w-0" data-testid="operator-accounts-page">
    <PageHeader title="Operatörskonton" description="Konton som bara kan felanmäla maskiner på operatörssidan." actions={newAccount} />
    {confirmElement}
    {modal}
    {msResult && MS_RESULT[msResult] ? <p className="mb-4 rounded-md border px-3 py-2 text-sm" role="status" data-testid="operator-ms-result">{MS_RESULT[msResult]}</p> : null}
    {!data ? <DelayedSkeleton testId="operator-accounts-loading"><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={7} label="Hämtar operatörskonton…" /></div></DelayedSkeleton>
      : <div data-testid="operator-accounts-admin"><CardGrid>
        <Panel className={FULL} icon={Link2} title="Operatörssidans adress" description="Dela adressen med operatörerna, eller sätt en QR-kod på maskinen.">
          <p className="break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs" data-testid="operator-page-url">{data.pageUrl}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton value={data.pageUrl} size="sm" onCopied={() => notify("Adressen är kopierad.")} />
            <Button asChild variant="outline" size="sm"><a href={data.pageUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />Öppna</a></Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} data-testid="operator-new-address" onClick={async () => {
              if (!(await confirm({ title: "Ge sidan en ny adress?", message: "Den gamla adressen och dess QR-koder slutar gälla direkt.", confirmLabel: "Ny adress", tone: "danger" }))) return;
              await post({ action: "new_address" }, "Operatörssidan har en ny adress.");
            }}><RefreshCw />Ny adress</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">QR-kod per maskin finns under Maskiner som syns.</p>
        </Panel>

        <AccountsCard accounts={data.accounts} personId={personId} />

        {data.pending.length ? <Panel className={FULL} icon={Hourglass} title="Väntar på godkännande" description={`${data.pending.length} ${data.pending.length === 1 ? "felanmälan" : "felanmälningar"}`}>
          <ul className="divide-y rounded-lg border text-sm" data-testid="operator-pending">{data.pending.map((report) => <li key={report.id} className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <span className="min-w-0"><span className="block font-medium">{report.cause} · {report.machine}</span>
              <span className="block text-xs text-muted-foreground">{[report.severity, report.by, formatSwedish(report.at), report.photos ? `${report.photos} bilder` : ""].filter(Boolean).join(" · ")}</span>
              {report.text ? <span className="block text-xs">{report.text}</span> : null}</span>
            <span className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => void post({ action: "approve", reportId: report.id }, "Felanmälan är godkänd.")}>Godkänn</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void post({ action: "reject", reportId: report.id }, "Felanmälan är avvisad.")}>Avvisa</Button>
            </span>
          </li>)}</ul>
        </Panel> : null}

        <Reports data={data} busy={busy} post={post} />
        {/* The narrow cards stacked beside Felanmälan (2026-11-01), so no empty room stands under them. */}
        <div className="grid min-w-0 items-start gap-4" data-testid="operator-side-cards">
          <Machines data={data} notify={notify} />
          <Panel className="min-w-0" icon={KeyRound} title="Lösenordsregler">
            <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="operator-rules">{OPERATOR_PASSWORD_RULES.map((rule) => <li key={rule}>{rule}</li>)}</ul>
          </Panel>
          <MicrosoftGroup key={msResult} data={data} busy={busy} post={post} open={Boolean(msResult)} />
        </div>
      </CardGrid></div>}
  </div>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words text-sm">{children}</dd></div>;
}

/** Konton: the shared filter bar and one row per account; the row opens the account's own page. */
function AccountsCard({ accounts, personId }: { accounts: readonly Account[]; personId: string }) {
  const [query, setQuery] = useEntryState("operator-accounts.q", "");
  const [filter, setFilter] = useEntryState<AccountFilter>("operator-accounts.filter", "all");
  const prefs = useListPrefs("operator-accounts", personId, { sorts: ACCOUNT_SORTS });
  const counts: Record<AccountFilter, number> = { all: accounts.length, active: accounts.filter((item) => item.active).length, blocked: accounts.filter((item) => !item.active).length };
  const words = query.trim().toLocaleLowerCase("sv").split(/\s+/).filter(Boolean);
  const rows = accounts
    .filter((item) => filter === "all" || item.active === (filter === "active"))
    .filter((item) => { const text = `${item.name} ${item.username} ${kindLabel(item)} ${item.scopeLabel}`.toLocaleLowerCase("sv"); return words.every((word) => text.includes(word)); })
    .sort((a, b) => prefs.sort === "login" ? String(b.lastLoginAt ?? "").localeCompare(String(a.lastLoginAt ?? "")) || a.name.localeCompare(b.name, "sv") : a.name.localeCompare(b.name, "sv"));
  const line = (account: Account) => `${kindLabel(account)} · ser ${account.scopeLabel}${account.lastLoginAt ? ` · senast ${formatSwedish(account.lastLoginAt)}` : ""}`;
  return <Panel className={FULL} icon={Users} title="Konton" description="Ett delat konto (ett namn som Press 4) frågar efter ”Ditt namn” vid varje anmälan.">
    <ListFilterBar testId="operator-accounts" className="mb-3"
      chips={{ label: "Visa", chips: ACCOUNT_FILTERS.map((value) => ({ value, label: ACCOUNT_FILTER_LABEL[value], count: counts[value] })), value: filter, onChange: setFilter }}
      search={{ label: "Sök operatörskonto", placeholder: "Namn, typ eller maskin…", value: query, onChange: setQuery, testId: "operator-accounts-search" }}
      sort={{ value: prefs.sort, options: ACCOUNT_SORT_OPTIONS, onChange: prefs.setSort }}
      view={{ value: prefs.view, onChange: prefs.setView }} />
    <div data-testid="operator-accounts">
      {!accounts.length ? <p className="text-sm text-muted-foreground">Inga operatörskonton än.</p>
        : !rows.length ? <div className="notice">Inget matchar urvalet. Ändra filter eller sökning.</div>
        : prefs.view === "cards" ? <ListCardGrid>{rows.map((account) => <ListCard key={account.id} testId="operator-account-row" href={operatorAccountHref(account.id)} icon={<AreaIcon area="admin" icon={HardHat} />}
          title={account.name} subtitle={line(account)} badges={<StatusBadge active={account.active} />}
          facts={[account.needsMachines ? { icon: Wrench, label: "Att göra", value: NEEDS_MACHINES } : null]} />)}</ListCardGrid>
        : <ul className="divide-y rounded-lg border text-sm">{rows.map((account) => <li key={account.id}><Link href={operatorAccountHref(account.id)} className="tap-card flex min-h-14 min-w-0 items-center gap-3 px-3 py-2 outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" data-testid="operator-account-row">
          <AreaIcon area="admin" icon={HardHat} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{account.name}</span>
            <span className="block truncate text-xs text-muted-foreground" title={line(account)}>{line(account)}</span>
            {account.needsMachines ? <span className="block text-xs font-medium text-amber-700 dark:text-amber-400">{NEEDS_MACHINES}</span> : null}
          </span>
          <span className="shrink-0"><StatusBadge active={account.active} /></span>
        </Link></li>)}</ul>}
    </div>
  </Panel>;
}

type Post = (input: Record<string, unknown>, done: string) => Promise<boolean>;

/** Felanmälan: the causes, where a report goes, the time until a sign-out, and the prepared AI switch. */
function Reports({ data, busy, post }: { data: View; busy: boolean; post: Post }) {
  const [causes, setCauses] = useState(data.settings.causes.join("\n"));
  const [minutes, setMinutes] = useState(String(data.settings.inactivityMinutes));
  const list = causes.split("\n").map((item) => item.trim()).filter(Boolean);
  const minutesValue = Number(minutes);
  const minutesProblem = !Number.isInteger(minutesValue) || minutesValue < INACTIVITY_MIN || minutesValue > INACTIVITY_MAX ? `Mellan ${INACTIVITY_MIN} och ${INACTIVITY_MAX} minuter.` : "";
  return <Panel className="min-w-0" icon={Wrench} title="Felanmälan"><div className="space-y-3" data-testid="operator-settings">
    <Field id="op-causes" label="Orsaker" multiline value={causes} onChange={setCauses} help="En orsak per rad. Visas i den här ordningen." />
    <div role="radiogroup" aria-label="Felanmälan blir" className="grid gap-2">
      <span className="text-xs font-medium">Felanmälan blir</span>
      {INTAKES.map((intake) => <CheckField key={intake} id={`op-intake-${intake}`} label={INTAKE_LABELS[intake as Intake]} checked={data.settings.intake === intake}
        description={intake === "approval" ? "Akut och Hög utanför arbetstid går alltid direkt till jouren." : undefined}
        onChange={() => { if (data.settings.intake !== intake) void post({ action: "settings", intake }, "Sparat."); }} disabled={busy} />)}
    </div>
    <Field id="op-inactivity" label="Logga ut efter minuter utan aktivitet" type="number" value={minutes} onChange={setMinutes} help={minutesProblem || `Mellan ${INACTIVITY_MIN} och ${INACTIVITY_MAX}.`} />
    {data.product.aiTroubleshooting ? <CheckField id="op-ai" label="AI-felsökning före felanmälan" description="Förslag ur företagets historik och maskinens larm. Operatören kan hoppa över. Säkerhetsbeslut tas av en person."
      checked={data.settings.aiTroubleshooting} disabled={busy} onChange={(on) => void post({ action: "settings", aiTroubleshooting: on }, on ? "AI-felsökning är på." : "AI-felsökning är av.")} /> : null}
    <Button type="button" size="sm" variant="outline" disabled={busy || Boolean(minutesProblem) || !list.length}
      onClick={() => void post({ action: "settings", causes: list, inactivityMinutes: minutesValue }, "Felanmälan är sparad.")} data-testid="operator-settings-save">Spara orsaker och tid</Button>
  </div></Panel>;
}

/** Maskiner som syns: every machine that can be reported, with its link and its QR code. */
function Machines({ data, notify }: { data: View; notify: (message: string, error?: boolean) => void }) {
  const [qr, setQr] = useState<{ name: string; link: string } | null>(null);
  const machines = data.tree.filter((node) => node.reportable);
  return <Panel className="min-w-0" icon={QrCode} title="Maskiner som syns" description="Länk och QR-kod till varje maskin.">
    {machines.length ? <ul className="divide-y rounded-lg border text-sm" data-testid="operator-machine-links">{machines.map((node) => {
      const link = `${data.pageUrl}?maskin=${encodeURIComponent(node.id)}`;
      return <li key={node.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5"><span className="min-w-0 flex-1 basis-40 break-words">{node.path}</span>
        <span className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="ghost" data-testid="operator-machine-qr" onClick={() => setQr({ name: node.path, link })}><QrCode />QR-kod</Button>
          <CopyButton value={link} size="sm" label="Kopiera länk" onCopied={() => notify("Länken är kopierad.")} />
        </span></li>;
    })}</ul> : <p className="text-sm text-muted-foreground">Inga maskiner än.</p>}
    <Modal open={Boolean(qr)} onOpenChange={(value) => { if (!value) setQr(null); }} title="QR-kod" size="compact">
      {qr ? <MachineQr name={qr.name} link={qr.link} /> : null}
    </Modal>
  </Panel>;
}

/** The QR code is drawn here in the browser, from the machine's link; its place is held while it is made. */
function MachineQr({ name, link }: { name: string; link: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: "M" })).then((url) => { if (live) setSrc(url); });
    return () => { live = false; };
  }, [link]);
  return <div className="grid justify-items-center gap-3" data-testid="operator-qr">
    <div className="size-60 rounded-md border bg-white">{src ? (
      // eslint-disable-next-line @next/next/no-img-element -- a data address made here in the browser, scanned as it is
      <img src={src} alt={`QR-kod för ${name}`} className="size-full" />
    ) : null}</div>
    <p className="break-words text-center text-sm">{name}</p>
  </div>;
}

/** Inloggning med Microsoft: optional, folded as standard (open when the steps have just come back here). */
function MicrosoftGroup({ data, busy, post, open }: { data: View; busy: boolean; post: Post; open: boolean }) {
  const ms = data.settings.microsoft;
  const [groupId, setGroupId] = useState(ms.groupId ?? "");
  const [groupName, setGroupName] = useState(ms.groupName);
  const step = (done: boolean, text: string) => <li className="flex items-start gap-2"><Badge variant="outline" className={indicatorBadge(done ? "success" : "neutral")}>{done ? "Klart" : "Kvar"}</Badge><span className="min-w-0 break-words">{text}</span></li>;
  return <Panel className="min-w-0" icon={LogIn} title="Inloggning med Microsoft" description="Valfritt – för företag med Microsoft 365. Inte kopplat till Workflow-admin." collapsible defaultCollapsed={!open}><div className="space-y-3" data-testid="operator-microsoft">
    <p className="text-xs text-muted-foreground">Medlemmar i en grupp i företagets Microsoft-katalog loggar in direkt och får ett operatörskonto som inte ser några maskiner förrän du väljer. Den som tas bort ur gruppen kommer inte in.</p>
    <ol className="space-y-1.5 text-sm">
      {step(Boolean(ms.tenantId), ms.tenantId ? `Katalogen är kopplad (${ms.tenantId}).` : "Koppla katalogen: logga in med ett Microsoft-konto i företagets katalog.")}
      {step(Boolean(ms.consentAt), ms.consentAt ? "Katalogens administratör har gett medgivande." : "Katalogens administratör ger appen rätt att läsa gruppmedlemskap.")}
      {step(Boolean(ms.check?.ok), ms.check ? ms.check.message : "Välj grupp och kontrollera.")}
    </ol>
    <div className="flex flex-wrap gap-2">
      {/* A full navigation (a plain GET form): the route sends the browser on to Microsoft. */}
      <form method="get" action="/operator/api/microsoft/start"><input type="hidden" name="connect" value="1" /><Button type="submit" variant="outline" size="sm" data-testid="operator-ms-connect">{ms.tenantId ? "Koppla igen" : "Koppla katalogen"}</Button></form>
      {ms.tenantId ? <form method="get" action="/operator/api/microsoft/start"><input type="hidden" name="consent" value="1" /><Button type="submit" variant="outline" size="sm">Ge medgivande</Button></form> : null}
    </div>
    {ms.tenantId ? <div className="grid gap-3 sm:grid-cols-2">
      <Field id="op-ms-group" label="Gruppens objekt-id" value={groupId} onChange={setGroupId} placeholder="00000000-0000-0000-0000-000000000000" help="Finns under Grupper i Microsoft Entra." />
      <Field id="op-ms-group-name" label="Gruppens namn" value={groupName} onChange={setGroupName} help="Fylls i när du kontrollerar." />
    </div> : null}
    {ms.tenantId ? <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy || !groupId.trim()} onClick={() => void post({ action: "microsoft", groupId: groupId.trim(), groupName: groupName.trim() }, "Gruppen är sparad.")}>Spara grupp</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || !ms.groupId} onClick={() => void post({ action: "check_microsoft" }, "Kontrollerat.")}>Kontrollera</Button>
    </div> : null}
    <CheckField id="op-ms-on" label="Operatörer får logga in med Microsoft" checked={ms.enabled} disabled={busy || !ms.tenantId || !ms.consentAt || !ms.groupId}
      description={!ms.tenantId || !ms.consentAt || !ms.groupId ? "Koppla katalogen, ge medgivande och välj grupp först." : undefined}
      onChange={(on) => void post({ action: "microsoft", enabled: on }, on ? "Inloggning med Microsoft är på." : "Inloggning med Microsoft är av.")} />
  </div></Panel>;
}
