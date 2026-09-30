"use client";

import { useActionState } from "react";
import { MailCheck, ShieldQuestion } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction } from "@/features/auth/actions";
import { initialAuthFormState } from "@/features/auth/form-state";
import { SubmitButton } from "@/features/auth/components/submit-button";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(
    requestPasswordResetAction,
    initialAuthFormState,
  );

  return (
    <form
      action={formAction}
      className="space-y-5"
    >
      {state.status === "success" ? (
        <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
          <MailCheck className="size-4" />
          <AlertTitle>Länk skickad</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {state.status === "error" ? (
        <Alert variant="destructive">
          <ShieldQuestion className="size-4" />
          <AlertTitle>Kunde inte fortsätta</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">E-postadress</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="namn@foretag.se"
          className="h-10 text-sm"
          required
        />
      </div>

      <SubmitButton pendingLabel="Skickar länk...">
        Skicka återställningslänk
      </SubmitButton>
    </form>
  );
}
