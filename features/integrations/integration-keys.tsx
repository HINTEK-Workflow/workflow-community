"use client";
import { useCallback, useEffect, useState } from "react";
import { Bot, Bug, CreditCard, KeyRound, LogIn, Mail, Map as MapIcon, Plug, Plus, RefreshCw, Store, ShieldCheck, Trash2, type LucideIcon, History, Link2 } from "lucide-react";
import { sameSectionStatus, ServerKeyStatusReport, serverKeySectionAnchor, type ServerKeyGroupId, type ServerKeySectionId, type ServerKeySectionStatus, type ServiceToggle } from "./server-key-status";
import { KeyOverview, type OverviewCategory } from "./key-overview";
import { PageHeader } from "@/components/page-shell";
import { SettingsGroup } from "@/features/workflow/section-tabs";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatSwedish } from "@/lib/swedish-time";
import { useInstance } from "@/components/instance-provider";
import { EXPIRY_CHOICES, EXTERNAL_PROVIDERS, isOtherKeyProvider, KEY_SCOPES, keyState, type ExternalProvider, type IssuedKind, type KeyState } from "@/lib/integrations/key-catalog";
import type { ServerKeyStatus } from "@/lib/integrations/server-keys";
import type { IndicatorTone } from "@/features/workflow/indicator-tone";
import { DialogActions, Modal, Panel } from "../../features/kfid/ui";
import { DialogPage } from "../../features/kfid/dialog-page";
import { api } from "../../features/kfid/api";
import { useConfirm } from "../../features/kfid/confirm";
import { KeyField, SecretField } from "../../features/kfid/secret-field";
import { useLoadEffect } from "@/lib/use-load-effect";
import { SolarRegister } from "./solar-register";
import { StatusPill } from "./status-pill";
import { CentralStorePanel, centralStoreState, type CentralOverview } from "./central-store-panel";
import type { CentralKeysUi } from "@/lib/extensions/types";
import { clientExtensions } from "@ee/client";
import { KEY_STATUS, KeyCard, KeyCardActions, KeyCardGrid, KeyCardsGuard, KeyExpiryProvider, KeyExpiryScope, KeyFields, KeyTextField, type KeyCardStatus, type KeyExpiryDates } from "./key-card";
import { expiryCounts } from "@/lib/secrets/key-expiry";

type KeyRow = {
  id: string; kind: "API" | "MCP" | "EXTERNAL"; name: string; provider: string | null; scopes: string[]; displayHint: string;
  expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string; updatedAt: string; createdBy: string; actsFor?: string;
};
type Member = { id: string; name: string; admin: boolean };

type ServerKeyRow = ServerKeyStatus & { lastCheck: { ok: boolean; message: string; at: string } | null };
/** A card's own check in place of the server's (the OpenAI card's typed key). */
type CardCheck = () => Promise<void>;

const date = (value: string | null) => (value ? formatSwedish(value, { dateStyle: "medium" }) : "–");
const STATE: Record<KeyState, { label: string; tone: IndicatorTone }> = {
  active: { label: "Aktiv", tone: "success" },
  expiring: { label: "Går ut snart", tone: "warning" },
  expired: { label: "Utgången", tone: "danger" },
  revoked: { label: "Återkallad", tone: "neutral" },
  removed: { label: "Borttagen", tone: "neutral" },
};
const StateBadge = ({ state }: { state: KeyState }) => <Pill tone={STATE[state].tone} testId="key-state">{STATE[state].label}</Pill>;
const Pill = StatusPill;
const providerLabel = (key: string | null) => EXTERNAL_PROVIDERS.find((item) => item.key === key)?.label ?? "Annan tjänst";
const providerUse = (key: string | null) => EXTERNAL_PROVIDERS.find((item) => item.key === key)?.use ?? EXTERNAL_PROVIDERS.find((item) => item.key === "other")!.use;
/** The services a new key can be added for here: those offered (S4: AI is central, so no AI key per company) among the shown. */
const offeredProviders = (providers?: readonly ExternalProvider[]) => EXTERNAL_PROVIDERS.filter((item) => item.offered && (!providers || providers.includes(item.key)));
const scopeSummary = (scopes: string[]) => (scopes.length > 3 ? `${scopes.slice(0, 3).map(scopeLabel).join(" · ")} + ${scopes.length - 3} till` : scopes.map(scopeLabel).join(" · "));
const scopeLabel = (key: string) => [...KEY_SCOPES.API, ...KEY_SCOPES.MCP].find((item) => item.key === key)?.label ?? key;

/**
 * API och MCP (2026-09-29): the keys the company uses with Workflow – keys Workflow issues for the API and for MCP
 * clients, and keys fetched from other services. Company admins only; nothing secret is ever shown again.
 *
 * Since the overview of Kopplingar (2026-10-31, features/integrations/connections.tsx) each area draws its own part:
 * `part="api"` the API and MCP keys, the connected apps and the addresses; `part="external"` the pasted keys of one connection
 * (`providers`): the Fortnox key on Bokföring, the payroll system's on Lön och export (also under Tid). Every key beside its
 * connection (2026-11-03): the row Andra tjänsters nycklar is gone, and older keys of no connection (AI, Microsoft 365,
 * "Annan tjänst") stand under Övriga nycklar at the foot of API och MCP, folded, with a bin, until the owner removes them.
 * The page's own heading is the area's.
 */
