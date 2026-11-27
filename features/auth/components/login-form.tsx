"use client";

import type { FormEvent } from "react";
import { Fragment, startTransition, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LEGAL_LINKS } from "@ee/present";
import { fullName } from "@/components/legal-links";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AlertCircle, CheckCircle2, LoaderCircle, PlayCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OneTimeCodeInput } from "@/components/ui/one-time-code-input";
import { PasskeySignIn } from "@/features/auth/components/passkey-sign-in";
import { forgetRecentSearches } from "@/features/auth/sign-out";
import { clearWorkspaceCache } from "@/lib/workflow/workspace-cache";
import { DEMO_LOGIN_HREF, isDemoLogin } from "@/lib/demo";
import { safeLocalPath } from "@/lib/security/safe-return";

type LoginFormProps = {
  returnTo: string;
  notice?: string;
  initialError?: string;
  googleEnabled?: boolean;
  /** false in the community edition: no Google row at all. */
  googleOffered?: boolean;
  /** Whose terms the footer links to; null when this installation publishes none. */
  termsOf?: string | null;
  /** The community edition shows a button to the fictional demo (2026-09-30). */
  demo?: boolean;
  /** "Tillåt nya konton" is on: a link to Skapa konto (2026-10-03). */
  registerOpen?: boolean;
  /** Workflow's own installation while new accounts are closed: one line that says so (kundresa 2026-11-07, M14). */
  accountsSoon?: boolean;
  /** Fortsätt med Microsoft (2026-10-11): only when switched on, configured and checked. */
  microsoftEnabled?: boolean;
  /** Koden efter Google eller Microsoft (G-09): the provider's name while its sign-in waits for the code. */
  oauthCodeStep?: string;
};

