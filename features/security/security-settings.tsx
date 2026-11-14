"use client";

/* eslint-disable @next/next/no-img-element -- The QR code is a data: URL made by the server for this person only. */
import { useCallback, useState } from "react";
import { signOutAndForget } from "@/features/auth/sign-out";
import { History, KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { api } from "@/features/kfid/api";
import { useLoadEffect } from "@/lib/use-load-effect";
import { useConfirm } from "@/features/kfid/confirm";
import { Field, Panel } from "@/features/kfid/ui";
import { SIGN_IN_METHOD_LABELS } from "@/lib/auth/session-rules";
import { PasskeySettings } from "./passkey-settings";
import { KeyCard } from "@/features/integrations/key-card";
import { NativeLeadPanel } from "@/components/native/screen";
import { useNativeMode } from "@/features/workflow/use-detail-level";

export type SecurityEventView = { id: string; type: string; label: string; detail: string; client: string; at: string; person: string | null; actor: string | null };
export type SecurityLogPage = { events: SecurityEventView[]; next: string | null };
type SessionView = { id: string; method: string; client: string; createdAt: string; lastSeenAt: string; current: boolean };
type Data = {
  twoFactor: { enabled: boolean; enabledAt: string | null; backupCodesLeft: number; hasPassword: boolean };
  required: boolean; method: string; google: boolean; fresh: boolean; sessionTracked: boolean;
  sessions: SessionView[]; log: SecurityLogPage;
};

const dateTime = (iso: string) => new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
/** Ungefärlig tid: "nyss", "för 20 min sedan", "i går" – the list never pretends to be exact. */
export function roughAgo(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 5) return "nyss";
  if (minutes < 60) return `för ${Math.round(minutes / 5) * 5} min sedan`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `för ${hours} h sedan`;
  const days = Math.round(hours / 24);
  return days === 1 ? "i går" : `för ${days} dagar sedan`;
}

/** A page of security events, newest first, with "Visa fler". Shared by the person's, the company's and the superadmin's views. */
export function SecurityLogList({ page, load, showPerson = false, testId }: { page: SecurityLogPage; load: (before: string) => Promise<SecurityLogPage>; showPerson?: boolean; testId?: string }) {
  const [events, setEvents] = useState(page.events);
  const [next, setNext] = useState(page.next);
  const [busy, setBusy] = useState(false);
  // A new first page (after a change) starts the list over – adjusted while rendering, not in an effect.
  const [shownPage, setShownPage] = useState(page);
  if (shownPage !== page) { setShownPage(page); setEvents(page.events); setNext(page.next); }
  if (!events.length) return <p className="text-sm text-muted-foreground" data-testid={testId}>Inga händelser ännu.</p>;
  return <div data-testid={testId}>
    <ul className="divide-y rounded-lg border text-sm">
      {events.map((event) => <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
        <span className="min-w-0">
          <span className="font-medium">{event.label}</span>
          {event.detail ? <span className="text-muted-foreground"> · {event.detail}</span> : null}
          {showPerson && event.person ? <span className="block text-xs text-muted-foreground">{event.person}{event.actor ? ` · av ${event.actor}` : ""}</span> : !showPerson && event.actor ? <span className="block text-xs text-muted-foreground">av {event.actor}</span> : null}
        </span>
        <span className="text-xs text-muted-foreground">{dateTime(event.at)}{event.client ? ` · ${event.client}` : ""}</span>
      </li>)}
    </ul>
    {next ? <div className="mt-3 flex justify-center"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const more = await load(next); setEvents((current) => [...current, ...more.events]); setNext(more.next); } finally { setBusy(false); }
    }}>{busy ? "Hämtar…" : "Visa fler"}</Button></div> : null}
  </div>;
}

export const SECURITY_LOG_NOTE = "Sparas i 12 månader. IP-adressen sparas bara som en nyckelad kod – pseudonymiserad, inte anonym – och webbläsaren bara som typ och system.";

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return <div className="space-y-3" data-testid="backup-codes">
    <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Spara dina reservkoder nu</p>
    <p className="text-xs text-muted-foreground">De visas bara den här gången. Varje kod fungerar en gång i stället för koden från appen, till exempel om du tappar telefonen. Förvara dem säkert, inte i telefonen.</p>
    <ul className="grid grid-cols-2 gap-1.5 font-mono text-sm sm:grid-cols-5">{codes.map((code) => <li key={code} className="rounded bg-secondary px-2 py-1 text-center">{code}</li>)}</ul>
    <div className="flex flex-wrap gap-2">
      <CopyButton size="sm" value={codes.join("\n")} label="Kopiera koderna" />
      <Button type="button" size="sm" onClick={onDone}>Jag har sparat koderna</Button>
    </div>
  </div>;
}

/**
 * Mina inställningar → Säkerhet (2026-10-10; three cards since 2026-11-12): two-step verification with an authenticator app, the
 * backup codes, the passkeys, the active sign-ins and the person's own security log. Every change that matters asks the server, which checks a fresh
 * confirmation; nothing here is decided in the browser.
 */
