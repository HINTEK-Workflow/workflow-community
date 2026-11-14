import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { registrationOpen } from "@/lib/auth/registration";
import { googleKeysConfigured, googleSignInAllowed } from "@/lib/auth/login-settings";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { LoginForm } from "@/features/auth/components/login-form";
import { publicInstance } from "@/lib/instance";
import { getCurrentUser } from "@/lib/auth/session";
import { microsoftSignInReady } from "@/lib/auth/microsoft";
import { MICROSOFT_ERRORS, type MicrosoftError } from "@/lib/auth/microsoft-text";

/** "Logga in | Workflow" through the root layout's template (kundresa 2026-11-07, M14: the tab said the start page's title). */
export const metadata: Metadata = { title: "Logga in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeReturnTo(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  return value;
}

function mapLoginError(value: string | undefined) {
  switch (value) {
    case "test_access":
    case "AccessDenied":
      return "Den här e-postadressen har inte tillgång till Workflow. Logga in med adressen du blev inbjuden med.";
    case "google_missing_email":
      return "Google-kontot måste dela en e-postadress för att kunna användas.";
    case "google_unverified_email":
      return "Google-kontot måste ha en verifierad e-postadress.";
    case "google_account_disabled":
      return "Kontot är inaktiverat. Kontakta en administratör för åtkomst.";
    case "google_invite_required":
      return "Google-inloggning kräver ett befintligt konto. Be en administratör bjuda in dig.";
    case "google_disabled":
      return "Inloggning med Google är avstängd. Logga in med e-post och lösenord.";
    case "superadmin_required":
      return "Inloggning är just nu endast öppen för superadmin-kontot.";
    default:
      // Microsoft (2026-10-11): the reasons a Microsoft sign-in was refused, in words.
      return value && Object.hasOwn(MICROSOFT_ERRORS, value) ? MICROSOFT_ERRORS[value as MicrosoftError] : undefined;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();

  const params = await searchParams;
  const returnTo = normalizeReturnTo(firstValue(params.returnTo));
  // Someone already signed in goes on to where they were headed (2026-10-02: a signed-in member met "superadmin krävs").
  if (user?.emailVerifiedAt) redirect(returnTo);
  if (user && !user.emailVerifiedAt) redirect(`/verify-email?email=${encodeURIComponent(user.email)}`);

  const reset = firstValue(params.reset);
  const verified = firstValue(params.verified);
  const error = firstValue(params.error);
  const effectiveError = error;

  const notice =
    verified === "1"
      ? "Din e-postadress är verifierad. Logga in för att fortsätta."
      : reset === "1"
        ? "Ditt lösenord är uppdaterat. Logga in med det nya lösenordet."
        : firstValue(params.raderat) === "1"
          ? "Ditt konto och dina personuppgifter är raderade."
          : undefined;
  const initialError = mapLoginError(effectiveError);
  const { name, features, defaultBrand } = publicInstance();
  const googleAllowed = features.googleSignIn && await googleSignInAllowed();
  const googleEnabled = googleAllowed && await googleKeysConfigured();

  return (
    <AuthShell
      title="Välkommen tillbaka"
      description="Logga in för att fortsätta till din arbetsyta."
    >
      <LoginForm
        returnTo={returnTo}
        notice={notice}
        initialError={initialError}
        googleEnabled={googleEnabled}
        googleOffered={googleEnabled}
        termsOf={name}
        demo={features.demoOnLogin}
        registerOpen={await registrationOpen()}
        accountsSoon={defaultBrand}
        microsoftEnabled={await microsoftSignInReady()}
      />
    </AuthShell>
  );
}
