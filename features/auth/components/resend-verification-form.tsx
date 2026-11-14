"use client";

import { useActionState } from "react";
import { AlertCircle, MailCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resendVerificationAction } from "@/features/auth/actions";
import { initialAuthFormState } from "@/features/auth/form-state";
import { SubmitButton } from "@/features/auth/components/submit-button";

type ResendVerificationFormProps = {
  email?: string;
  locked?: boolean;
};

export function ResendVerificationForm({
  email = "",
  locked = false,
}: ResendVerificationFormProps) {
  const [state, formAction] = useActionState(
    resendVerificationAction,
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
          <AlertTitle>Verifieringsmejl skickat</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Kunde inte skicka mejl</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">E-postadress</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={email}
          autoComplete="email"
          placeholder="namn@foretag.se"
          className="h-10 text-sm"
          readOnly={locked}
          required
        />
      </div>

      <SubmitButton pendingLabel="Skickar nytt mail...">
        Skicka ny verifieringslänk
      </SubmitButton>
    </form>
  );
}
