"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "@/features/auth/actions";
import { initialAuthFormState } from "@/features/auth/form-state";
import { SubmitButton } from "@/features/auth/components/submit-button";

type ResetPasswordFormProps = {
  token: string;
};

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [state, formAction] = useActionState(
    resetPasswordAction,
    initialAuthFormState,
  );

  return (
    <form
      action={formAction}
      className="space-y-5"
    >
      <input type="hidden" name="token" value={token} />

      {state.status === "success" ? (
        <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Lösenordet är uppdaterat</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{state.message}</p>
            <p>
              <Link href="/login" className="font-medium text-emerald-900 underline underline-offset-4">
                Gå till inloggning
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Kunde inte uppdatera lösenordet</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="password">Nytt lösenord</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Minst 12 tecken"
          className="h-10 text-sm"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Bekräfta lösenord</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="Skriv samma lösenord igen"
          className="h-10 text-sm"
          required
        />
      </div>

      <div className="auth-note text-sm leading-7 text-muted-foreground">
        <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
          <KeyRound className="size-4 text-primary" />
          Rekommendation
        </div>
        Använd minst 12 tecken och kombinera ord, siffror och tecken för ett starkt
        lösenord.
      </div>

      <SubmitButton pendingLabel="Uppdaterar...">Sätt nytt lösenord</SubmitButton>
    </form>
  );
}