export type IntegrationKeysPart = "api" | "external";
export function IntegrationKeys({ notify, part = "api", providers, title = "Nycklar", description = "Sparas krypterat för företaget. Varje rad säger vad Workflow använder nyckeln till.", inGrid = false }: {
  notify: (text: string, error?: boolean) => void; part?: IntegrationKeysPart;
  /** The external keys shown and offered (part "external"); all when left out. */
  providers?: readonly ExternalProvider[]; title?: string; description?: string;
  /** The key card stands in the caller's KeyCardGrid (a <li> there, beside the connection's own card), not in a grid of its own. */
  inGrid?: boolean;
}) {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [revoked, setRevoked] = useState<KeyRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [issueKind, setIssueKind] = useState<IssuedKind | null>(null);
  const [externalOpen, setExternalOpen] = useState(false);
  const [replacing, setReplacing] = useState<KeyRow | null>(null);
  const [shownToken, setShownToken] = useState<{ name: string; token: string } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [confirm, confirmElement] = useConfirm();

  const load = useCallback(async () => {
    try {
      const result = await api<{ keys: KeyRow[]; revoked: KeyRow[]; members: Member[]; currentUserId: string; connections?: Connection[] }>("/api/integration-keys");
      setConnections(result.connections ?? []);
      setKeys(result.keys);
      setMembers(result.members ?? []);
      setCurrentUserId(result.currentUserId ?? "");
      setRevoked(result.revoked);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);
  useLoadEffect(load);

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

  const disconnectApp = async (connection: Connection) => {
    if (!(await confirm({ title: "Koppla från appen?", message: `”${connection.app}” slutar fungera direkt och måste godkännas igen för att ansluta på nytt.`, confirmLabel: "Koppla från", tone: "danger" }))) return;
    try {
      await send({ action: "disconnect_app", id: connection.id });
      notify("Appen är bortkopplad.");
      await load();
    } catch (cause) { notify((cause as Error).message, true); }
  };

  // The key is shown once: closing without the button asks first (a key that was never saved has to be made again).
  const closeToken = async () => {
    if (await confirm({ title: "Stäng ändå?", message: "Nyckeln visas bara nu.", confirmLabel: "Stäng ändå", tone: "danger" })) setShownToken(null);
  };
  if (error) return <p role="alert" className="notice text-destructive">{error}</p>;
  if (!keys) return <p className="page-description">Hämtar nycklar…</p>;
  const shownProvider = (key: Pick<KeyRow, "provider">) => !providers || providers.includes((key.provider ?? "other") as ExternalProvider);
  const ofKind = (kind: KeyRow["kind"]) => keys.filter((key) => key.kind === kind && (kind !== "EXTERNAL" || shownProvider(key)));
  // Övriga nycklar (API och MCP only): the pasted keys of no connection, until they are removed. Nothing is deleted by code.
  const others = part === "api" ? keys.filter((key) => key.kind === "EXTERNAL" && isOtherKeyProvider(key.provider)) : [];
  // The history of the part: issued keys (and removed keys of no connection) on API och MCP, removed keys of the connection on the others.
  const history = revoked.filter((key) => (part === "api" ? key.kind !== "EXTERNAL" || isOtherKeyProvider(key.provider) : key.kind === "EXTERNAL" && shownProvider(key)));
  const externalRow = (key: KeyRow, replaceable: boolean) => <li key={key.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="external-key">
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">{key.name} <Badge variant="secondary">{providerLabel(key.provider)}</Badge><StateBadge state={keyState(key)} /></p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{key.displayHint}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Tillagd {date(key.createdAt)} av {key.createdBy}{key.updatedAt !== key.createdAt ? ` · ändrad ${date(key.updatedAt)}` : ""}</p>
      <p className="mt-0.5 text-xs text-muted-foreground" data-testid="external-key-use">{providerUse(key.provider)}</p>
    </div>
    <div className="flex gap-2">
      {replaceable ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setReplacing(key)}><RefreshCw />Byt</Button> : null}
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void revoke(key)}><Trash2 />Ta bort</Button>
    </div>
  </li>;

  const issuedList = (kind: IssuedKind) => ofKind(kind).length ? <ul className="divide-y rounded-lg border" aria-label={kind === "API" ? "API-nycklar" : "MCP-nycklar"}>
    {ofKind(kind).map((key) => <li key={key.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="integration-key">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">{key.name} <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{key.displayHint}</code><StateBadge state={keyState(key)} /></p>
        <p className="mt-1 text-xs text-muted-foreground">Gäller för {key.actsFor ?? key.createdBy} · <span title={key.scopes.map(scopeLabel).join(", ")}>{scopeSummary(key.scopes)}</span></p>
        <p className="mt-0.5 text-xs text-muted-foreground">Skapad {date(key.createdAt)} av {key.createdBy} · {key.expiresAt ? `gäller till ${date(key.expiresAt)}` : "inget slutdatum"} · {key.lastUsedAt ? `senast använd ${date(key.lastUsedAt)}` : "aldrig använd"}</p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void revoke(key)}><Trash2 />Återkalla</Button>
    </li>)}
  </ul> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Inga {kind === "API" ? "API-nycklar" : "MCP-nycklar"} ännu.</p>;

  return <div className="space-y-6">
    {confirmElement}
    {part === "api" ? <>
    <div className="notice flex gap-3 text-sm"><ShieldCheck className="mt-0.5 size-5 shrink-0" /><p>En ny nyckel visas bara en gång. Den får personens behörigheter, men bara inom det du har valt för nyckeln.</p></div>

    <Panel title="API-nycklar" description="För egna system och integrationer som läser eller skriver data i Workflow."
      icon={KeyRound}
      actions={<Button type="button" size="sm" onClick={() => setIssueKind("API")} data-testid="issue-api"><Plus />Ny API-nyckel</Button>}>
      {issuedList("API")}
    </Panel>

    <ConnectionPanel />

    <Panel title="MCP – AI-klienter" description="För AI-klienter via MCP. Kostar inga AI-krediter."
      icon={Bot}
      actions={<Button type="button" size="sm" onClick={() => setIssueKind("MCP")} data-testid="issue-mcp"><Plus />Ny MCP-nyckel</Button>}>
      {issuedList("MCP")}
      <div className="mt-4" data-testid="oauth-connections">
        <p className="text-sm font-medium">Anslutna appar (OAuth)</p>
        <p className="mt-1 text-xs text-muted-foreground">Appar som ChatGPT ansluter med inloggning i stället för nyckel. Appen får personens behörigheter.</p>
        {connections.some((item) => !item.revokedAt) ? <ul className="mt-2 divide-y rounded-lg border" aria-label="Anslutna appar">
          {connections.filter((item) => !item.revokedAt).map((connection) => <li key={connection.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="oauth-connection">
            <div className="min-w-0">
              <p className="font-medium">{connection.app}{connection.redirectHost ? <span className="font-normal text-muted-foreground"> · {connection.redirectHost}</span> : null}</p>
              <p className="mt-1 text-xs text-muted-foreground">Agerar som {connection.person} · <span title={connection.scopes.map(scopeLabel).join(", ")}>{scopeSummary(connection.scopes)}</span></p>
              <p className="mt-0.5 text-xs text-muted-foreground">Godkänd {date(connection.createdAt)} · {connection.lastUsedAt ? `senast använd ${date(connection.lastUsedAt)}` : "aldrig använd"}</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void disconnectApp(connection)}><Trash2 />Koppla från</Button>
          </li>)}
        </ul> : <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Inga anslutna appar.</p>}
      </div>
    </Panel>

    </> : null}

    {/* A connection's pasted key (användartest 2026-10-31, F6: "Workflow använder dem inte ännu" was untrue for Fortnox): each row
        says what Workflow does with that service's key. */}
    {/* The same key card as everywhere (2026-11-11): the pasted keys are a list with Byt and Ta bort, each saved in its own dialog. */}
    {part === "external" ? (() => { const card = <KeyCard icon={Plug} title={title} status={ofKind("EXTERNAL").length ? KEY_STATUS.untested : KEY_STATUS.missing} statusTestId="external-keys-status"
      more={<p>{description}</p>} moreTestId="external-keys-more"
      actions={offeredProviders(providers).length ? <Button type="button" variant="outline" onClick={() => setExternalOpen(true)} data-testid="add-external"><Plus />Lägg till nyckel</Button> : null}>
      {ofKind("EXTERNAL").length ? <ul className="space-y-4 [&>li]:p-0" aria-label="Externa nycklar">{ofKind("EXTERNAL").map((key) => externalRow(key, true))}</ul>
        : <p className="text-xs text-muted-foreground" data-testid="external-keys-empty">{offeredProviders(providers).length ? "Ingen nyckel ännu. Lägg till nyckeln från ert system." : "Ingen nyckel är inlagd."}</p>}
    </KeyCard>;
      return inGrid ? <div className="min-w-0" data-testid="external-keys-card">{card}</div> : <KeyCardGrid label={title}><li className="min-w-0" data-testid="external-keys-card">{card}</li></KeyCardGrid>;
    })() : null}

    {/* Övriga nycklar (2026-11-03): older rows of no connection, folded, with a bin only; the card goes when the last row does. */}
    {others.length ? <div data-testid="other-keys"><Panel title="Övriga nycklar" icon={Plug} collapsible defaultCollapsed count={others.length}
      description="Gamla nycklar som Workflow inte använder. Ta bort dem när de inte behövs.">
      <ul className="divide-y rounded-lg border" aria-label="Övriga nycklar">{others.map((key) => externalRow(key, false))}</ul>
    </Panel></div> : null}

    {history.length ? <Panel icon={History} title={part === "api" ? "Återkallade nycklar" : "Borttagna nycklar"} collapsible defaultCollapsed description="De senaste, som historik. De fungerar inte längre.">
      <ul className="divide-y rounded-lg border text-sm">{history.map((key) => <li key={key.id} className="flex flex-wrap items-center gap-2 p-3 text-muted-foreground"><StateBadge state={keyState(key)} />{key.name} · {key.kind === "EXTERNAL" ? providerLabel(key.provider) : key.kind} · {key.displayHint} · {date(key.revokedAt)}{key.lastUsedAt ? ` · senast använd ${date(key.lastUsedAt)}` : ""}</li>)}</ul>
    </Panel> : null}

    {issueKind ? <IssueDialog key={issueKind} kind={issueKind} busy={busy} members={members} currentUserId={currentUserId} onClose={() => setIssueKind(null)} onIssue={async (payload) => {
      try {
        const result = await send({ action: "issue", ...payload });
        setIssueKind(null);
        setShownToken({ name: payload.name, token: result.token! });
        await load();
      } catch (cause) { notify((cause as Error).message, true); }
    }} /> : null}
    {externalOpen || replacing ? <ExternalDialog key={replacing?.id ?? "new"} replacing={replacing} providers={offeredProviders(providers)} busy={busy} onClose={() => { setExternalOpen(false); setReplacing(null); }} onSave={async (payload) => {
      try {
        await send(replacing ? { action: "replace_external", id: replacing.id, value: payload.value } : { action: "add_external", ...payload });
        notify(replacing ? "Nyckeln är bytt." : "Nyckeln är sparad krypterad.");
        setExternalOpen(false);
        setReplacing(null);
        await load();
      } catch (cause) { notify((cause as Error).message, true); }
    }} /> : null}
    <Modal open={Boolean(shownToken)} onOpenChange={(open) => { if (!open) void closeToken(); }} title="Kopiera nyckeln nu" size="compact">
      <KeyField id="issued-token" label="Din nya nyckel" className="mt-1" hint={<>Nyckeln ”{shownToken?.name}” visas bara nu. Spara den där den ska användas.</>}>
        <Input id="issued-token" readOnly value={shownToken?.token ?? ""} className="min-w-0 flex-1 basis-56 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} data-testid="issued-token" />
        <CopyButton value={shownToken?.token ?? ""} onCopied={() => notify("Nyckeln är kopierad.")} onFailed={() => notify("Markera och kopiera nyckeln själv.", true)} />
      </KeyField>
      <Button type="button" className="mt-4 w-full" onClick={() => setShownToken(null)}>Jag har sparat nyckeln</Button>
    </Modal>
  </div>;
}

/**
 * Servernycklar (2026-09-29, a tab under Installation since 2026-10-03): the keys Workflow's own server
 * runs with, for Workflow's superadmin only. Status – in place or not, test or live, what is switched on, the last check
 * and (since 2026-10-09, at the product owner's request) whether the value is entered in the app or comes from the server's settings
 * file. Stripe's and Google's keys are entered here (dots, a bin, a new value replaces). Never a value.
 */
type KeyAlerts = { on: boolean; email: string | null; blocked: string | null };
/** Gäller till (2026-11-14): the cards' own dates, and the days known in another way (SCB's own date, the key vault's token). */
type KeyExpiry = { dates: KeyExpiryDates; known: Record<string, string> };

// Sidans grupper i ordning (2026-10-18: "nycklarna ligger lite huller om buller"): kort av samma slag under en kort
// rubrik; översiktens rutor följer samma grupper och hoppar dit. `keys` är servernycklarnas id, `parts` de andra korten.
type PartId = "scb" | "map" | "microsoft" | "azure" | "github";
type KeyGroup = { id: ServerKeyGroupId; title: string; icon: LucideIcon; keys: string[]; parts: PartId[] };
const KEY_GROUPS: KeyGroup[] = [
  { id: "payment", title: "Betalning", icon: CreditCard, keys: ["stripe_secret", "stripe_webhook"], parts: [] },
  { id: "ai", title: "AI", icon: Bot, keys: ["openai"], parts: ["azure"] },
  { id: "login", title: "Inloggning", icon: LogIn, keys: ["google"], parts: ["microsoft"] },
  { id: "wholesale", title: "Grossister", icon: Store, keys: ["solar", "ahlsell", "rexel", "sonepar"], parts: [] },
  { id: "email", title: "E-post", icon: Mail, keys: ["smtp"], parts: [] },
  // Rapportera fel eller förslag (2026-11-13): the GitHub key, a card only the commercial part hands over.
  { id: "support", title: "Felrapporter", icon: Bug, keys: [], parts: ["github"] },
  { id: "security", title: "Säkerhet", icon: ShieldCheck, keys: ["integration_keys", "auth"], parts: [] },
  // Lantmäteriet samlat längst ned (2026-10-18).
  { id: "lookup", title: "Uppslag och kartor", icon: MapIcon, keys: [], parts: ["scb", "map"] },
];
/** The keys' names while the page reads them, so the overview's rows stand where they will be. */
const KEY_NAME: Record<string, string> = {
  stripe_secret: "Stripe – hemlig nyckel", stripe_webhook: "Stripe – webhookhemlighet", openai: "OpenAI – API-nyckel", google: "Google-inloggning",
  solar: "Solar – API (grunddata och lager)", smtp: "E-post (SMTP)", integration_keys: "Kryptering av externa nycklar", auth: "Inloggningshemlighet",
};
/** The name a part's row has in the overview until its card has told its own. */
const PART_NAME: Record<PartId, string> = { scb: "Företagsuppslag (SCB)", map: "Lantmäteriet", microsoft: "Inloggning med Microsoft", azure: "EU-leverantör (Azure OpenAI)", github: "GitHub-ärenden" };
/**
 * Nycklar som ingen grupp känner till hamnar sist i Säkerhet, så ingen försvinner. A prepared wholesaler (Ahlsell, Rexel,
 * Sonepar: no documented API yet) is no card of its own (D9, UX-punkt 6): the group says "Fler grossister kommer" instead.
 */
function keysOfGroup(group: KeyGroup, keys: ServerKeyRow[]) {
  const known = new Set(KEY_GROUPS.flatMap((item) => item.keys));
  return keys.filter((key) => !key.prepared && (group.keys.includes(key.id) || (group.id === "security" && !known.has(key.id))))
    .sort((a, b) => (group.keys.indexOf(a.id) + 1 || 99) - (group.keys.indexOf(b.id) + 1 || 99));
}
const preparedOfGroup = (group: KeyGroup, keys: ServerKeyRow[]) => keys.filter((key) => key.prepared && group.keys.includes(key.id));
/** "Ahlsell, Rexel och Sonepar". */
const listed = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} och ${names.at(-1)}` : names[0] ?? "";

/**
 * One key's state, the same words on its card and in the overview (2026-11-01): Fungerar only after a real answer from
 * the service; a key only its form can be checked for is Ej provad, never approved. A wrong form or a failed check is Fel.
 */
function serverKeyState(key: ServerKeyRow): KeyCardStatus {
  if (key.prepared) return { label: "Inte ansluten", tone: "neutral" };
  if (key.formatOk === false) return { ...KEY_STATUS.failed, problem: key.fields && /saknas/.test(key.note) ? key.note : "Värdet har fel form." };
  if (!key.configured) return KEY_STATUS.missing;
  if (key.check === "format" || !key.lastCheck) return KEY_STATUS.untested;
  return key.lastCheck.ok ? KEY_STATUS.works : { ...KEY_STATUS.failed, problem: key.lastCheck.message };
}

/**
 * Servernycklars sida: rubrik, en översikt med varje tjänsts status och av/på (2026-11-11), sedan grupperna med sina kort,
 * två lika breda per rad (2026-10-08: "vilka nycklar som finns och saknas"). Korten behåller sin egen maskning och
 * åtkomst; `parts` är de andra korten på sidan (SCB, Microsoft, Lantmäteriet, Azure) som rapporterar status och av/på till
 * översikten, `payments` Stripes testkort.
 */
export function ServerKeysAdministration({ notify, parts, payments, extras, after }: {
  notify: (text: string, error?: boolean) => void; parts?: Partial<Record<PartId, React.ReactNode>>; payments?: React.ReactNode;
  /**
   * C6 (2026-10-21): what is set for a key, inside its own card – the OpenAI key and Workflow AI's choices, the
   * e-mail server's details – so each value is in one place and is saved with the card's Spara. `refresh` reads the cards'
   * status again after a save.
   */
  extras?: Partial<Record<string, (refresh: () => void, row: ServerKeyRow, bindCheck: (handler: CardCheck | null) => void) => React.ReactNode>>;
  /** Cards under a group's own (the EU provider and the AI status under AI). */
  after?: Partial<Record<ServerKeyGroupId, React.ReactNode>>;
}) {
  const { features } = useInstance();
  const [keys, setKeys] = useState<ServerKeyRow[] | null>(null);
  const [alerts, setAlerts] = useState<KeyAlerts | null>(null);
  const [central, setCentral] = useState<CentralOverview | null>(null);
  // Gäller till (2026-11-14): each card's optional last day, and the days known in another way (SCB, the vault's token).
  const [expiry, setExpiry] = useState<KeyExpiry>({ dates: {}, known: {} });
  // Workflow's key vault on Central lagring (ee/, 2026-11-10): loaded together with the data, so nothing changes once shown.
  const [vaultUi, setVaultUi] = useState<CentralKeysUi | null>(null);
  const [error, setError] = useState("");
  const [reported, setReported] = useState<Partial<Record<ServerKeySectionId, ServerKeySectionStatus>>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [confirm, confirmElement] = useConfirm();
  // One Kontrollera per card (2026-10-24, answer 5): what a card holds may take over its check – the OpenAI card's
  // key field while a new key is typed in it; without one the card checks the saved key on the server.
  const [ownChecks] = useState(() => new Map<string, CardCheck>());
  const bindCheck = useCallback((id: string, handler: CardCheck | null) => { if (handler) ownChecks.set(id, handler); else ownChecks.delete(id); }, [ownChecks]);
  const report = useCallback((id: ServerKeySectionId, status: ServerKeySectionStatus) => setReported((current) => sameSectionStatus(current[id], status) ? current : { ...current, [id]: status }), []);
  const refresh = useCallback(() => {
    Promise.all([api<{ server: ServerKeyRow[]; alerts: KeyAlerts; central?: CentralOverview; expiry?: KeyExpiry }>("/api/integration-keys?scope=server"), clientExtensions.loadCentralKeysUi?.() ?? null])
      .then(([result, ui]) => { setVaultUi(ui); setKeys(result.server); setAlerts(result.alerts); setCentral(result.central ?? null); setExpiry(result.expiry ?? { dates: {}, known: {} }); })
      .catch((cause: Error) => setError(cause.message));
  }, []);
  useEffect(refresh, [refresh]);
  const saveExpiry = useCallback(async (id: string, on: string) => {
    try {
      const result = await api<{ expiry: KeyExpiry }>("/api/integration-keys", { method: "POST", body: JSON.stringify({ action: "save_key_expiry", id, on }) });
      setExpiry(result.expiry);
      notify(on ? `Gäller till ${on} är sparat.` : "Slutdatumet är borttaget.");
      return true;
    } catch (cause) { notify((cause as Error).message, true); return false; }
  }, [notify]);
  const check = async (key: ServerKeyRow) => {
    setChecking(key.id);
    const own = ownChecks.get(key.id);
    if (own) { try { await own(); } finally { setChecking(null); } return; }
    try {
      const result = await api<{ ok: boolean; message: string; at: string }>("/api/integration-keys", { method: "POST", body: JSON.stringify({ action: "check_server", id: key.id }) });
      setKeys((current) => current?.map((item) => item.id === key.id ? { ...item, lastCheck: result } : item) ?? null);
      notify(result.message, !result.ok);
      // Solar's check keeps the country code it found; the row shows it at once.
      if (key.id === "solar") void api<{ server: ServerKeyRow[] }>("/api/integration-keys?scope=server").then((fresh) => setKeys(fresh.server)).catch(() => undefined);
    } catch (cause) { notify((cause as Error).message, true); } finally { setChecking(null); }
  };
  /**
   * Av/på i översikten (2026-10-17, moved from the card's header 2026-11-11): the same setting as where it is changed
   * otherwise (Solar's import, "Fortsätt med Google", Workflow AI). Switching off asks first and never removes the key; switching
   * on does not ask. A switch is only "på" when the key is in (2026-10-19).
   */
  const toggleOf = (row: ServerKeyRow): ServiceToggle | undefined => {
    const item = row.serviceSwitch;
    if (!item) return undefined;
    return {
      label: item.label, on: item.on && row.configured, disabledReason: row.configured ? null : "Lägg in nyckeln först.",
      onChange: async (on) => {
        if (!on && !(await confirm({ title: `Stänga av ${item.label}?`, message: item.help, confirmLabel: "Stäng av", tone: "danger" }))) return false;
        try {
          const result = await api<{ ok: boolean; message: string; server: ServerKeyRow[] }>("/api/integration-keys", { method: "POST", body: JSON.stringify({ action: "set_service_switch", service: item.service, on }) });
          setKeys(result.server);
          notify(result.message, !result.ok);
          return result.ok;
        } catch (cause) { notify((cause as Error).message, true); return false; }
      },
    };
  };
  // Without billing the installation has no payment keys, so no Betalning group either (Community, 2026-11-02).
  const storeState = (value: CentralOverview | null) => (vaultUi ? vaultUi.state(value) : centralStoreState(value));
  const shown = KEY_GROUPS.filter((group) => features.billing || group.id !== "payment").map((group) => ({ ...group, parts: group.parts.filter((part) => parts?.[part]) })).filter((group) => group.keys.length || group.parts.length);
  const failed = error ? { label: "Kunde inte hämtas", tone: "danger" as const } : undefined;
  const categories: OverviewCategory[] = shown.map((group) => ({
    id: group.id, title: group.title, icon: group.icon, anchor: serverKeySectionAnchor(group.id),
    services: [
      ...(keys ? keysOfGroup(group, keys).map((key) => ({ id: key.id, name: key.label, status: serverKeyState(key), toggle: toggleOf(key) }))
        : group.keys.filter((id) => KEY_NAME[id]).map((id) => ({ id, name: KEY_NAME[id], status: failed }))),
      ...group.parts.map((part) => ({ id: part, name: reported[part]?.name ?? PART_NAME[part], status: reported[part], toggle: reported[part]?.toggle })),
    ],
  }));
  const backup = storeState(central);
  // The page's count of dated keys (2026-11-14): the cards' own dates and the days known in another way.
  const dated = expiryCounts([...Object.values(expiry.dates).map((date) => date?.on), ...Object.values(expiry.known)]);
  return <ServerKeyStatusReport.Provider value={report}>
    <KeyCardsGuard><KeyExpiryProvider dates={expiry.dates} save={saveExpiry}>
    {confirmElement}
    <div className="space-y-6" data-testid="server-keys">
      <PageHeader title="Tjänster och nycklar" />
      <KeyOverview categories={categories} testId="server-keys-overview"
        top={backup || dated.expired || dated.soon ? <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {backup ? <p className="flex flex-wrap items-center gap-2" data-testid="server-keys-backup"><span className="font-medium">Säkerhetskopia</span><Pill tone={backup.tone}>{backup.label}</Pill></p> : null}
          {dated.expired || dated.soon ? <p className="flex flex-wrap items-center gap-2" data-testid="server-keys-expiry"><span className="font-medium">Gäller till</span>
            {dated.expired ? <Pill tone="danger" testId="server-keys-expired">{dated.expired === 1 ? "1 har gått ut" : `${dated.expired} har gått ut`}</Pill> : null}
            {dated.soon ? <Pill tone="warning" testId="server-keys-expiring">{`${dated.soon} går ut inom 30 dagar`}</Pill> : null}
          </p> : null}
        </div> : null}
        actions={vaultUi && vaultUi.syncAvailable(central) ? <vaultUi.SyncButton notify={notify} onDone={(nextCentral, nextServer) => { setCentral(nextCentral as CentralOverview); setKeys(nextServer as ServerKeyRow[]); }} /> : undefined} />
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !keys ? <p className="text-sm text-muted-foreground">Hämtar…</p> : null}
      {shown.map((group) => <div key={group.id} id={serverKeySectionAnchor(group.id)} className="scroll-mt-24" data-testid="server-keys-group" data-group={group.id}>
        <SettingsGroup id={`keys-${group.id}`} title={group.title}>
          {/* Larmen nämns bara när de inte når fram. */}
          {group.id === "ai" && alerts && (alerts.blocked || !alerts.on || !alerts.email) ? <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="key-alerts">
            {alerts.blocked ? `Inga larm om nycklar skickas: ${alerts.blocked}` : "Larm om nycklar skickas inte: slå på driftlarm under Drift och säkerhet."}
          </p> : null}
          {/* Två lika breda kort per rad där bredden räcker, ett under annars (2026-11-11: inga kort över hela bredden). */}
          <KeyCardGrid label={group.title} testId="server-keys-grid">
            {group.id === "security" ? vaultUi
              ? <vaultUi.Panel central={central} notify={notify} onChanged={(next) => { setCentral(next as CentralOverview); refresh(); }} />
              : <CentralStorePanel central={central} notify={notify} onChanged={(next) => { setCentral(next); refresh(); }} /> : null}
            {keysOfGroup(group, keys ?? []).map((key) => <KeyExpiryScope key={key.id} id={key.id}><ServerKeyCard row={key} checking={checking} onCheck={check} notify={notify} onReplaced={setKeys} extra={extras?.[key.id]?.(refresh, key, (handler) => bindCheck(key.id, handler))}
              inMore={key.id === "stripe_secret" ? payments : key.id === "solar" && preparedOfGroup(group, keys ?? []).length ? <p data-testid="server-keys-more-wholesalers">Fler grossister kommer: {listed(preparedOfGroup(group, keys ?? []).map((item) => item.service))}.</p> : null} /></KeyExpiryScope>)}
            {/* SCB keeps its own Giltig till on its card, so it is not asked twice. */}
            {group.parts.map((part) => <li key={part} className="min-w-0" data-testid="server-key-part">{part === "scb" ? parts?.[part] : <KeyExpiryScope id={part}>{parts?.[part]}</KeyExpiryScope>}</li>)}
          </KeyCardGrid>
          {after?.[group.id]}
        </SettingsGroup>
      </div>)}
    </div>
    </KeyExpiryProvider></KeyCardsGuard>
  </ServerKeyStatusReport.Provider>;
}

const SOURCE_LABEL = { app: "Inlagd i appen", server: "Från serverns inställningsfil" } as const;
/** Where a value entered in the app is kept (2026-10-25), told only when it is not where it should be. */
const STORAGE_LABEL = { local: "Förseglad här, inte kopierad", legacy: "Gammal plats, inte flyttad" } as const;

/**
 * Solars kategorier (2026-10-15): the country code Kontrollera found and the categories kept once for every
 * company, with "Hämta kategorier" for the product owner. All or nothing – a failed fetch leaves the stored ones.
 */
function SolarCategories({ row, notify, onReplaced }: { row: ServerKeyRow; notify: (text: string, error?: boolean) => void; onReplaced: (server: ServerKeyRow[]) => void }) {
  const [busy, setBusy] = useState(false);
  const catalog = row.solarCatalog!;
  const reason = !row.configured ? "Lägg in Solars nyckel först." : row.solarRegister && !row.solarRegister.apiEnabled ? "Slå på API-anslutningen först." : null;
  const fetchAll = async () => {
    setBusy(true);
    try {
      const result = await api<{ ok: boolean; message: string; server: ServerKeyRow[] }>("/api/integration-keys", { method: "POST", body: JSON.stringify({ action: "sync_solar_categories" }) });
      onReplaced(result.server);
      notify(result.message, !result.ok);
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground" data-testid="solar-categories">
    <p className="min-w-0 flex-1">
      <span className="font-medium text-foreground">Kategorier:</span>{" "}
      <span data-testid="solar-categories-count">{catalog.categories && catalog.fetchedAt
        ? `${catalog.categories.toLocaleString("sv-SE")} hämtade ${formatSwedish(catalog.fetchedAt, { dateStyle: "medium", timeStyle: "short" })}`
        : "inte hämtade ännu"}</span>
      {" · "}<span className="font-medium text-foreground">Landskod:</span>{" "}
      <span data-testid="solar-country-code">{catalog.countryCode ? `”${catalog.countryCode}” (godtogs vid Kontrollera)` : "inte prövad – kör Kontrollera"}</span>
    </p>
    <KeyCardActions><Button type="button" variant="outline" disabledReason={reason} aria-describedby={reason ? "solar-categories-reason" : undefined} onClick={() => void fetchAll()} data-testid="solar-categories-fetch" busy={busy} busyLabel="Hämtar…">
      <RefreshCw />Hämta kategorier
    </Button></KeyCardActions>
    {reason ? <p className="basis-full" id="solar-categories-reason">{reason}</p> : <p className="basis-full">Tar några minuter.</p>}
  </div>;
}

/**
 * Ett kort per nyckel (2026-11-01; Stripes kort är förebilden; one Spara per card 2026-11-11): namn, en status och
 * Kontrollera i huvudet; nyckelns fält (Stripe's and Google's keys are entered here: dots when a value is in place, a bin that
 * marks it for removal, a new value typed in the field replaces it; never sent back); the card's settings (Solars
 * katalognummer); and what the card holds besides (the OpenAI key, the e-mail server), all saved by the card's one Spara.
 * Allt annat under Mer, som öppnar sig själv bara när något är fel eller en hämtning pågår.
 */
type ServerField = NonNullable<ServerKeyRow["fields"]>[number];
function ServerKeyCard({ row: key, checking, onCheck, notify, onReplaced, extra, inMore }: { row: ServerKeyRow; checking: string | null; onCheck: (key: ServerKeyRow) => Promise<void>; notify: (text: string, error?: boolean) => void; onReplaced: (server: ServerKeyRow[]) => void; extra?: React.ReactNode; inMore?: React.ReactNode }) {
  const status = serverKeyState(key);
  const register = key.solarRegister;
  const registerBusy = Boolean(register && (register.running || register.requested));
  const [values, setValues] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const savedSettings = Object.fromEntries((key.settings ?? []).map((setting) => [setting.id, setting.value ?? ""]));
  const [settings, setSettings] = useState<Record<string, string>>(savedSettings);
  // A save elsewhere (another tab, a check) brings new saved values: the fields follow while nothing is changed in them.
  const [settingsFor, setSettingsFor] = useState(JSON.stringify(savedSettings));
  if (settingsFor !== JSON.stringify(savedSettings)) { setSettingsFor(JSON.stringify(savedSettings)); setSettings(savedSettings); }
  const [confirm, confirmElement] = useConfirm();
  const fields = key.fields ?? [];
  const typed = (field: ServerField) => (values[field.id] ?? "").trim();
  const dirty = fields.some((field) => removed[field.id] || typed(field)) || (key.settings ?? []).some((setting) => (settings[setting.id] ?? "").trim() !== (setting.value ?? ""));
  const post = async (payload: Record<string, unknown>) => {
    const result = await api<{ server: ServerKeyRow[] }>("/api/integration-keys", { method: "POST", body: JSON.stringify(payload) });
    onReplaced(result.server);
  };
  const save = async () => {
    const removing = fields.filter((field) => removed[field.id]);
    if (removing.length && !(await confirm({ title: removing.length === 1 ? `Ta bort ${removing[0].label.toLowerCase()}?` : "Ta bort nycklarna?", message: "Det som använder nyckeln slutar fungera tills en ny läggs in.", confirmLabel: "Ta bort", tone: "danger" }))) return false;
    try {
      for (const field of fields) {
        if (removed[field.id]) await post({ action: "remove_server_secret", field: field.id });
        else if (typed(field)) await post({ action: "save_server_secret", field: field.id, value: typed(field) });
      }
      for (const setting of key.settings ?? []) {
        const value = (settings[setting.id] ?? "").trim();
        if (value !== (setting.value ?? "")) await post({ action: "save_server_setting", field: setting.id, value });
      }
      setValues({}); setRemoved({});
      notify(`${key.label}: sparat.`);
      return true;
    } catch (cause) { notify((cause as Error).message, true); return false; }
  };
  return <li className="min-w-0" data-testid="server-key" data-key={key.id}>
    {confirmElement}
    <KeyCard icon={KeyRound} title={key.label} status={status} statusTestId="server-key-status" moreTestId="server-key-more" moreOpenWhen={status.tone === "danger" || registerBusy}
      check={{ onClick: () => void onCheck(key), busy: checking === key.id, disabled: checking !== null, disabledReason: key.prepared ? "Ingen anslutning att kontrollera." : null, label: `Kontrollera ${key.label}`, testId: "server-key-check-button" }}
      save={fields.length || key.settings?.length ? { dirty, onSave: save } : undefined} saveable={Boolean(extra)}
      settings={key.settings?.length ? <div className="grid gap-3 @lg:grid-cols-2" data-testid="server-key-settings">
        {key.settings.map((setting) => <KeyTextField key={setting.id} id={`server-setting-${setting.id}`} label={setting.label} inputMode="numeric" value={settings[setting.id] ?? ""}
          onChange={(value) => setSettings((current) => ({ ...current, [setting.id]: value }))} placeholder="Nummer från Solar" removeLabel={`Ta bort ${setting.label.toLowerCase()}`}
          hint={setting.value ? undefined : setting.help} testId={`server-setting-${setting.id}`} />)}
      </div> : null}
      more={<>
        <p>{key.note}</p>
        {key.configured && (key.mode || key.source) ? <p className="flex flex-wrap gap-1.5">
          {key.mode ? <Pill tone={key.mode === "live" ? "warning" : "info"} testId="server-key-mode">{key.mode === "live" ? "Live" : "Test"}</Pill> : null}
          {key.source ? <Pill tone="neutral" testId="server-key-source">{SOURCE_LABEL[key.source]}</Pill> : null}
          {key.source === "app" && key.storage && key.storage !== "vault" ? <Pill tone={key.storage === "legacy" ? "warning" : "neutral"} testId="server-key-storage">{STORAGE_LABEL[key.storage]}</Pill> : null}
        </p> : null}
        {key.lastCheck ? <p className="break-words" data-testid="server-key-check">Senast kontrollerad {formatSwedish(key.lastCheck.at, { dateStyle: "medium", timeStyle: "short" })}: {key.lastCheck.message}</p> : null}
        {key.changed ? <p data-testid="server-key-changed">Senast ändrad {formatSwedish(key.changed.at, { dateStyle: "medium", timeStyle: "short" })}{key.changed.by ? ` av ${key.changed.by}` : ""}</p> : null}
        {key.solarCatalog ? <SolarCategories row={key} notify={notify} onReplaced={onReplaced} /> : null}
        {key.solarRegister ? <SolarRegister row={key} notify={notify} onReplaced={onReplaced} /> : null}
        {inMore}
      </>}>
      {fields.length ? <KeyFields testId="server-key-fields">
        {fields.map((field) => <SecretField keepBin key={field.id} id={`server-secret-${field.id}`} label={field.label} value={values[field.id] ?? ""}
          onChange={(value) => { setValues((current) => ({ ...current, [field.id]: value })); setRemoved((current) => ({ ...current, [field.id]: false })); }}
          stored={field.stored} removed={Boolean(removed[field.id])} placeholder="Klistra in från tjänsten" mono removeLabel={`Ta bort ${field.label.toLowerCase()}`}
          onRemove={() => { setValues((current) => ({ ...current, [field.id]: "" })); setRemoved((current) => ({ ...current, [field.id]: true })); }}
          onUndo={() => setRemoved((current) => ({ ...current, [field.id]: false }))} testId={`server-secret-${field.id}`} />)}
      </KeyFields> : null}
      {extra}
    </KeyCard>
  </li>;
}


function IssueDialog({ kind, busy, members, currentUserId, onClose, onIssue }: { kind: IssuedKind; busy: boolean; members: Member[]; currentUserId: string; onClose: () => void; onIssue: (payload: { kind: IssuedKind; name: string; scopes: string[]; expiresInDays: number; actingUserId?: string }) => void }) {
  const [name, setName] = useState("");
  const [actingUserId, setActingUserId] = useState(currentUserId);
  const [scopes, setScopes] = useState<string[]>(() => (kind === "MCP" ? ["mcp:read"] : ["projects:read", "tasks:read"]));
  const [expires, setExpires] = useState(90);
  return <DialogPage pageKey="ny-nyckel" size="page" panelTitle="Nyckelns uppgifter" open onOpenChange={(open) => { if (!open) onClose(); }} title={kind === "MCP" ? "Ny MCP-nyckel" : "Ny API-nyckel"}>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onIssue({ kind, name, scopes, expiresInDays: expires, actingUserId: actingUserId || undefined }); }}>
      <div className="grid gap-1.5"><label htmlFor="key-name" className="field-label text-xs font-medium">Namn</label><Input id="key-name" value={name} required maxLength={80} placeholder={kind === "MCP" ? "Till exempel Claude på Elins dator" : "Till exempel Affärssystem"} onChange={(event) => setName(event.target.value)} /></div>
      <div className="grid gap-1.5"><label htmlFor="key-member" className="field-label text-xs font-medium">Gäller för</label>
        <select id="key-member" className="form-select" value={actingUserId} onChange={(event) => setActingUserId(event.target.value)} data-testid="key-member">
          {members.map((member) => <option key={member.id} value={member.id}>{member.name}{member.id === currentUserId ? " (du)" : member.admin ? " (admin)" : ""}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">Nyckeln kan aldrig göra mer än personen själv. Behörigheterna nedan begränsar den ytterligare.</p>
      </div>
      <fieldset className="field-group rounded-lg border p-3"><legend className="px-1 text-xs font-medium">Behörigheter</legend><div className="grid gap-2">
        {KEY_SCOPES[kind].map((scope) => <label key={scope.key} className="flex items-center gap-2 text-sm"><Checkbox checked={scopes.includes(scope.key)} onCheckedChange={(value) => setScopes((current) => value === true ? [...current, scope.key] : current.filter((item) => item !== scope.key))} />{scope.label}</label>)}
      </div></fieldset>
      <div className="grid gap-1.5"><label htmlFor="key-expiry" className="field-label text-xs font-medium">Giltighet</label>
        <select id="key-expiry" className="form-select" value={expires} onChange={(event) => setExpires(Number(event.target.value))}>
          {EXPIRY_CHOICES.map((days) => <option key={days} value={days}>{days ? `${days} dagar` : "Inget slutdatum"}</option>)}
        </select>
      </div>
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Skapa nyckel", type: "submit", icon: <KeyRound />, disabled: busy, disabledReason: !name.trim() ? "Skriv ett namn först." : !scopes.length ? "Välj minst en behörighet." : null }} />
    </form>
  </DialogPage>;
}

function ExternalDialog({ replacing, providers, busy, onClose, onSave }: { replacing: KeyRow | null; providers: readonly (typeof EXTERNAL_PROVIDERS)[number][]; busy: boolean; onClose: () => void; onSave: (payload: { name: string; provider: string; value: string }) => void }) {
  const [name, setName] = useState(replacing?.name ?? (providers.length === 1 ? providers[0].label : ""));
  const [provider, setProvider] = useState<string>(replacing?.provider ?? providers[0]?.key ?? "other");
  const [value, setValue] = useState("");
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={replacing ? `Byt nyckel – ${replacing.name}` : "Lägg till extern nyckel"} size={replacing ? "compact" : "form"}>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave({ name, provider, value }); }}>
      {!replacing ? <>
        <div className="grid gap-1.5"><label htmlFor="external-provider" className="field-label text-xs font-medium">Tjänst</label>
          <select id="external-provider" className="form-select" value={provider} onChange={(event) => setProvider(event.target.value)}>
            {providers.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">{providerUse(provider)}</p>
        </div>
        <div className="grid gap-1.5"><label htmlFor="external-name" className="field-label text-xs font-medium">Namn</label><Input id="external-name" value={name} required maxLength={80} placeholder="Till exempel lönesystemet" onChange={(event) => setName(event.target.value)} /></div>
      </> : null}
      <SecretField id="external-value" label="Nyckel" value={value} onChange={setValue} stored={false} required minLength={8} placeholder="Klistra in nyckeln från tjänsten"
        hint="Sparas krypterad. Efteråt visas bara de fyra sista tecknen." />
      <Button type="submit" className="w-full" disabled={busy || value.trim().length < 8 || (!replacing && !name.trim())}><KeyRound />{replacing ? "Byt nyckel" : "Spara nyckel"}</Button>
    </form>
  </Modal>;
}

/** How an external system or AI client connects (2026-09-30): the addresses and the header, nothing secret. */
type Connection = { id: string; app: string; redirectHost: string; person: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

function ConnectionPanel() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return <Panel icon={Link2} title="Anslut" description="Adresserna för API och MCP." collapsible defaultCollapsed>
    <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="connection-panel">
      <div className="rounded-lg border p-3"><dt className="text-xs font-medium text-muted-foreground">MCP-server (Streamable HTTP)</dt><dd className="mt-1 break-all font-mono text-xs">{origin}/api/mcp</dd>
        <dd className="mt-2 text-xs text-muted-foreground">Läggs till i AI-klienten. ChatGPT och liknande loggar in själva, andra använder en MCP-nyckel.</dd></div>
      <div className="rounded-lg border p-3"><dt className="text-xs font-medium text-muted-foreground">API</dt><dd className="mt-1 break-all font-mono text-xs">{origin}/api/v1</dd>
        <dd className="mt-2 text-xs text-muted-foreground">GET listar verktygen, POST /api/v1/tools/&lt;namn&gt; kör ett. Nyckeln skickas som Authorization: Bearer.</dd></div>
    </dl>
    <p className="mt-3 text-xs text-muted-foreground">Slutförande, signering och radering finns inte via API eller MCP. Ändringar loggas med nyckelns namn.</p>
  </Panel>;
}
