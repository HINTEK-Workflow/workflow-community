import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { RegisterForm } from "@/features/auth/components/register-form";
import { getCurrentUser } from "@/lib/auth/session";
import { googleKeysConfigured, googleSignInAllowed } from "@/lib/auth/login-settings";
import { registrationOpen, registrationStorageMode } from "@/lib/auth/registration";
import { publicInstance } from "@/lib/instance";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Skapa konto (2026-10-03): only while "Tillåt nya konton" is on. */
export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  if (await getCurrentUser()) redirect("/");
  const params = await searchParams;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  if (!(await registrationOpen()))
    return <AuthShell title="Skapa konto" description="Nya konton kan inte skapas just nu.">
      <p className="text-sm text-muted-foreground">Har du fått en inbjudan? Följ länken i inbjudan. Annars kan du <Link href="/login" className="font-medium text-primary underline underline-offset-4">logga in</Link>.</p>
    </AuthShell>;
  const googleEnabled = publicInstance().features.googleSignIn && await googleSignInAllowed() && await googleKeysConfigured();
  const known: Record<string, string> = { google_unverified_email: "Google-kontot måste ha en verifierad e-postadress." };
  return <AuthShell title="Skapa konto" description={`Kom igång med ${publicInstance().name} gratis. Konton är för företag, både aktiebolag och enskilda firmor, inte för privatpersoner.`}>
    <RegisterForm localStart={(await registrationStorageMode()) === "LOCAL"} googleEnabled={googleEnabled} initialError={error ? known[error] ?? error : undefined} />
  </AuthShell>;
}
