import Link from "next/link";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Återställ lösenord"
      description="Ange din e-postadress så skickas en ny länk via SMTP till ditt konto."
    >
      <div className="space-y-6">
        <ForgotPasswordForm />
        <p className="text-sm text-muted-foreground">
          Kom ihåg lösenordet?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Tillbaka till inloggning
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
