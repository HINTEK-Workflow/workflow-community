import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { LoginForm } from "@/features/auth/components/login-form";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/session";

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
      return "Inloggning är endast öppen för det inbjudna testkontot.";
    case "google_missing_email":
      return "Google-kontot måste dela en e-postadress för att kunna användas.";
    case "google_unverified_email":
      return "Google-kontot måste ha en verifierad e-postadress.";
    case "google_account_disabled":
      return "Kontot är inaktiverat. Kontakta en administratör för access.";
    case "google_invite_required":
      return "Google-login är endast öppet för redan upplagda konton. Be en admin lägga upp dig först.";
    case "google_superadmin_required":
    case "superadmin_required":
      return "Inloggning är just nu endast öppen för superadmin-kontot.";
    default:
      return undefined;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();

  if (user?.role === UserRole.SUPERADMIN && user.emailVerifiedAt) {
    redirect("/");
  }

  if (user?.role === UserRole.SUPERADMIN && !user.emailVerifiedAt) {
    redirect(`/verify-email?email=${encodeURIComponent(user.email)}`);
  }

  const params = await searchParams;
  const returnTo = normalizeReturnTo(firstValue(params.returnTo));
  const reset = firstValue(params.reset);
  const verified = firstValue(params.verified);
  const error = firstValue(params.error);
  const effectiveError =
    user && user.role !== UserRole.SUPERADMIN ? "superadmin_required" : error;

  const notice =
    verified === "1"
      ? "Din e-postadress är verifierad. Logga in för att fortsätta."
      : reset === "1"
        ? "Ditt lösenord är uppdaterat. Logga in med det nya lösenordet."
        : undefined;
  const initialError = mapLoginError(effectiveError);
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  return (
    <AuthShell
      title="Välkommen tillbaka"
      description="Logga in för att fortsätta till din arbetsyta. Under testperioden är inloggningen endast öppen för det inbjudna testkontot."
    >
      <LoginForm
        returnTo={returnTo}
        notice={notice}
        initialError={initialError}
        googleEnabled={googleEnabled}
      />
    </AuthShell>
  );
}
