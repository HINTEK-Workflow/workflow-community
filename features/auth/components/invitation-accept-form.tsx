"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInvitationAction } from "@/features/auth/actions";
import { initialAuthFormState } from "@/features/auth/form-state";
import { SubmitButton } from "@/features/auth/components/submit-button";

export function InvitationAcceptForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(
    acceptInvitationAction,
    initialAuthFormState,
  );
  if (state.status === "success")
    return (
      <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
        <CheckCircle2 className="size-4" />
        <AlertTitle>Inbjudan är accepterad</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{state.message}</p>
          <Link href="/login" className="font-medium underline underline-offset-4">
            Fortsätt till inloggning
          </Link>
        </AlertDescription>
      </Alert>
    );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      {state.status === "error" && (
        <Alert variant="destructive">
          <AlertTitle>Aktiveringen misslyckades</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="invite-password">Välj lösenord</Label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            id="invite-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            className="pl-10"
            required
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Minst 12 tecken. För ett befintligt konto behålls nuvarande lösenord.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-confirm-password">Bekräfta lösenord</Label>
        <Input
          id="invite-confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
        <input type="checkbox" name="newsletter" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
        <span>
          <span className="block font-medium">Ja, mejla mig om nyheter i Workflow</span>
          <span className="block text-xs text-muted-foreground">Ändringar och förbättringar i appen. Du kan ändra det när som helst under Mina inställningar.</span>
        </span>
      </label>
      <SubmitButton pendingLabel="Aktiverar…">Acceptera inbjudan</SubmitButton>
    </form>
  );
}
