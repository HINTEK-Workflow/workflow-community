"use client";
import { useEffect, useState } from "react";
import { BookOpenCheck, Cpu, FileDown, Globe, KeyRound, Receipt, Workflow, type LucideIcon } from "lucide-react";
import { PayrollParts } from "@/features/payroll/time-payroll-tab";
import { AccountingSettingsPanel } from "@/features/quotes/accounting-settings";
import { HubCards, PageHeader, SplitPane, SplitPaneNav, useSubPageTrail } from "@/components/page-shell";
import { api } from "@/features/kfid/api";
import { KeyCardGrid } from "./key-card";
import { IntegrationKeys } from "./integration-keys";
import { MachineSourcesPanel } from "./machine-sources";
import { useModules } from "@/features/workflow/use-modules";
import {
  accountingAreaStatus, activeExternalProviders, apiAreaStatus, AREA_STATE_LABEL, AREA_STATE_TONE, CONNECTION_AREAS, connectionArea, connectionAreaHref, CONNECTIONS_HREF,
  machinesAreaStatus, payrollAreaStatus, webAreaStatus, type AreaStatus, type ConnectionArea, type ConnectionAreaKey,
} from "@/lib/integrations/connection-areas";
import { WebArea } from "./web-area";
import { CompanyKeyFileActions } from "./key-file-dialogs";
import { connectionProviders } from "@/lib/integrations/key-catalog";
import { FORTNOX_CONNECTION_READY, type AccountingSettings } from "@/lib/quotes/accounting";
import { PAYROLL_MODE_LABELS } from "@/lib/payroll/codes";

type Notify = (text: string, error?: boolean) => void;

/**
 * Kopplingar (2026-11-02: "man hoppar mellan olika sidor"; before that an overview of cards, 2026-10-31; four areas since
 * 2026-11-03, lib/integrations/connection-areas.ts): one page with the company's connections in a list to the left – each with
 * its status in one line – and the open area's content to the right (`SplitPane`), so one changes area without going back through
 * an overview. The area is the address's ?section=; without one a computer opens the first area the person may use (Bokföring),
 * and a phone shows the list first. Every key beside its connection: Bokföring holds the accounts, the SIE export and the Fortnox
 * key; Lön och export is the same content as Tid's tab (`PayrollParts`) with the payroll system's key; Maskiner its sources;
 * API och MCP the keys Workflow issues, and older keys of no connection under Övriga nycklar until they are removed; Webb och
 * sociala medier the WordPress site of Min webbsida and Facebook och Instagram for Inlägg (2026-11-10), both under Mer › Webb och inlägg
 * since 2026-11-20 and listed here while that module is on.
 * Company admins only, as before; every endpoint checks the session, company and role on its own. A module that is off hides its
 * area from the list; its direct address still opens it, and the shell says that the module is off (moduleOfPage).
 */
export function ConnectionsPage({ notify, area, simulator = false }: { notify: Notify; area?: string | null; simulator?: boolean }) {
  const { statuses, externalProviders, setStatus } = useAreaStatuses();
  const moduleIsOn = useModules();
  const asked = connectionArea(area);
  const listed = CONNECTION_AREAS.filter((item) => item.key === asked?.key || (item.key === "machines" ? moduleIsOn("upkeep") : item.key === "web" ? moduleIsOn("web_posts") : true));
  const shown = asked ?? listed[0] ?? null;
  // The trail names the area when the address does (the phone's list is then the page above).
  useSubPageTrail(asked ? { label: asked.title, href: CONNECTIONS_HREF } : null);
  return <div className="space-y-6" data-testid="connections-overview">
    {/* Exportera och läs in företagets nycklar (2026-11-26): the page's main actions, the company admin's own keys. */}
    <PageHeader title="Kopplingar" description="Här kopplar du företaget till andra system och sparar nycklarna som behövs."
      actions={<CompanyKeyFileActions notify={notify} />} />
    <SplitPane chosen={Boolean(asked)} testId="connections-split" list={<SplitPaneNav label="Områden" area="admin" items={listed.map((item) => {
      const status = statuses[item.key];
      return { href: connectionAreaHref(item.key), title: item.title, icon: AREA_ICON[item.key], testId: `connection-area-${item.key}`, current: item.key === shown?.key,
        status: status ? { label: AREA_STATE_LABEL[status.state], tone: AREA_STATE_TONE[status.state], detail: status.detail } : null };
    })} />}>
      {shown ? <ConnectionAreaContent key={shown.key} area={shown} notify={notify} externalProviders={externalProviders} onStatus={setStatus} simulator={simulator} /> : null}
    </SplitPane>
  </div>;
}

