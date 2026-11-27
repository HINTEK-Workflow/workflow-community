"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { formatSwedish } from "@/lib/swedish-time";
import type { CentralStoreStatus } from "@/lib/secrets/central-store";
import type { ServerKeySectionStatus } from "./server-key-status";
import { StatusPill } from "./status-pill";
import { KeyCard } from "./key-card";
import { api } from "../../features/kfid/api";

/**
 * Central lagring på Tjänster och nycklar (2026-10-25): the installation's own keys are sealed in its database with
 * the server's key ring. The panel shows how each key is kept and the key ring; Kontrollera counts every sealed value and
 * whether it can be opened. Names, times and counts only; a value is never sent to the page. Workflow's installation adds its
 * key vault copy here (ee/ui/central-store-panel.tsx, loaded instead of this one).
 */
export type CentralOverview = { store: CentralStoreStatus; ring: { currentKeyId: string; separate: boolean; previousCount: number }; unreadable: string[] };

const storageLabel = (storage: "vault" | "local" | "legacy") => (storage === "legacy" ? "Äldre försegling" : "Förseglad");
const when = (value: string | null) => (value ? formatSwedish(value, { dateStyle: "medium", timeStyle: "short" }) : "aldrig");

/** The status the overview's Säkerhet tile and the panel's own pill show. */
export function centralStoreState(central: CentralOverview | null): ServerKeySectionStatus | undefined {
  if (!central) return undefined;
  if (central.unreadable.length) return { label: "Går inte att öppna", tone: "danger", detail: "Ett förseglat värde går inte att öppna med serverns nyckelring." };
  if (!central.ring.separate) return { label: "Förseglat i databasen", tone: "neutral", detail: "Förseglingen använder inloggningens nyckel. En egen förseglingsnyckel är säkrare, se driftguiden om nyckelrotation." };
  return { label: "Förseglat i databasen", tone: "success" };
}

export function CentralStorePanel({ central, notify, onChanged }: { central: CentralOverview | null; notify: (text: string, error?: boolean) => void; onChanged: (central: CentralOverview) => void }) {
  const [busy, setBusy] = useState(false);
  if (!central) return null;
  const { store, ring } = central;
  const state = centralStoreState(central)!;
  const check = async () => {
    setBusy(true);
    try {
      const result = await api<{ ok: boolean; message: string; central: CentralOverview }>("/api/integration-keys", { method: "POST", body: JSON.stringify({ action: "check_central_store" }) });
      onChanged(result.central);
      notify(result.message, !result.ok);
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <li className="min-w-0" data-testid="central-store">
    <KeyCard icon={ShieldCheck} title="Central lagring" status={{ label: state.label, tone: state.tone, problem: state.tone === "success" ? null : state.detail }} statusTestId="central-store-status" problemTestId="central-store-detail"
      moreTestId="central-store-more"
      check={{ onClick: () => void check(), busy, disabled: busy, label: "Kontrollera central lagring", testId: "central-store-check" }}
      more={<>
        <p>Nycklarna lagras förseglade i databasen.</p>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="central-store-badges">
          {ring.separate ? <StatusPill tone="success">Egen förseglingsnyckel</StatusPill> : null}
          {ring.previousCount ? <StatusPill tone="neutral">{ring.previousCount} äldre nycklar i ringen</StatusPill> : null}
        </div>
        <ul className="grid gap-1.5 text-xs" aria-label="Centrala nycklar och hur de lagras" data-testid="central-store-fields">
          {store.fields.map((field) => <li key={field.field} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="central-store-field" data-field={field.field}>
            <span className="min-w-0 flex-1 font-medium text-foreground">{field.label}</span>
            {field.unreadable ? <StatusPill tone="danger">Går inte att öppna</StatusPill>
              : field.storage ? <StatusPill tone="neutral">{storageLabel(field.storage)}</StatusPill>
              : <StatusPill tone="neutral">{field.removed ? "Borttagen" : "Inte inlagd"}</StatusPill>}
            <span className="basis-full text-muted-foreground sm:basis-auto">{field.updatedAt ? `Ändrad ${when(field.updatedAt)}` : ""}</span>
          </li>)}
        </ul>
      </>} />
  </li>;
}
