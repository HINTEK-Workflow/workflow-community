import Link from "next/link";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { CloseThisTab } from "./close-this-tab";

/** The new tab after signing in again (features/security/session-expired-host.tsx): the work goes on in the first tab. */
export default function SignedInAgainPage() {
  return (
    <AuthShell title="Du är inloggad igen" description="Stäng den här fliken. Sidan du arbetade på fortsätter där du var.">
      <CloseThisTab />
      <p className="text-sm" data-testid="session-back"><Link className="font-medium text-primary hover:underline" href="/">Öppna Workflow</Link></p>
    </AuthShell>
  );
}
