import { MailWarning, ShieldCheck } from "lucide-react";
import { formatSwedish } from "@/lib/swedish-time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { InvitationAcceptForm } from "@/features/auth/components/invitation-accept-form";
import {
  inspectInvitationToken,
  invitationDeliveryEnabled,
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
        ) : !invitation || !token ? (
          <Alert variant="destructive">
            <MailWarning className="size-4" />
            <AlertTitle>Inbjudan kan inte användas</AlertTitle>
            <AlertDescription>
              Länken är ogiltig, återkallad, redan använd eller har gått ut.
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
