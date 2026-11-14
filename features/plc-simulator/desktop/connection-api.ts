import { api } from "@/features/kfid/api";
import type { AlarmMode } from "@/lib/machine/alarm-rules";
import type { SourceRow } from "@/lib/machine/simulator/generate-connection";

// PLC-simulatorn, Maskinkoppling (2026-11-04): the one file that speaks to Workflow with the signed-in session: the route the Maskiner page
// uses, with its own checks (session, company and membership, the right, the module, Origin, a fresh confirmation before a key). The
// intake calls stay as before, with only the key. No new route and no wider right. A key that comes back is handed straight on.

export const ROUTE = "/api/machine-sources";
const post = <T>(body: unknown) => api<T>(ROUTE, { method: "POST", body: JSON.stringify(body) });

export const listSources = async () => (await api<{ sources: SourceRow[] }>(ROUTE)).sources;
export const createSource = (name: string) => post<{ id: string; token: string }>({ action: "create", name, expiresInDays: 365 });
export const rotateSource = (id: string) => post<{ id: string; token: string }>({ action: "rotate", id, expiresInDays: 365 });
export const setSourceMode = async (id: string, alarmMode: AlarmMode, cooldownMinutes: number) => { await post({ action: "set_alarm", id, alarmMode, cooldownMinutes }); };
