import Link from "next/link";
import { CheckCircle2, Mail, MailWarning } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { ResendVerificationForm } from "@/features/auth/components/resend-verification-form";
import { getCurrentUser } from "@/lib/auth/session";
import { verifyEmailWithToken } from "@/lib/auth/service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const token = firstValue(params.token);
  const emailFromUrl = firstValue(params.email);
  const user = await getCurrentUser();

  const verificationResult = token ? await verifyEmailWithToken(token) : null;
  const email = user?.email ?? emailFromUrl ?? "";
  const alreadyVerified = Boolean(user?.emailVerifiedAt);

  return (
    <AuthShell
      title="Verifiera e-post"
      description="Dashboarden är skyddad tills kontots e-postadress är verifierad."
    >
      <div className="space-y-6">
        {verificationResult?.ok ? (
          <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
            <CheckCircle2 className="size-4" />
            <AlertTitle>Verifieringen lyckades</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{verificationResult.message}</p>
              <p>
                <Link
                  href={user ? "/dashboard" : "/login?verified=1"}
                  className="font-medium underline underline-offset-4"
                >
                  {user ? "Gå till dashboard" : "Fortsätt till inloggning"}
                </Link>
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        {token && verificationResult && !verificationResult.ok ? (
          <Alert variant="destructive">
            <MailWarning className="size-4" />
            <AlertTitle>Verifieringen gick inte igenom</AlertTitle>
            <AlertDescription>{verificationResult.message}</AlertDescription>
          </Alert>
        ) : null}

        {alreadyVerified && !token ? (
          <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
            <CheckCircle2 className="size-4" />
            <AlertTitle>Kontot är redan verifierat</AlertTitle>
            <AlertDescription>
              Din adress är redan verifierad.{" "}
              <Link href="/dashboard" className="font-medium underline underline-offset-4">
                Öppna dashboarden
              </Link>
              .
            </AlertDescription>
          </Alert>
        ) : null}

        {!alreadyVerified ? (
          <>
            <Alert>
              <Mail className="size-4" />
              <AlertTitle>Behövs ett nytt mejl?</AlertTitle>
              <AlertDescription>
                Skicka en ny verifieringslänk till din adress. Formuläret är också användbart om du
                loggat in men inte fått mejlet än.
              </AlertDescription>
            </Alert>
            <ResendVerificationForm email={email} locked={Boolean(user?.email)} />
          </>
        ) : null}
      </div>
    </AuthShell>
  );
}
