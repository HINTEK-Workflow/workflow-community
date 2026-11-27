import Link from "next/link";
import { MailWarning, ShieldCheck } from "lucide-react";
import { formatSwedish } from "@/lib/swedish-time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { InvitationAcceptForm } from "@/features/auth/components/invitation-accept-form";
import {
  inspectInvitationToken,
  invitationDeliveryEnabled,
  invitationTokenUsed,
} from "@/lib/auth/invitations";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InvitePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const value = params.token;
  const token = Array.isArray(value) ? value[0] : value;
  const invitation = token ? await inspectInvitationToken(token) : null;
  const deliveryEnabled = await invitationDeliveryEnabled();
  // A link that was already accepted is told apart from one that ran out (2026-11-20).
  const used = token && !invitation ? await invitationTokenUsed(token) : false;

  return (
    <AuthShell
      title="Företagsinbjudan"
      description="Verifiera din adress innan ett medlemskap aktiveras."
    >
      <div className="space-y-5">
        {!deliveryEnabled ? (
          <Alert>
            <ShieldCheck className="size-4" />
            <AlertTitle>Privat test pågår</AlertTitle>
            <AlertDescription>
              Nya konton och inbjudningslänkar är ännu inte öppnade.
            </AlertDescription>
          </Alert>
        ) : used ? (
          <Alert data-testid="invite-used">
            <MailWarning className="size-4" />
            <AlertTitle>Inbjudan är redan använd</AlertTitle>
            <AlertDescription>
              Logga in med din e-postadress och ditt lösenord.{" "}
              <Link href="/login" className="font-medium text-primary underline underline-offset-4">Till inloggningen</Link>
            </AlertDescription>
          </Alert>
        ) : !invitation || !token ? (
          <Alert variant="destructive">
            <MailWarning className="size-4" />
            <AlertTitle>Inbjudan finns inte eller har gått ut</AlertTitle>
            <AlertDescription>
              Be den som bjöd in dig om en ny länk.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert>
              <ShieldCheck className="size-4" />
              <AlertTitle>{invitation.organizationName}</AlertTitle>
              <AlertDescription>
                Inbjudan gäller {invitation.email} och löper ut{" "}
                {formatSwedish(invitation.expiresAt, { dateStyle: "short", timeStyle: "short" })}.
              </AlertDescription>
            </Alert>
            <InvitationAcceptForm token={token} />
          </>
        )}
      </div>
    </AuthShell>
  );
}
