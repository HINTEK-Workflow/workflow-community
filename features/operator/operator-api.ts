import type { operatorPageData } from "@/lib/operator/reports-server";
import type { Severity } from "@/lib/operator/rules";
import type { TroubleshootSuggestion } from "@/lib/operator/troubleshoot";

/**
 * The operator page's way to its server: the real endpoints under /operator/api (lib/operator), or the public demo's
 * answers in this browser's memory (features/demo/demo-operator.ts). The page never knows which.
 */
export type OperatorPageData = Awaited<ReturnType<typeof operatorPageData>>;
export type OperatorMachine = OperatorPageData["machines"][number];
export type OperatorReport = OperatorPageData["reports"][number];
export type SentReport = { id: string; status: "received" | "pending"; workOrder: string; onCall: boolean };
export type ReportDraft = { machineId: string; cause: string; text: string; severity: Severity; reporterName: string; photos: File[] };

export type OperatorApi = {
  signIn(input: { page: string; username: string; password: string }): Promise<{ path: string }>;
  logOut(): Promise<void>;
  /** `poll`: only the on-call state is wanted; it does not count as activity. */
  load(poll?: boolean): Promise<OperatorPageData>;
  send(draft: ReportDraft): Promise<SentReport>;
  troubleshoot(input: { machineId: string; cause: string }): Promise<{ suggestions: TroubleshootSuggestion[]; note: string }>;
};

export class OperatorApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, credentials: "same-origin", headers: { ...(init?.body instanceof FormData || !init?.body ? {} : { "Content-Type": "application/json" }), ...init?.headers } });
  } catch {
    throw new OperatorApiError(0, "Ingen kontakt med servern. Kontrollera uppkopplingen och försök igen.");
  }
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new OperatorApiError(response.status, data.error || (response.status === 401 ? "Logga in igen." : "Det gick inte. Försök igen."));
  return data as T;
}

export const serverOperatorApi: OperatorApi = {
  signIn: (input) => call("/operator/api/sign-in", { method: "POST", body: JSON.stringify(input) }),
  logOut: async () => { await call("/operator/api/sign-out", { method: "POST" }); },
  load: (poll = false) => call(`/operator/api/me${poll ? "?poll=1" : ""}`, { cache: "no-store" }),
  send: (draft) => {
    const form = new FormData();
    form.set("data", JSON.stringify({ machineId: draft.machineId, cause: draft.cause, text: draft.text, severity: draft.severity, reporterName: draft.reporterName }));
    for (const photo of draft.photos) form.append("photo", photo);
    return call("/operator/api/reports", { method: "POST", body: form });
  },
  troubleshoot: (input) => call("/operator/api/troubleshoot", { method: "POST", body: JSON.stringify(input) }),
};
