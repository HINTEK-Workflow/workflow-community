import { noteWorkspaceChange } from "@/lib/workflow/workspace-cache";

/**
 * Färsk inloggning (2026-10-10): when the server answers `reauth: true`, the registered handler (ReauthHost) asks the
 * person to confirm with password or code, and the request is sent once more. Without a handler the error stands.
 */
type ReauthHandler = (message: string) => Promise<boolean>;
let reauthHandler: ReauthHandler | null = null;
export function setReauthHandler(handler: ReauthHandler | null) {
  reauthHandler = handler;
}

/**
 * Utloggad (features/security/session-expired-host.tsx): the handler hears every 401 and decides itself whether the session
 * really is gone. When it is back, SESSION_BACK_EVENT tells open editors to try again what could not be saved.
 */
export const SESSION_BACK_EVENT = "hintek:session-back";
let signedOutHandler: (() => void) | null = null;
export function setSignedOutHandler(handler: (() => void) | null) {
  signedOutHandler = handler;
}

/**
 * A plain Swedish message when the answer is not the app's own JSON (T12, 2026-10-28: a proxy's HTML 503 showed people
 * "Unexpected token '<' … not valid JSON"): the connection is gone, the person is signed out or the server does not answer.
 */
export function unreadableAnswerMessage(status: number | null) {
  if (status === null) return "Ingen kontakt med servern. Kontrollera uppkopplingen och försök igen.";
  if (status === 401) return "Du är utloggad. Logga in igen för att fortsätta.";
  if (status === 502 || status === 503 || status === 504) return "Servern svarar inte just nu. Försök igen om en stund.";
  return "Åtgärden misslyckades.";
}

async function request<T>(url: string, init: RequestInit | undefined, retried: boolean, change: boolean): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    throw Object.assign(new Error(unreadableAnswerMessage(null)), { status: 0, details: {} });
  }
  if (response.status === 401) signedOutHandler?.();
  const text = await response.text();
  let data: { error?: string; reauth?: boolean } & Record<string, unknown>;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const status = response.ok ? 502 : response.status;
    throw Object.assign(new Error(unreadableAnswerMessage(status)), { status, details: {} });
  }
  if (response.status === 403 && data?.reauth === true && !retried && reauthHandler && (await reauthHandler(data.error || "")))
    return request<T>(url, init, true, change);
  // The status travels with the message, so a caller can tell a conflict (409) it can merge from other errors.
  // The body travels too (`details`), so a 409 for a duplicate place can carry the existing place's id (2026-10-08).
  if (!response.ok) throw Object.assign(new Error(data.error || "Åtgärden misslyckades."), { status: response.status, details: data });
  // A change: what the tab keeps in memory is read again where it is shown next (stabil sidladdning steg 7–8b).
  if (change && !["GET", "HEAD"].includes((init?.method ?? "GET").toUpperCase())) noteWorkspaceChange();
  return data as T;
}

/** `options.change: false`: a request that only stores the person's own choices, which the page has already applied. */
export function api<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
  options: { change?: boolean } = {},
): Promise<T> {
  return request<T>(url, init, false, options.change ?? true);
}

/**
 * A request whose answer is a file (Content-Disposition: attachment), with the same confirmation as api(): a `reauth` answer
 * asks the person once and the request is sent again. The file name is the server's (filename or filename*). The file is
 * never kept here; the caller hands it to saveBlob and lets it go.
 */
export async function apiFile(url: string, init: RequestInit, retried = false): Promise<{ blob: Blob; filename: string | null }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init.headers } });
  } catch {
    throw Object.assign(new Error(unreadableAnswerMessage(null)), { status: 0, details: {} });
  }
  if (response.status === 401) signedOutHandler?.();
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string; reauth?: boolean } | null;
    if (response.status === 403 && data?.reauth === true && !retried && reauthHandler && (await reauthHandler(data.error || ""))) return apiFile(url, init, true);
    throw Object.assign(new Error(data?.error || unreadableAnswerMessage(response.status)), { status: response.status, details: data ?? {} });
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
  return { blob: await response.blob(), filename: encoded ? decodeURIComponent(encoded) : plain ?? null };
}
/**
 * The workspace's own choices of the person (display levels, menu, tips, a tour seen) change nothing the views read, and
 * the page applies them at once – they never make the next page read the overview again (steg 8b).
 */
const PERSONAL_ACTIONS = new Set(["preferences", "advisor", "tour"]);
export const action = <T = Record<string, unknown>>(input: unknown) =>
  api<T>("/api/workspace", { method: "POST", body: JSON.stringify(input) }, { change: !PERSONAL_ACTIONS.has(String((input as { action?: unknown } | null)?.action ?? "")) });
