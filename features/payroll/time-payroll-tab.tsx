"use client";

import dynamic from "next/dynamic";
import { FileUp } from "lucide-react";
import { NativePage } from "@/components/native";
import { useNativeTopBar } from "@/components/native/top-bar";
import { HubCards, PageHeader } from "@/components/page-shell";
import { PayrollExportPanel, PayrollSettingsPanel } from "@/features/payroll/payroll-panel";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { connectionProviders } from "@/lib/integrations/key-catalog";
import { announce } from "@/lib/workflow/toast";
import { PartLoading } from "@/features/kfid/view-loading";

// Tid is on the first page's way; the key card's code comes when the tab is drawn (tests/mobile-load.test.ts).
const IntegrationKeys = dynamic(() => import("@/features/integrations/integration-keys").then((module) => module.IntegrationKeys), { loading: PartLoading });

/**
 * Tid → Lön och export (2026-11-01, beslut 13): the export for those who may export (admins and the Teamet right), and for
 * admins the settings that were on Kopplingar – system, codes, time types, templates, employee numbers – and, since 2026-11-03,
 * the payroll system's own key (SFTP password or API key) right here, beside the server it belongs to ("varje nyckel vid sin
 * koppling"). The server checks every call (lib/payroll/server.ts) and the export's stops stay there.
 */
/**
 * Lön och export's content, the same component under Tid and under Inställningar → Kopplingar (2026-11-02): one place for the
 * logic, two ways in. `admin`: the settings and the key; `integrations`: the installation has the connections (Cloud).
 */
export function PayrollParts({ admin, integrations, notify = announce }: { admin: boolean; integrations: boolean; notify?: (text: string, error?: boolean) => void }) {
  return <>
    <PayrollExportPanel />
    {/* The connection's card and the payroll system's key side by side (2026-11-12: the key cards' 50/50 grid). */}
    {admin ? <PayrollSettingsPanel keyCard={integrations ? <IntegrationKeys notify={notify} part="external" inGrid providers={connectionProviders("payroll")} title="Lönesystemets nyckel" description="SFTP-lösenordet eller API-nyckeln till ert lönesystem. Sparas krypterat för företaget." /> : null} /> : null}
    {integrations ? <HubCards area="admin" items={[{ href: "/?view=import", title: "Import av frånvaro", description: "Frånvaro och anställningsnummer från lönesystemet.", icon: FileUp, testId: "payroll-link-import" }]} /> : null}
  </>;
}

export function TimePayrollTab({ admin, integrations }: { admin: boolean; integrations: boolean }) {
  const native = useNativeMode();
  useNativeTopBar(native ? { title: "Lön och export", back: { label: "Tid" } } : null);
  const parts = <PayrollParts admin={admin} integrations={integrations} />;
  if (native) return <NativePage testId="native-time-payroll-screen"><div className="space-y-4 px-4 pb-4">{parts}</div></NativePage>;
  return <div className="space-y-6" data-testid="time-payroll-tab">
    <PageHeader title="Tid" description="Löneunderlag, fil till lönesystemet och inställningarna för lön." />
    {parts}
  </div>;
}