export function SecuritySettings({ notify, gate = false }: { notify: (message: string, error?: boolean) => void; gate?: boolean }) {
  const native = useNativeMode();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [confirm, confirmElement] = useConfirm();

  const load = useCallback(async () => {
    try { setData(await api<Data>("/api/security", { cache: "no-store" })); } catch (error) { notify((error as Error).message, true); }
  }, [notify]);
  useLoadEffect(load);

  async function post<T = Record<string, unknown>>(input: Record<string, unknown>) {
    setBusy(true);
    try { return await api<T>("/api/security", { method: "POST", body: JSON.stringify(input) }); }
    catch (error) { notify((error as Error).message, true); return null; }
    finally { setBusy(false); }
  }

  const twoFactor = data?.twoFactor;
  const startSetup = async () => {
    const result = await post<{ secret: string; qr: string }>({ action: "totp_start" });
    if (result) { setSetup(result); setSetupCode(""); }
  };

  // Tre kort enligt kortmallen (2026-11-12): Tvåstegsverifiering, Passkeys och Aktiva inloggningar, each with its title and
  // one line, its buttons in one row at the foot, and what removes or ends something under Mer or on its own list row. Min
  // säkerhetslogg is a folded list card of its own. Nothing about what is asked of the server has changed.
  if (!data || !twoFactor) return <Panel title="Säkerhet" icon={ShieldCheck}>{confirmElement}<p className="text-sm text-muted-foreground" role="status">Hämtar…</p></Panel>;
  const twoFactorNotes = [
    data.google && !native ? <p key="google">Inloggning med Google frågar inte efter koden här: den skyddas av Googles egen tvåstegsverifiering, som du slår på i ditt Google-konto.</p> : null,
    !twoFactor.hasPassword && !twoFactor.enabled && !native ? <p key="no-password">Du har inget lösenord i Workflow och loggar bara in med Google, så koden behövs inte. Skapar du ett lösenord kan du slå på tvåstegsverifiering här.</p> : null,
  ].filter(Boolean);
  const canTurnOff = twoFactor.enabled && !data.required && !codes && !setup;
  // Several cards on the phone's screen: each keeps its title (the lead panel's hidden title is for a screen with one card).
  return <NativeLeadPanel.Provider value={false}><div className="space-y-4" data-testid="security-settings">
    {confirmElement}
    <div data-testid="two-factor"><KeyCard icon={KeyRound} title="Tvåstegsverifiering" description="En kod från en app i telefonen när du loggar in med lösenord."
      status={twoFactor.enabled ? { label: "På", tone: "success" } : { label: "Av", tone: "neutral" }} statusTestId="two-factor-status"
      actions={codes || setup ? null : twoFactor.enabled ? <>
        <Button type="button" variant="outline" disabled={busy} onClick={async () => {
          if (!(await confirm({ title: "Skapa nya reservkoder?", message: "De gamla reservkoderna slutar gälla direkt.", confirmLabel: "Skapa nya koder" }))) return;
          const result = await post<{ codes: string[] }>({ action: "backup_renew" });
          if (result) setCodes(result.codes);
        }}>Nya reservkoder</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void startSetup()}>Byt app eller telefon</Button>
      </> : twoFactor.hasPassword ? <Button type="button" disabled={busy} onClick={() => void startSetup()} data-testid="totp-start">Slå på tvåstegsverifiering</Button> : null}
      more={twoFactorNotes.length || canTurnOff ? <>
        {twoFactorNotes}
        {canTurnOff ? <Button type="button" variant="ghost" size="sm" className="w-fit text-destructive" disabled={busy} onClick={() => setDisabling((value) => !value)} data-testid="totp-disable-open">Stäng av</Button> : null}
      </> : undefined} moreOpenWhen={disabling}>
      {gate || (data.required && !twoFactor.enabled) ? <p className="text-sm font-medium text-amber-700 dark:text-amber-300" role="alert">
        Tvåstegsverifiering krävs för ditt konto. Slå på den här för att fortsätta arbeta i Workflow.</p> : null}
      <p className="text-sm text-muted-foreground">
        {twoFactor.enabled
          ? native ? "På. Koden från din app behövs vid inloggning." : `På sedan ${dateTime(twoFactor.enabledAt!)}. När du loggar in med lösenord frågar Workflow också efter koden i din autentiseringsapp.`
          : native ? "Av. Slå på för att kräva en kod från en app vid inloggning." : "Av. Med tvåstegsverifiering behövs både lösenordet och en kod från en app i telefonen, till exempel Microsoft Authenticator eller Google Authenticator."}
      </p>
      {codes ? <BackupCodes codes={codes} onDone={() => { setCodes(null); if (gate) window.location.reload(); else void load(); }} /> : setup ? <form className="space-y-3" onSubmit={async (event) => {
        event.preventDefault();
        const result = await post<{ codes: string[] }>({ action: "totp_confirm", code: setupCode });
        if (result) { setSetup(null); setCodes(result.codes); notify("Tvåstegsverifiering är påslagen."); }
      }} data-testid="totp-setup">
        <p className="text-sm">1. Öppna autentiseringsappen och lägg till ett konto. Skanna QR-koden – eller skriv in nyckeln för hand.</p>
        <div className="flex flex-wrap items-center gap-4">
          <img src={setup.qr} alt="QR-kod för autentiseringsappen" width={180} height={180} className="rounded border bg-white p-1" />
          <div className="min-w-0 space-y-1 text-xs"><p className="text-muted-foreground">Nyckel att skriva in</p><p className="break-all font-mono text-sm" data-testid="totp-secret">{setup.secret}</p><p className="text-muted-foreground">Tidsbaserad, sex siffror.</p></div>
        </div>
        <Field id="totp-setup-code" label="2. Skriv koden som appen visar" value={setupCode} onChange={setSetupCode} required />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || setupCode.replace(/\D/g, "").length !== 6}>Slå på</Button>
          <Button type="button" variant="outline" onClick={() => setSetup(null)}>Avbryt</Button>
        </div>
      </form> : twoFactor.enabled ? <p className={twoFactor.backupCodesLeft <= 3 ? "text-sm text-amber-700 dark:text-amber-300" : "text-sm"} data-testid="backup-left">
        Reservkoder kvar: {twoFactor.backupCodesLeft} av 10.{twoFactor.backupCodesLeft <= 3 ? " Skapa nya innan de tar slut." : ""}</p> : null}
      {/* Stäng av is asked for under Mer; the confirmation's fields stand in the card, where the person types. */}
      {canTurnOff && disabling ? <form className="space-y-3" onSubmit={async (event) => {
        event.preventDefault();
        if (await post({ action: "totp_disable", password: disablePassword || undefined, code: disableCode })) {
          setDisabling(false); setDisablePassword(""); setDisableCode(""); notify("Tvåstegsverifiering är avstängd."); void load();
        }
      }} data-testid="totp-disable">
        <p className="text-sm text-muted-foreground">Bekräfta med {twoFactor.hasPassword ? "ditt lösenord och " : ""}en kod från appen eller en reservkod.</p>
        {twoFactor.hasPassword ? <Field id="totp-disable-password" type="password" label="Lösenord" value={disablePassword} onChange={setDisablePassword} required /> : null}
        <Field id="totp-disable-code" label="Kod" value={disableCode} onChange={setDisableCode} required />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="destructive" disabled={busy}>Stäng av tvåstegsverifiering</Button>
          <Button type="button" variant="outline" onClick={() => setDisabling(false)}>Avbryt</Button>
        </div>
      </form> : null}
    </KeyCard></div>

    <PasskeySettings notify={notify} />

    <div data-testid="sessions"><KeyCard icon={MonitorSmartphone} title="Aktiva inloggningar" description="Där du är inloggad just nu." status={null}
      more={<>
        <p>Logga ut överallt avslutar alla dina inloggningar, även den här. Du loggar in igen efteråt.</p>
        <Button type="button" variant="ghost" size="sm" className="w-fit text-destructive" disabled={busy} onClick={async () => {
          if (!(await confirm({ title: "Logga ut överallt?", message: "Alla dina inloggningar avslutas, även den här. Du loggar in igen efteråt.", confirmLabel: "Logga ut överallt", tone: "danger" }))) return;
          if (await post({ action: "sessions_revoke_all" })) await signOutAndForget({ callbackUrl: "/login" });
        }} data-testid="sessions-revoke-all"><LogOut />Logga ut överallt</Button>
      </>}>
      <ul className="space-y-3 text-sm" aria-label="Aktiva inloggningar">
        {data.sessions.map((session) => <li key={session.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="font-medium">{session.client}</span>{session.current ? <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs text-primary">Den här enheten</span> : null}
            <span className="block text-xs text-muted-foreground">{SIGN_IN_METHOD_LABELS[session.method] ?? session.method} · inloggad {dateTime(session.createdAt)} · aktiv {roughAgo(session.lastSeenAt)}</span>
          </span>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => {
            if (!(await post({ action: "session_revoke", id: session.id }))) return;
            if (session.current) { await signOutAndForget({ callbackUrl: "/login" }); return; }
            notify("Inloggningen är avslutad."); void load();
          }}>Logga ut</Button>
        </li>)}
        {!data.sessions.length ? <li className="text-muted-foreground">Inga inloggningar att visa.</li> : null}
      </ul>
      {!data.sessionTracked ? <p className="text-xs text-muted-foreground">Den här inloggningen startade innan listan fanns och visas därför inte. Logga ut överallt avslutar även den.</p> : null}
    </KeyCard></div>

    {/* Lists start folded (2026-10-22): the person's own log is a folded list card. */}
    <div data-testid="my-security-log-fold"><Panel icon={History} title="Min säkerhetslogg" description="Inloggningar och ändringar de senaste 12 månaderna." collapsible defaultCollapsed>
      <section className="space-y-3" data-testid="my-security-log">
        {native ? null : <p className="text-xs text-muted-foreground">{SECURITY_LOG_NOTE}</p>}
        <SecurityLogList page={data.log} load={async (before) => (await api<{ log: SecurityLogPage }>(`/api/security?before=${encodeURIComponent(before)}`)).log} />
      </section>
    </Panel></div>
  </div></NativeLeadPanel.Provider>;
}
