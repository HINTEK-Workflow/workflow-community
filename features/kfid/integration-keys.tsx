"use client";
import { useCallback, useEffect, useState } from "react";
import { Bot, Copy, KeyRound, Plug, Plus, RefreshCw, Server, ShieldCheck, Stethoscope, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatSwedish } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { EXPIRY_CHOICES, EXTERNAL_PROVIDERS, KEY_SCOPES, keyState, type IssuedKind, type KeyState } from "@/lib/integrations/key-catalog";
import type { ServerKeyStatus } from "@/lib/integrations/server-keys";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { Empty, Modal, Panel } from "./ui";
import { api } from "./api";
import { useConfirm } from "./confirm";

type KeyRow = {
  id: string; kind: "API" | "MCP" | "EXTERNAL"; name: string; provider: string | null; scopes: string[]; displayHint: string;
  expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string; updatedAt: string; createdBy: string; actsFor?: string;
};
type Member = { id: string; name: string; admin: boolean };

type ServerKeyRow = ServerKeyStatus & { lastCheck: { ok: boolean; message: string; at: string } | null };

const date = (value: string | null) => (value ? formatSwedish(value, { dateStyle: "medium" }) : "–");
const STATE: Record<KeyState, { label: string; tone: IndicatorTone }> = {
  active: { label: "Aktiv", tone: "success" },
  expiring: { label: "Går ut snart", tone: "warning" },
  expired: { label: "Utgången", tone: "danger" },
  revoked: { label: "Återkallad", tone: "neutral" },
  removed: { label: "Borttagen", tone: "neutral" },
};
const StateBadge = ({ state }: { state: KeyState }) => <Pill tone={STATE[state].tone} testId="key-state">{STATE[state].label}</Pill>;
function Pill({ tone, children, testId }: { tone: IndicatorTone; children: React.ReactNode; testId?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium", indicatorBadge(tone))} data-testid={testId}>{children}</span>;
}
const providerLabel = (key: string | null) => EXTERNAL_PROVIDERS.find((item) => item.key === key)?.label ?? "Annan tjänst";
const scopeLabel = (key: string) => [...KEY_SCOPES.API, ...KEY_SCOPES.MCP].find((item) => item.key === key)?.label ?? key;

/**
 * API och MCP (Daniel 2026-09-29): every key the company uses with Workflow in one place – keys Workflow issues for the
 * API and for MCP clients, and keys fetched from other services. Company admins only; nothing secret is ever shown again.
 */
export function IntegrationKeys({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [revoked, setRevoked] = useState<KeyRow[]>([]);
  const [server, setServer] = useState<ServerKeyRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [issueKind, setIssueKind] = useState<IssuedKind | null>(null);
  const [externalOpen, setExternalOpen] = useState(false);
  const [replacing, setReplacing] = useState<KeyRow | null>(null);
  const [shownToken, setShownToken] = useState<{ name: string; token: string } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [confirm, confirmElement] = useConfirm();

  const load = useCallback(async () => {
    try {
      const result = await api<{ keys: KeyRow[]; revoked: KeyRow[]; server: ServerKeyRow[] | null; members: Member[]; currentUserId: string }>("/api/integration-keys");
      setKeys(result.keys);
      setMembers(result.members ?? []);
      setCurrentUserId(result.currentUserId ?? "");
      setRevoked(result.revoked);
      setServer(result.server);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const send = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      return await api<{ token?: string; id?: string }>("/api/integration-keys", { method: "POST", body: JSON.stringify(payload) });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (key: KeyRow) => {
    const external = key.kind === "EXTERNAL";
    if (!(await confirm(external
      ? { title: "Ta bort nyckeln?", message: `”${key.name}” raderas. Tjänster som använder den slutar fungera tills en ny nyckel läggs in.`, confirmLabel: "Ta bort", tone: "danger" }
      : { title: "Återkalla nyckeln?", message: `”${key.name}” slutar fungera direkt för alla som använder den. Det går inte att ångra.`, confirmLabel: "Återkalla", tone: "danger" }))) return;
    try {
      await send({ action: "revoke", id: key.id });
      notify(external ? "Nyckeln är borttagen." : "Nyckeln är återkallad.");
      await load();
    } catch (cause) { notify((cause as Error).message, true); }
  };

  const heading = <div>
    <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{server ? "HINTEK · produktägare" : "Mitt företag"}</p>
    <h1 className="page-title mt-2">API och MCP</h1>
    <p className="page-description mt-2">Alla nycklar som företaget använder med Workflow på ett ställe: nycklar för API och AI-klienter via MCP som Workflow skapar, och nycklar som ni hämtar från andra tjänster.</p>
  </div>;
  if (error) return <div className="space-y-6">{heading}<p role="alert" className="notice text-destructive">{error}</p></div>;
  if (!keys) return <div className="space-y-6">{heading}<p className="page-description">Hämtar nycklar…</p></div>;
  const ofKind = (kind: KeyRow["kind"]) => keys.filter((key) => key.kind === kind);

  const issuedList = (kind: IssuedKind) => ofKind(kind).length ? <ul className="divide-y rounded-lg border" aria-label={kind === "API" ? "API-nycklar" : "MCP-nycklar"}>
    {ofKind(kind).map((key) => <li key={key.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="integration-key">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">{key.name} <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{key.displayHint}</code><StateBadge state={keyState(key)} /></p>
        <p className="mt-1 text-xs text-muted-foreground">Gäller för {key.actsFor ?? key.createdBy} · {key.scopes.map(scopeLabel).join(" · ")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Skapad {date(key.createdAt)} av {key.createdBy} · {key.expiresAt ? `gäller till ${date(key.expiresAt)}` : "inget slutdatum"} · {key.lastUsedAt ? `senast använd ${date(key.lastUsedAt)}` : "aldrig använd"}</p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void revoke(key)}><Trash2 />Återkalla</Button>
    </li>)}
  </ul> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Inga {kind === "API" ? "API-nycklar" : "MCP-nycklar"} ännu.</p>;

  return <div className="space-y-6">
    {confirmElement}
    {heading}
    <div className="notice flex gap-3 text-sm"><ShieldCheck className="mt-0.5 size-5 shrink-0" /><p>En nyckel som Workflow skapar visas bara en gång och sparas som ett kontrollvärde, inte i klartext. Den gäller för den person du väljer, med exakt personens rättigheter i Workflow och bara de behörigheter som valts; pausas personen slutar nyckeln fungera. Externa nycklar sparas krypterade och visas aldrig igen.</p></div>

    <Panel title="API-nycklar" description="För egna system och integrationer som läser eller skriver data i Workflow."
      leadingActions={<span className="panel-icon" aria-hidden="true"><KeyRound className="size-4" /></span>}
      actions={<Button type="button" size="sm" onClick={() => setIssueKind("API")} data-testid="issue-api"><Plus />Ny API-nyckel</Button>}>
      {issuedList("API")}
    </Panel>

    <ConnectionPanel />

    <Panel title="MCP – AI-klienter" description="För AI-klienter som arbetar mot Workflow via MCP, inom behörigheten hos den person nyckeln gäller för. Använder inte företagets AI-krediter – AI-klienten står för sin egen AI."
      leadingActions={<span className="panel-icon" aria-hidden="true"><Bot className="size-4" /></span>}
      actions={<Button type="button" size="sm" onClick={() => setIssueKind("MCP")} data-testid="issue-mcp"><Plus />Ny MCP-nyckel</Button>}>
      {issuedList("MCP")}
    </Panel>

    <Panel title="Externa nycklar" description="Nycklar som hämtas från en annan tjänst – företagets egen AI-nyckel eller integrationer – och klistras in här."
      leadingActions={<span className="panel-icon" aria-hidden="true"><Plug className="size-4" /></span>}
      actions={<Button type="button" size="sm" onClick={() => setExternalOpen(true)} data-testid="add-external"><Plus />Lägg till nyckel</Button>}>
      {ofKind("EXTERNAL").length ? <ul className="divide-y rounded-lg border" aria-label="Externa nycklar">
        {ofKind("EXTERNAL").map((key) => <li key={key.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="external-key">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">{key.name} <Badge variant="secondary">{providerLabel(key.provider)}</Badge><StateBadge state={keyState(key)} /></p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{key.displayHint}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Tillagd {date(key.createdAt)} av {key.createdBy}{key.updatedAt !== key.createdAt ? ` · ändrad ${date(key.updatedAt)}` : ""}</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setReplacing(key)}><RefreshCw />Byt</Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void revoke(key)}><Trash2 />Ta bort</Button>
          </div>
        </li>)}
      </ul> : <Empty title="Inga externa nycklar" description="Lägg till en nyckel från er AI-leverantör eller en annan tjänst när ni vill koppla den till Workflow." />}
    </Panel>

    {server ? <ServerKeys keys={server} notify={notify} onChecked={(id, lastCheck) => setServer((current) => current?.map((key) => key.id === id ? { ...key, lastCheck } : key) ?? null)} /> : null}

    {revoked.length ? <Panel title="Återkallade och borttagna" collapsible defaultCollapsed description="De senaste tio, som historik. De fungerar inte längre.">
      <ul className="divide-y rounded-lg border text-sm">{revoked.map((key) => <li key={key.id} className="flex flex-wrap items-center gap-2 p-3 text-muted-foreground"><StateBadge state={keyState(key)} />{key.name} · {key.kind === "EXTERNAL" ? providerLabel(key.provider) : key.kind} · {key.displayHint} · {date(key.revokedAt)}{key.lastUsedAt ? ` · senast använd ${date(key.lastUsedAt)}` : ""}</li>)}</ul>
    </Panel> : null}

    {issueKind ? <IssueDialog key={issueKind} kind={issueKind} busy={busy} members={members} currentUserId={currentUserId} onClose={() => setIssueKind(null)} onIssue={async (payload) => {
      try {
        const result = await send({ action: "issue", ...payload });
        setIssueKind(null);
        setShownToken({ name: payload.name, token: result.token! });
        await load();
      } catch (cause) { notify((cause as Error).message, true); }
    }} /> : null}
    {externalOpen || replacing ? <ExternalDialog key={replacing?.id ?? "new"} replacing={replacing} busy={busy} onClose={() => { setExternalOpen(false); setReplacing(null); }} onSave={async (payload) => {
      try {
        await send(replacing ? { action: "replace_external", id: replacing.id, value: payload.value } : { action: "add_external", ...payload });
        notify(replacing ? "Nyckeln är bytt." : "Nyckeln är sparad krypterad.");
        setExternalOpen(false);
        setReplacing(null);
        await load();
      } catch (cause) { notify((cause as Error).message, true); }
    }} /> : null}
    <Modal open={Boolean(shownToken)} onOpenChange={(open) => { if (!open) setShownToken(null); }} title="Kopiera nyckeln nu">
      <p className="text-sm text-muted-foreground">Nyckeln ”{shownToken?.name}” visas bara den här gången. Spara den i det system som ska använda den.</p>
      <div className="mt-4 flex gap-2">
        <Input readOnly value={shownToken?.token ?? ""} aria-label="Ny nyckel" className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} data-testid="issued-token" />
        <Button type="button" variant="outline" onClick={() => { void navigator.clipboard?.writeText(shownToken?.token ?? "").then(() => notify("Nyckeln är kopierad.")).catch(() => notify("Markera och kopiera nyckeln själv.", true)); }}><Copy />Kopiera</Button>
      </div>
      <Button type="button" className="mt-4 w-full" onClick={() => setShownToken(null)}>Jag har sparat nyckeln</Button>
    </Modal>
  </div>;
}

/**
 * Serverns nycklar (Daniel 2026-09-29): the keys HINTEK's own server runs with, for HINTEK's superadmin only. Status
 * only – configured or missing, test or live, the switches that use them and the last check. Never a value.
 */
function ServerKeys({ keys, notify, onChecked }: { keys: ServerKeyRow[]; notify: (text: string, error?: boolean) => void; onChecked: (id: string, lastCheck: ServerKeyRow["lastCheck"]) => void }) {
  const [checking, setChecking] = useState<string | null>(null);
  const check = async (key: ServerKeyRow) => {
    setChecking(key.id);
    try {
      const result = await api<{ ok: boolean; message: string; at: string }>("/api/integration-keys", { method: "POST", body: JSON.stringify({ action: "check_server", id: key.id }) });
      onChecked(key.id, result);
      notify(result.message, !result.ok);
    } catch (cause) { notify((cause as Error).message, true); } finally { setChecking(null); }
  };
  return <Panel title="Serverns nycklar" description="Nycklarna som HINTEK:s server använder. Bara HINTEK:s superadmin ser detta, och bara status – värdena visas aldrig. De ändras i serverns miljö."
    leadingActions={<span className="panel-icon" aria-hidden="true"><Server className="size-4" /></span>}>
    <ul className="divide-y rounded-lg border" aria-label="Serverns nycklar">
      {keys.map((key) => {
        const status: { label: string; tone: IndicatorTone } = !key.configured && key.formatOk !== false ? { label: "Saknas", tone: "neutral" }
          : key.formatOk === false ? { label: "Fel form", tone: "danger" } : { label: "Konfigurerad", tone: "success" };
        return <li key={key.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="server-key" data-key={key.id}>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">{key.label}
              <Pill tone={status.tone} testId="server-key-status">{status.label}</Pill>
              {key.mode ? <Pill tone={key.mode === "live" ? "warning" : "info"} testId="server-key-mode">{key.mode === "live" ? "Live" : "Test"}</Pill> : null}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{key.note}</p>
            {key.switches.length ? <p className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Påslaget i servern">
              {key.switches.map((item) => <Pill key={item.label} tone={item.on ? "success" : "neutral"}>{item.label}: {item.on ? "på" : "av"}</Pill>)}
            </p> : null}
            <p className="mt-1.5 text-xs text-muted-foreground">
              <span className="font-mono text-[11px]">{key.variables.join(" · ")}</span>
              {" · "}
              <span data-testid="server-key-check" className={key.lastCheck && !key.lastCheck.ok ? "text-red-700 dark:text-red-300" : undefined}>
                {key.lastCheck ? `Senast kontrollerad ${formatSwedish(key.lastCheck.at, { dateStyle: "medium", timeStyle: "short" })}: ${key.lastCheck.message}` : "Inte kontrollerad ännu"}
              </span>
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={checking !== null} onClick={() => void check(key)} aria-label={`Kontrollera ${key.label}`}>
            <Stethoscope />{checking === key.id ? "Kontrollerar…" : "Kontrollera"}
          </Button>
        </li>;
      })}
    </ul>
    <p className="mt-2 text-xs text-muted-foreground">Kontrollera frågar Stripe (bara testnyckel) och e-postservern om nyckeln godtas, utan att visa den. Övriga kontrolleras till formen, utan anrop – AI är pausad.</p>
  </Panel>;
}

function IssueDialog({ kind, busy, members, currentUserId, onClose, onIssue }: { kind: IssuedKind; busy: boolean; members: Member[]; currentUserId: string; onClose: () => void; onIssue: (payload: { kind: IssuedKind; name: string; scopes: string[]; expiresInDays: number; actingUserId?: string }) => void }) {
  const [name, setName] = useState("");
  const [actingUserId, setActingUserId] = useState(currentUserId);
  const [scopes, setScopes] = useState<string[]>(() => (kind === "MCP" ? ["mcp:read"] : ["projects:read", "tasks:read"]));
  const [expires, setExpires] = useState(90);
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={kind === "MCP" ? "Ny MCP-nyckel" : "Ny API-nyckel"}>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onIssue({ kind, name, scopes, expiresInDays: expires, actingUserId: actingUserId || undefined }); }}>
      <div className="grid gap-1.5"><label htmlFor="key-name" className="field-label text-xs font-medium">Namn</label><Input id="key-name" value={name} required maxLength={80} placeholder={kind === "MCP" ? "Till exempel Claude på Elins dator" : "Till exempel Affärssystem"} onChange={(event) => setName(event.target.value)} /></div>
      <div className="grid gap-1.5"><label htmlFor="key-member" className="field-label text-xs font-medium">Gäller för</label>
        <select id="key-member" className="form-select" value={actingUserId} onChange={(event) => setActingUserId(event.target.value)} data-testid="key-member">
          {members.map((member) => <option key={member.id} value={member.id}>{member.name}{member.id === currentUserId ? " (du)" : member.admin ? " (admin)" : ""}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">Nyckeln får aldrig göra mer än personen själv får i Workflow. Behörigheterna nedan begränsar den ytterligare.</p>
      </div>
      <fieldset><legend className="mb-2 text-xs font-medium">Behörigheter</legend><div className="grid gap-2">
        {KEY_SCOPES[kind].map((scope) => <label key={scope.key} className="flex items-center gap-2 text-sm"><Checkbox checked={scopes.includes(scope.key)} onCheckedChange={(value) => setScopes((current) => value === true ? [...current, scope.key] : current.filter((item) => item !== scope.key))} />{scope.label}</label>)}
      </div></fieldset>
      <div className="grid gap-1.5"><label htmlFor="key-expiry" className="field-label text-xs font-medium">Giltighet</label>
        <select id="key-expiry" className="form-select" value={expires} onChange={(event) => setExpires(Number(event.target.value))}>
          {EXPIRY_CHOICES.map((days) => <option key={days} value={days}>{days ? `${days} dagar` : "Inget slutdatum"}</option>)}
        </select>
      </div>
      <Button type="submit" className="w-full" disabled={busy || !name.trim() || !scopes.length}><KeyRound />Skapa nyckel</Button>
    </form>
  </Modal>;
}

function ExternalDialog({ replacing, busy, onClose, onSave }: { replacing: KeyRow | null; busy: boolean; onClose: () => void; onSave: (payload: { name: string; provider: string; value: string }) => void }) {
  const [name, setName] = useState(replacing?.name ?? "");
  const [provider, setProvider] = useState<string>(replacing?.provider ?? "openai");
  const [value, setValue] = useState("");
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={replacing ? `Byt nyckel – ${replacing.name}` : "Lägg till extern nyckel"}>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave({ name, provider, value }); }}>
      {!replacing ? <>
        <div className="grid gap-1.5"><label htmlFor="external-provider" className="field-label text-xs font-medium">Tjänst</label>
          <select id="external-provider" className="form-select" value={provider} onChange={(event) => setProvider(event.target.value)}>
            {EXTERNAL_PROVIDERS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5"><label htmlFor="external-name" className="field-label text-xs font-medium">Namn</label><Input id="external-name" value={name} required maxLength={80} placeholder="Till exempel Företagets OpenAI-nyckel" onChange={(event) => setName(event.target.value)} /></div>
      </> : null}
      <div className="grid gap-1.5"><label htmlFor="external-value" className="field-label text-xs font-medium">Nyckel</label>
        <Input id="external-value" type="password" autoComplete="off" value={value} required minLength={8} placeholder="Klistra in nyckeln från tjänsten" onChange={(event) => setValue(event.target.value)} />
        <p className="text-xs text-muted-foreground">Sparas krypterad. Efteråt visas bara de fyra sista tecknen.</p>
      </div>
      <Button type="submit" className="w-full" disabled={busy || value.trim().length < 8 || (!replacing && !name.trim())}><KeyRound />{replacing ? "Byt nyckel" : "Spara nyckel"}</Button>
    </form>
  </Modal>;
}

/** How an external system or AI client connects (Daniel 2026-09-30): the addresses and the header, nothing secret. */
function ConnectionPanel() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return <Panel title="Anslut" description="Adresserna för API och MCP. Nyckeln skickas i huvudet Authorization: Bearer <nyckel>." collapsible defaultCollapsed>
    <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="connection-panel">
      <div className="rounded-lg border p-3"><dt className="text-xs font-medium text-muted-foreground">MCP-server (Streamable HTTP)</dt><dd className="mt-1 break-all font-mono text-xs">{origin}/api/mcp</dd>
        <dd className="mt-2 text-xs text-muted-foreground">Lägg till servern i AI-klienten som en fjärrserver med huvudet Authorization och en MCP-nyckel. Verktygen för att söka, lista, hämta, skapa, ändra och ta bort visas efter nyckelns behörigheter.</dd></div>
      <div className="rounded-lg border p-3"><dt className="text-xs font-medium text-muted-foreground">API</dt><dd className="mt-1 break-all font-mono text-xs">{origin}/api/v1</dd>
        <dd className="mt-2 text-xs text-muted-foreground">GET /api/v1 listar verktygen och deras indata. POST /api/v1/tools/&lt;namn&gt; kör ett verktyg med JSON. Samma verktyg som MCP och Workflows egen AI.</dd></div>
    </dl>
    <p className="mt-3 text-xs text-muted-foreground">Permanent radering finns inte via nycklar. Ändringar som görs med en nyckel loggas med nyckelns namn i företagets administrationshistorik.</p>
  </Panel>;
}
