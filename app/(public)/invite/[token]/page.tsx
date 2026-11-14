import Link from "next/link";
import { MailWarning } from "lucide-react";
import { redirect } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { inspectInvitationToken } from "@/lib/auth/invitations";

/**
 * An invitation link written as /invite/<token> (MOB-20, 2026-10-18): a valid one goes on to the accept page, an invalid
 * one gets a short explanation and the way to the login page instead of the general 404.
 */
export default async function InviteByPathPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = token ? await inspectInvitationToken(token).catch(() => null) : null;
  if (invitation) redirect(`/invite?token=${encodeURIComponent(token)}`);
  return (
    <AuthShell title="Företagsinbjudan" description="Verifiera din adress innan ett medlemskap aktiveras.">
      <div className="space-y-5">
        <Alert variant="destructive" data-testid="invite-invalid">
          <MailWarning className="size-4" />
          <AlertTitle>Inbjudan finns inte eller har gått ut</AlertTitle>
          <AlertDescription>Be den som bjöd in dig om en ny länk.</AlertDescription>
        </Alert>
        <Link href="/login" className="inline-block text-sm font-medium text-primary underline underline-offset-4">Till inloggningen</Link>
      </div>
    </AuthShell>
  );
}
