"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Factory, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { CookieButton } from "@/components/cookie-notice";
import { Button } from "@/components/ui/button";
import { Field, Panel } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { inactivityText, OPERATOR_PASSWORD_MIN } from "@/lib/operator/rules";
import { ReportView } from "./report-view";
import { OperatorApiError, serverOperatorApi, type OperatorApi, type OperatorPageData } from "./operator-api";
import { useStandaloneLevel } from "./use-standalone-level";

/**
 * Operatörssidan (2026-10-30): a page of its own without the side menu – a top banner with the company, who is
 * signed in and Logga ut. Phone first, also for a tablet mounted at a machine. The operator only reports faults and sees
 * the own machines and reports; nothing else exists here. The page signs out by itself after the company's inactivity time.
 */
export type OperatorAppProps = {
  pageKey: string;
  company: string;
  /** The signed-in operator's data, or null for the sign-in form. */
  initial: OperatorPageData | null;
  /** "Logga in med Microsoft" is offered (the company's group sign-in is on and set up). */
  microsoft: boolean;
  /** A Microsoft sign-in that came back with a refusal, in words. */
  error: string;
  /** `?maskin=`: a machine opened from a QR code. */
  machine: string | null;
  /** `?niva=`: a fixed display level. */
  niva: string | null;
  /** The public demo answers in the browser (features/demo/demo-operator.ts). */
  api?: OperatorApi;
  demoHint?: string;
};

export function OperatorApp({ pageKey, company, initial, microsoft, error, machine, niva, api = serverOperatorApi, demoHint }: OperatorAppProps) {
  const level = useStandaloneLevel(niva);
  const [data, setData] = useState<OperatorPageData | null>(initial);
  const [message, setMessage] = useState(error);
  const width = level === 1 ? "max-w-[560px]" : "max-w-7xl"; // room for the machine tree column (2026-10-31)

  const loggedOut = useCallback((text: string) => { setData(null); setMessage(text); }, []);
  const reload = useCallback(async (poll = false) => {
    try { setData(await api.load(poll)); }
    catch (failure) { if (failure instanceof OperatorApiError && failure.status === 401) loggedOut("Du har loggats ut. Logga in igen."); }
  }, [api, loggedOut]);
  const logOut = useCallback(async (text = "") => {
    await api.logOut().catch(() => undefined);
    loggedOut(text);
  }, [api, loggedOut]);

  // Utloggning efter en tid utan aktivitet (the company's choice): touch, typing or a click starts the clock again.
  const lastActive = useRef(0);
  useEffect(() => {
    if (!data) return;
    lastActive.current = Date.now();
    const mark = () => { lastActive.current = Date.now(); };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, mark, { passive: true });
    const timer = setInterval(() => {
      if (Date.now() - lastActive.current >= data.inactivityMinutes * 60_000) void logOut(`Du loggades ut efter ${inactivityText(data.inactivityMinutes)} utan aktivitet.`);
    }, 15_000);
    return () => { clearInterval(timer); for (const name of events) window.removeEventListener(name, mark); };
  }, [data, logOut]);

  return <div className="flex min-h-dvh flex-col bg-background" data-testid="operator-page" data-level={level}>
    {demoHint ? <div className="border-b bg-muted/40"><p className={cn("mx-auto px-4 py-1.5 text-xs text-muted-foreground", width)} data-testid="operator-demo-hint">{demoHint}</p></div> : null}
    <header className="sticky top-0 z-20 border-b bg-card" data-testid="operator-banner">
      <div className={cn("mx-auto flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2", width)}>
        <span className="flex min-w-0 items-center gap-2 font-semibold"><Factory className="size-5 shrink-0 text-primary" aria-hidden="true" /><span className="truncate" data-testid="operator-company">{company}</span></span>
        {data ? <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className="min-w-0 truncate text-muted-foreground" data-testid="operator-signed-in">{data.account.name}{data.account.shared ? " (terminal)" : ""}</span>
          <Button type="button" variant="outline" size={level === 1 ? "default" : "sm"} className={level === 1 ? "h-11" : undefined} onClick={() => void logOut()} data-testid="operator-sign-out"><LogOut />Logga ut</Button>
        </span> : <span className="text-sm text-muted-foreground">Felanmälan</span>}
      </div>
    </header>
    <main className={cn("mx-auto w-full flex-1 px-4 py-5", width)}>
      {data ? <>
        <h1 className="mb-1 text-xl font-semibold">Felanmälan</h1>
        <p className="mb-4 text-xs text-muted-foreground">Loggas ut efter {inactivityText(data.inactivityMinutes)} utan aktivitet.</p>
        <ReportView api={api} data={data} level={level} initialMachine={machine} onReload={reload} onLoggedOut={loggedOut} />
      </> : <SignIn key={message} api={api} pageKey={pageKey} microsoft={microsoft} message={message} level={level} onSignedIn={() => { setMessage(""); void reload(); }} />}
    </main>
    {/* The way back to the cookie details: at the page's bottom left as on other pages, but in the flow, since a fixed button covered the list of causes (user test C6). */}
    <div className="px-4 pb-4 print:hidden"><CookieButton /></div>
  </div>;
}

function SignIn({ api, pageKey, microsoft, message, level, onSignedIn }: { api: OperatorApi; pageKey: string; microsoft: boolean; message: string; level: number; onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(message);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    if (!username.trim() || !password) { setError("Skriv användarnamn och lösenord."); return; }
    setBusy(true); setError("");
    try {
      await api.signIn({ page: pageKey, username, password });
      setPassword("");
      onSignedIn();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Det gick inte att logga in.");
    } finally {
      setBusy(false);
    }
  };
  const body = <div className="mx-auto max-w-sm space-y-5 pt-4" data-testid="operator-sign-in">
    <div>
      <h1 className="text-xl font-semibold">Logga in</h1>
      <p className="mt-1 text-sm text-muted-foreground">För att felanmäla maskiner.</p>
    </div>
    {microsoft ? <>
      <Button asChild variant="outline" size="xl" className="w-full">
        <a href={`/operator/api/microsoft/start?page=${encodeURIComponent(pageKey)}`} data-testid="operator-microsoft">
          <svg viewBox="0 0 21 21" className="size-4" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z" /><path fill="#7fba00" d="M11 1h9v9h-9z" /><path fill="#00a4ef" d="M1 11h9v9H1z" /><path fill="#ffb900" d="M11 11h9v9h-9z" /></svg>
          Logga in med Microsoft
        </a>
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />eller med operatörskonto<span className="h-px flex-1 bg-border" /></div>
    </> : null}
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Field id="operator-user" label="Användarnamn" value={username} onChange={setUsername} autoComplete="username" help="E-post eller ett namn, till exempel Press 4." />
      <Field id="operator-password" label="Lösenord" type="password" value={password} onChange={setPassword} autoComplete="current-password" help={`Minst ${OPERATOR_PASSWORD_MIN} tecken.`} />
      <p className={cn("min-h-5 text-sm", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined} data-testid="operator-sign-in-error">{error}</p>
      <Button type="submit" size="xl" className="w-full" disabled={busy} data-testid="operator-sign-in-submit">{busy ? "Loggar in …" : "Logga in"}</Button>
    </form>
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />Bara felanmälan: dina maskiner och dina anmälningar.</p>
  </div>;
  // Levels 2–3: the same form in a card in the middle of the page.
  return level === 1 ? body : <div className="mx-auto max-w-md pt-6"><Panel icon={LogIn} title="Felanmälan">{body}</Panel></div>;
}