const AREA_ICON: Record<ConnectionAreaKey, LucideIcon> = { accounting: BookOpenCheck, payroll: Workflow, machines: Cpu, api: KeyRound, web: Globe };

/**
 * Each area's status, read from the endpoints the area pages use; an area whose endpoint does not answer is Okänt. The keys'
 * answer also tells which pasted keys the company has, so Bokföring can show an older Fortnox row while the connection is closed.
 */
function useAreaStatuses() {
  const [statuses, setStatuses] = useState<Partial<Record<ConnectionAreaKey, AreaStatus>>>({});
  const [externalProviders, setExternalProviders] = useState<string[] | null>(null);
  useEffect(() => {
    let active = true;
    const set = (key: ConnectionAreaKey, status: AreaStatus) => { if (active) setStatuses((current) => ({ ...current, [key]: status })); };
    const unknown: AreaStatus = { state: "unknown", detail: "Kunde inte läsas" };
    type KeyRow = { kind: "API" | "MCP" | "EXTERNAL"; provider: string | null; name: string; expiresAt: string | null; revokedAt: string | null };
    void api<{ keys: KeyRow[]; connections?: { revokedAt: string | null }[] }>("/api/integration-keys", { cache: "no-store" })
      .then((result) => { set("api", apiAreaStatus(result.keys, (result.connections ?? []).filter((item) => !item.revokedAt).length)); if (active) setExternalProviders(activeExternalProviders(result.keys)); })
      .catch(() => { set("api", unknown); if (active) setExternalProviders([]); });
    void api<{ sources: { name: string; status: "active" | "expired" | "revoked" | "inactive" }[]; waiting: unknown[] }>("/api/machine-sources", { cache: "no-store" })
      .then((result) => set("machines", machinesAreaStatus(result.sources, result.waiting.length))).catch(() => set("machines", unknown));
    void api<{ settings: AccountingSettings; fortnoxKey: string | null }>("/api/quotes/export?part=accounting", { cache: "no-store" })
      .then((result) => set("accounting", accountingAreaStatus(result.settings, result.fortnoxKey))).catch(() => set("accounting", unknown));
    // Webb och sociala medier: what is stored for WordPress, Meta, LinkedIn and YouTube, without asking any of them.
    void Promise.all([
      api<{ connection: Parameters<typeof webAreaStatus>[0] }>("/api/website?part=connection", { cache: "no-store" }).then((result) => result.connection).catch(() => null),
      api<Parameters<typeof webAreaStatus>[1]>("/api/meta?part=status", { cache: "no-store" }).catch(() => null),
      api<Parameters<typeof webAreaStatus>[2]>("/api/linkedin?part=status", { cache: "no-store" }).catch(() => null),
      api<Parameters<typeof webAreaStatus>[3]>("/api/youtube?part=status", { cache: "no-store" }).catch(() => null),
    ]).then(([website, meta, linkedin, youtube]) => set("web", webAreaStatus(website, meta, linkedin, youtube)));
    void api<Parameters<typeof payrollAreaStatus>[0]>("/api/payroll", { cache: "no-store" })
      .then((result) => set("payroll", payrollAreaStatus(result, PAYROLL_MODE_LABELS[result.settings.mode as keyof typeof PAYROLL_MODE_LABELS] ?? result.settings.mode))).catch(() => set("payroll", unknown));
    return () => { active = false; };
  }, []);
  const setStatus = (key: ConnectionAreaKey, status: AreaStatus) => setStatuses((current) => ({ ...current, [key]: status }));
  return { statuses, externalProviders, setStatus };
}