export function LoginForm({
  returnTo: requested,
  notice,
  initialError,
  googleEnabled = false,
  googleOffered = true,
  termsOf = null,
  registerOpen = false,
  accountsSoon = false,
  demo = false,
  microsoftEnabled = false,
  oauthCodeStep,
}: LoginFormProps) {
  const router = useRouter();
  // Checked here too, so every sign-in way (password, Google, Microsoft, passkey) only leads to Workflow's own pages (M1).
  const returnTo = safeLocalPath(requested) ?? "/";
  const [error, setErrorText] = useState<string | null>(initialError ?? null);
  // Tillgänglighet (granskningen 2026-11-24, G-29, WCAG 3.3.1): when the error is about what was typed (fieldError), the fields
  // are marked invalid and point to the message; any other error (setError: connection, service, Google) leaves them unmarked.
  const [errorOnFields, setErrorOnFields] = useState(false);
  const setError = (text: string | null) => { setErrorText(text); setErrorOnFields(false); };
  const fieldError = (text: string) => { setErrorText(text); setErrorOnFields(true); };
  const fieldsInvalid = Boolean(error) && errorOnFields;
  const invalidProps = fieldsInvalid ? { "aria-invalid": true, "aria-describedby": "login-error" } as const : {};
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [microsoftPending, setMicrosoftPending] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);
  // Tvåstegsverifiering (2026-10-10): after a right password the server asks for the code; the address and password
  // stay in memory only while the code step is shown, and are sent again with the code.
  const [codeStep, setCodeStep] = useState<{ email: string; password: string } | null>(null);
  // Kodrutan (2026-11-25): the six digits (or a backup code) in one large field that goes on by itself.
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const inCodeStep = Boolean(codeStep || oauthCodeStep);
  // A session that ended without Logga ut (expired, or signed out everywhere from another device) also ends here: the
  // recent searches of whoever used this device go too (2026-10-23).
  useEffect(() => { forgetRecentSearches(); }, []);
  // A new sign-in in the same tab starts with nothing kept in memory (stabil sidladdning steg 7).
  useEffect(() => { clearWorkspaceCache(); }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    if (pending) return;
    if (oauthCodeStep) return submitOAuthCode(code.trim());
    const email = codeStep?.email ?? String(formData.get("email") ?? "").trim();
    const password = codeStep?.password ?? String(formData.get("password") ?? "");

    if (!email || !password) {
      fieldError("Fyll i både e-postadress och lösenord.");
      return;
    }
    // demo / demo opens the public demo (2026-11-04): checked here, before any sign-in is tried, and nothing is sent.
    if (!codeStep && isDemoLogin(email, password)) {
      window.location.assign(DEMO_LOGIN_HREF);
      return;
    }
    if (codeStep && !code) {
      fieldError("Skriv koden från autentiseringsappen eller en reservkod.");
      return;
    }

    setError(null);
    setPending(true);

    startTransition(async () => {
      try {
      const result = await signIn("credentials", {
        redirect: false,
        email,
        password,
        ...(codeStep ? { code } : {}),
        callbackUrl: returnTo,
      });

      if (result?.error) {
        if (result.error === "TOTP_REQUIRED") {
          setCodeStep({ email, password });
          setCode(""); setBackup(false);
          setPending(false);
          return;
        }
        // A wrong code is cleared, so the next one can be typed (or offered by the phone) straight away.
        if (result.error === "TOTP_INVALID") setCode("");
        // What was typed is wrong (the address, the password or the code): the fields are marked too.
        const typedWrong = result.error !== "RATE_LIMITED" && result.error !== "TRY_AGAIN_LATER";
        // Too many tries (security review 2026-10-04): said plainly, so a real person knows to wait.
        (typedWrong ? fieldError : setError)(result.error === "RATE_LIMITED" ? "För många inloggningsförsök. Vänta en kvart och försök igen, eller återställ lösenordet."
          // The shared counter could not be reached (plan 1G, 2026-10-11): refused calmly, no guess checked meanwhile.
          : result.error === "TRY_AGAIN_LATER" ? "Det gick inte att kontrollera inloggningen just nu. Försök igen om en stund."
          : result.error === "TOTP_INVALID" ? "Koden stämmer inte. Skriv den senaste koden från appen, eller en reservkod som inte har använts."
          : "Fel e-postadress eller lösenord.");
        setPending(false);
        return;
      }

      router.push(returnTo);
      router.refresh();
      } catch { setError("Kunde inte ansluta. Försök igen."); } finally { setPending(false); }
    });
  }

  // Koden efter Google eller Microsoft (G-09): the server keeps the provider's answer; only the code is sent.
  function submitOAuthCode(code: string) {
    if (!code) { fieldError("Skriv koden från autentiseringsappen eller en reservkod."); return; }
    setError(null);
    setPending(true);
    startTransition(async () => {
      try {
        const result = await signIn("oauth-code", { redirect: false, code, callbackUrl: returnTo });
        if (result?.error) {
          if (result.error === "TOTP_INVALID") setCode("");
          (result.error === "TOTP_INVALID" ? fieldError : setError)(result.error === "TOTP_INVALID" ? "Koden stämmer inte. Skriv den senaste koden från appen, eller en reservkod som inte har använts."
            : result.error === "RATE_LIMITED" ? "För många försök. Vänta en kvart och försök igen."
            : result.error === "TRY_AGAIN_LATER" ? "Det gick inte att kontrollera inloggningen just nu. Försök igen om en stund."
            : `Tiden för koden gick ut. Logga in med ${oauthCodeStep} igen.`);
          return;
        }
        router.push(returnTo);
        router.refresh();
      } catch { setError("Kunde inte ansluta. Försök igen."); } finally { setPending(false); }
    });
  }

  async function handleGoogleSignIn() {
    setError(null);
    setGooglePending(true);

    try { await signIn("google", {
      callbackUrl: returnTo,
    });

    } catch { setError("Kunde inte starta Google-inloggningen."); } finally { setGooglePending(false); }
  }

  async function handleMicrosoftSignIn() {
    setError(null);
    setMicrosoftPending(true);
    try { await signIn("microsoft", { callbackUrl: returnTo }); }
    catch { setError("Kunde inte starta Microsoft-inloggningen."); } finally { setMicrosoftPending(false); }
  }

  const otherPending = googlePending || microsoftPending || passkeyPending;

  return (
    <div className="space-y-7">
      {notice ? (
        <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Klart</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {/* In the code step the error stands under the code field, where the person types. */}
      {error && !inCodeStep ? (
        <Alert variant="destructive" id="login-error">

          <AlertCircle className="size-4" />
          <AlertTitle>Inloggning misslyckades</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* method="post": a press on Logga in before the page's script has started (a slow phone) must never put the
          password in the address bar, the history or the server's access log (granskningen 2026-10-20, S1). */}
      <form
        ref={formRef}
        method="post"
        onSubmit={handleSubmit}
        className="space-y-5"
      >
        {/* Tvåstegsrutan (2026-11-25, "QR-ruta + passkey"): the passkey first where the browser has one, then the code
            from the app in one large field that goes on by itself at the sixth digit; a backup code behind a link. */}
        {inCodeStep ? <div className="space-y-4" data-testid="login-code-step">
          <div className="space-y-1">
            <p className="text-base font-semibold">Bekräfta att det är du</p>
            <p className="text-sm leading-6 text-muted-foreground">{codeStep ? <>Tvåstegsverifiering är på för <span className="break-all font-medium text-foreground">{codeStep.email}</span>.</> : `Du loggade in med ${oauthCodeStep}, och tvåstegsverifiering är på för ditt konto.`}</p>
          </div>
          <PasskeySignIn returnTo={returnTo} busy={pending || googlePending || microsoftPending} onError={setError} onPending={setPasskeyPending} primary label="Använd passkey (Face ID / fingeravtryck)" testId="login-code-passkey" />
          {/* Logga in med telefonen (2026-11-27): one more choice; the passkey above and the code below stay as they are. */}
          <PasskeySignIn phone returnTo={returnTo} busy={pending || googlePending || microsoftPending} onError={setError} onPending={setPasskeyPending} testId="login-code-phone" />
          <div className="space-y-2 rounded-xl border bg-secondary/30 p-4">
            <Label htmlFor="code" className="text-sm font-medium">{backup ? "Reservkod" : "Kod från autentiseringsappen"}</Label>
            <OneTimeCodeInput id="code" name="code" value={code} onChange={(next) => { setCode(next); if (error) setError(null); }} autoFocus backup={backup} onBackupChange={setBackup}
              invalid={Boolean(error)} describedBy={error ? "code-error" : "code-help"} disabled={pending || passkeyPending} testId="login-code"
              onComplete={() => formRef.current?.requestSubmit()} />
            {error ? <p id="code-error" className="flex items-start gap-1.5 text-sm font-medium text-destructive" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p>
              : <p id="code-help" className="text-xs leading-5 text-muted-foreground">{backup ? "Skriv en av reservkoderna du sparade. Varje kod fungerar en gång." : "Öppna appen och skriv de sex siffrorna som visas just nu. Telefonen kan också föreslå koden."}</p>}
          </div>
          <button type="button" className="public-link text-xs" onClick={() => { if (oauthCodeStep) { router.replace("/login"); return; } setCodeStep(null); setCode(""); setBackup(false); setError(null); }}>Tillbaka</button>
        </div> : <>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">
            E-post
          </Label>
          <Input
            id="email"
            name="email"
            type="text"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            // An address, and exactly "demo" for demo / demo (type email would refuse it); the server checks every address again.
            pattern="demo|[^\s@]+@[^\s@]+\.[^\s@]+"
            title="Skriv din e-postadress."
            autoComplete="email webauthn"
            placeholder="namn@exempel.se"
            required
            {...invalidProps}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm font-medium">
            Lösenord
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            {...invalidProps}
          />
        </div>
        </>}

        {inCodeStep ? null : <div className="flex items-center justify-between gap-4 text-sm">
          <Link
            href="/forgot-password"
            className="public-link"
          >
            Glömt lösenord?
          </Link>
          {registerOpen ? <Link href="/register" className="public-link" data-testid="login-register">Skapa konto</Link> : null}
        </div>}

        <Button
          type="submit"
          className="w-full"
          variant={inCodeStep ? "outline" : "default"}
          disabled={pending || otherPending || (inCodeStep && (backup ? code.replace(/-/g, "").length < 10 : code.length !== 6))}
        >
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Loggar in...
            </>
          ) : (
            <>
              Logga in
            </>
          )}
        </Button>
        {/* Passkeys (2026-10-11): shown only where the browser can use them; also offered in the e-mail field's autofill. */}
        {inCodeStep ? null : <PasskeySignIn returnTo={returnTo} busy={pending || googlePending || microsoftPending} onError={setError} onPending={setPasskeyPending} />}
        {/* Logga in med telefonen (2026-11-27): an extra button beside the others, never instead of them. */}
        {inCodeStep ? null : <PasskeySignIn phone returnTo={returnTo} busy={pending || googlePending || microsoftPending} onError={setError} onPending={setPasskeyPending} />}
      </form>

      {googleOffered || microsoftEnabled ? <div className="space-y-4">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-slate-200" />
          Eller fortsätt med
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <div className="grid gap-3">
          {googleOffered ? <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={googleEnabled ? handleGoogleSignIn : undefined}
            disabled={!googleEnabled || googlePending || pending || microsoftPending || passkeyPending}
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {googlePending ? "Google..." : "Google"}
          </Button> : null}
          {microsoftEnabled ? <Button type="button" variant="outline" className="w-full" onClick={handleMicrosoftSignIn} disabled={microsoftPending || pending || googlePending || passkeyPending} data-testid="login-microsoft">
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path d="M2 2h9.5v9.5H2z" fill="#F25022" />
              <path d="M12.5 2H22v9.5h-9.5z" fill="#7FBA00" />
              <path d="M2 12.5h9.5V22H2z" fill="#00A4EF" />
              <path d="M12.5 12.5H22V22h-9.5z" fill="#FFB900" />
            </svg>
            {microsoftPending ? "Microsoft..." : "Microsoft"}
          </Button> : null}
        </div>

        {googleOffered && !googleEnabled ? (
          <p className="text-center text-xs leading-5 text-muted-foreground">
            Google-inloggning är inte tillgänglig just nu.
          </p>
        ) : null}
      </div> : null}

      {/* A visitor without an account is told why there is no Skapa konto (kundresa 2026-11-07, M14). No demo link here: the demo's way in is
          the start page (2026-11-05, the login button "Se demo och nyheter" was removed). */}
      {accountsSoon && !registerOpen && !demo ? <p className="text-center text-sm text-muted-foreground" data-testid="login-no-account">Inget konto? Konton öppnas snart.</p> : null}

      {demo ? <div className="space-y-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-slate-200" />
          Vill du se hur det fungerar?
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        {/* A plain link: /demo sets the demo cookie, so it must never be prefetched. */}
        <Button asChild variant="outline" className="w-full">
          <a href="/demo?via=button"><PlayCircle />Visa demo med exempeldata</a>
        </Button>
        <p className="text-center text-xs leading-5 text-muted-foreground">Påhittade kunder och uppgifter. Inget sparas och inget konto behövs.</p>
      </div> : null}

      {termsOf ? <p className="text-center text-xs leading-5 text-muted-foreground">
        {/* The same documents as the footers' LegalLinks (2026-10-08: "samma överallt"). */}
        Läs {termsOf}s{" "}
        {LEGAL_LINKS.map((link, index) => <Fragment key={link.key}>
          {index === 0 ? null : index === LEGAL_LINKS.length - 1 ? " och " : ", "}
          <Link href={`/legal/${link.key}`} className="public-link" {...fullName(link)}>{link.label === link.label.toUpperCase() ? link.label : link.label.toLowerCase()}</Link>
        </Fragment>)}.
      </p> : null}
    </div>
  );
}
