import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { inspectPasswordResetToken } from "@/lib/auth/service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const token = firstValue(params.token);
  const resetToken = token ? await inspectPasswordResetToken(token) : null;

  const valid = Boolean(token && resetToken);

  return (
    <AuthShell
      title={valid ? "Sätt nytt lösenord" : "Länken fungerar inte"}
      description={valid ? "Välj ett nytt lösenord för ditt konto. Länken kan bara användas en gång." : "Återställningslänken saknas, har gått ut eller är redan använd."}
    >
      <div className="space-y-6">
        {token && resetToken ? (
          <ResetPasswordForm token={token} />
        ) : (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Ogiltig återställningslänk</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                <Link href="/forgot-password" className="font-medium underline underline-offset-4">
                  Skicka en ny återställningslänk
                </Link>
              </p>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </AuthShell>
  );
}
