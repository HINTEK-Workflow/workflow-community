"use client";

import type { FormEvent } from "react";
import { startTransition, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  PlayCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
};

export function LoginForm({
  returnTo,
  notice,
  initialError,
  googleEnabled = false,
  googleOffered = true,
  termsOf = null,
  demo = false,
}: LoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setError("Fyll i både e-postadress och lösenord.");
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
        callbackUrl: returnTo,
      });

      if (result?.error) {
        setError("Fel e-postadress eller lösenord.");
        setPending(false);
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

  return (
    <div className="space-y-7">
      {notice ? (
        <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Klart</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Inloggning misslyckades</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="space-y-5"
      >
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">
            E-post
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="namn@exempel.se"
            className="h-10 text-sm"
            required
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
            className="h-10 text-sm"
            required
          />
        </div>

        <div className="flex items-center justify-between gap-4 text-sm">
          <Link
            href="/forgot-password"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Glömt lösenord?
          </Link>
        </div>

        <Button
          type="submit"
          className="h-10 w-full"
          size="lg"
          disabled={pending || googlePending}
        >
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Loggar in...
            </>
          ) : (
            <>
              Logga in
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </form>

      {googleOffered ? <div className="space-y-4">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-slate-200" />
          Eller fortsätt med
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <div className="grid gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-10 w-full"
            onClick={googleEnabled ? handleGoogleSignIn : undefined}
            disabled={!googleEnabled || googlePending || pending}
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {googlePending ? "Google..." : "Google"}
          </Button>
        </div>

        {!googleEnabled ? (
          <p className="text-center text-xs leading-5 text-muted-foreground">
            Google-inloggning är inte tillgänglig just nu.
          </p>
        ) : null}
      </div> : null}

      {demo ? <div className="space-y-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-slate-200" />
          Vill du se hur det fungerar?
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        {/* A plain link: /demo sets the demo cookie, so it must never be prefetched. */}
        <Button asChild variant="outline" size="lg" className="h-10 w-full">
          <a href="/demo"><PlayCircle />Visa demo med exempeldata</a>
        </Button>
        <p className="text-center text-xs leading-5 text-muted-foreground">Påhittade kunder och uppgifter. Inget sparas och inget konto behövs.</p>
      </div> : null}

      {termsOf ? <p className="text-center text-xs leading-5 text-muted-foreground">
        Läs {termsOf}s{" "}
        <Link href="/legal/terms" className="underline underline-offset-4">tjänstevillkor</Link>,{" "}
        <Link href="/legal/privacy" className="underline underline-offset-4">integritetspolicy</Link>{" "}
        och <Link href="/legal/dpa" className="underline underline-offset-4">DPA</Link>.
      </p> : null}
    </div>
  );
}
