"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import type { NotifyFn } from "@/lib/extensions/types";

type Connection = { id: string; app: string; redirectHost: string; scopes: string[]; createdAt: string; lastUsedAt: string | null };
const SCOPE: Record<string, string> = { "mcp:read": "Söka och läsa", "mcp:write": "Skapa och ändra", "mcp:delete": "Ta bort och arkivera" };
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }) : "");

/** The person's own apps connected to the MCP server (2026-10-02: everyone who can log in may use the MCP connection). */
export function MyAppConnections({ notify }: { notify: NotifyFn }) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { setConnections((await api<{ connections: Connection[] }>("/api/oauth/connections", { cache: "no-store" })).connections); }
    catch { setConnections([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const disconnect = async (connection: Connection) => {
    if (!(await confirm({ title: "Koppla från appen?", message: `”${connection.app}” slutar fungera direkt och måste godkännas igen för att ansluta på nytt.`, confirmLabel: "Koppla från", tone: "danger" }))) return;
    setBusy(true);
    try { await api("/api/oauth/connections", { method: "POST", body: JSON.stringify({ id: connection.id }) }); notify("Appen är bortkopplad."); await load(); }
    catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return <Panel title="Anslutna appar" description="AI-appar som ChatGPT som du har gett åtkomst till Workflow. De arbetar med dina rättigheter och bara med det du godkände."
    leadingActions={<span className="panel-icon" aria-hidden="true"><Bot className="size-4" /></span>}>
    <div className="space-y-3 text-sm" data-testid="my-app-connections">
      {connections?.length ? <ul className="divide-y rounded-lg border">
        {connections.map((connection) => <li key={connection.id} className="flex flex-wrap items-center gap-2 p-3" data-testid="my-app-connection">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{connection.app}{connection.redirectHost ? <span className="font-normal text-muted-foreground"> · {connection.redirectHost}</span> : null}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{connection.scopes.map((scope) => SCOPE[scope] ?? scope).join(" · ")} · godkänd {day(connection.createdAt)}{connection.lastUsedAt ? ` · senast använd ${day(connection.lastUsedAt)}` : ""}</p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void disconnect(connection)}><Trash2 />Koppla från</Button>
        </li>)}
      </ul> : connections ? <p className="text-muted-foreground">Inga anslutna appar.</p> : <p className="text-muted-foreground">Hämtar…</p>}
      <p className="text-xs text-muted-foreground">Anslut en app genom att lägga till MCP-servern <code className="break-all rounded bg-muted px-1 py-0.5 font-mono">{origin}/api/mcp</code> i appen och logga in när den frågar.</p>
    </div>
    {confirmElement}
  </Panel>;
}