/** An area's content beside the list: its name and one line, then the area's own settings. */
function ConnectionAreaContent({ area, notify, externalProviders, onStatus, simulator }: { area: ConnectionArea; notify: Notify; externalProviders: string[] | null; onStatus: (key: ConnectionAreaKey, status: AreaStatus) => void; simulator: boolean }) {
  return <section className="space-y-6" aria-labelledby={`connection-area-title-${area.key}`} data-testid="connection-area" data-area={area.key}>
    <div>
      <h2 id={`connection-area-title-${area.key}`} className="section-title">{area.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{area.description}</p>
    </div>
    {area.key === "api" ? <IntegrationKeys notify={notify} part="api" />
      : area.key === "web" ? <WebArea notify={notify} onStatus={(status) => onStatus("web", status)} />
      : area.key === "machines" ? <MachineSourcesPanel notify={notify} simulator={simulator} />
        : area.key === "accounting" ? <AccountingArea notify={notify} fortnoxRow={externalProviders?.includes("fortnox") ?? false} />
          // Kopplingar is a company admin's page (COMPANY_ADMIN_VIEWS); the payroll endpoints check the role themselves.
          : <PayrollParts admin integrations notify={notify} />}
  </section>;
}

/**
 * Bokföring (S2, gathered here 2026-11-03; the accounts stood under Arbetssätt → Avancerat until then): the company's accounts,
 * the way to the SIE export on Fakturaunderlag, what the code does (F2 is not built now, 2026-10-31: a pasted key, no own
 * sign-in to Fortnox and no renewal), and the Fortnox key – only when the connection is open or an older row exists, so it can be
 * removed (beslut 16: no Lägg till before the connection opens).
 */
function AccountingArea({ notify, fortnoxRow }: { notify: Notify; fortnoxRow: boolean }) {
  // Samma kort som nycklarna (2026-11-12): the accounts are a key card, half the width like every key card, with what the
  // bookkeeping does here under its Mer (before: a folded card of its own, "Så fungerar bokföringen här"); the way to the SIE export
  // stays a link card.
  return <>
    <KeyCardGrid label="Bokföring" testId="accounting-grid">
      <li className="min-w-0"><AccountingSettingsPanel facts={<ul className="list-disc space-y-1 pl-5" data-testid="accounting-facts">
        {FORTNOX_CONNECTION_READY ? <>
          <li>Ett fakturaunderlag eller en accepterad offert skickas som fakturautkast till företagets Fortnox. Inget bokförs eller skickas till kunden förrän ni gör det i Fortnox.</li>
          <li>Workflow använder en nyckel som ni klistrar in nedan. Workflow förnyar den inte, och det finns ingen inloggning direkt mot Fortnox.</li>
        </> : null}
        <li>SIE-filen görs av ett fakturaunderlag som är markerat som fakturerat och läses in i ett bokföringsprogram som tar emot SIE 4. Offerter bokförs inte.</li>
      </ul>} /></li>
    </KeyCardGrid>
    <HubCards area="admin" items={[
      ...(FORTNOX_CONNECTION_READY ? [{ href: "/?view=quotes", title: "Offerter", description: "Skicka accepterade offerter till Fortnox.", icon: Receipt, testId: "accounting-link-quotes" }] : []),
      { href: "/?view=invoice_bases", title: "Fakturaunderlag", description: FORTNOX_CONNECTION_READY ? "Exportera fakturerade underlag som SIE-fil eller skicka till Fortnox." : "Exportera fakturerade underlag som SIE-fil.", icon: FileDown, testId: "accounting-link-invoice-bases" },
    ]} />
    {FORTNOX_CONNECTION_READY || fortnoxRow ? <IntegrationKeys notify={notify} part="external" providers={connectionProviders("accounting")} title="Fortnox-nyckel"
      description={FORTNOX_CONNECTION_READY ? "Används när en offert eller ett fakturaunderlag skickas till Fortnox." : "En nyckel som sparats tidigare. Den används inte och kan tas bort."} /> : null}
  </>;
}
