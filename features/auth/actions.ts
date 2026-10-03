"use server";

import { z } from "zod";
import type { AuthFormState } from "@/features/auth/form-state";
import { getCurrentUser } from "@/lib/auth/session";
import {
  requestPasswordReset,
  resetPasswordWithToken,
  sendVerificationEmail,
} from "@/lib/auth/service";
import { acceptInvitationWithToken } from "@/lib/auth/invitations";

const emailSchema = z.object({
  email: z.string().email("Ange en giltig e-postadress."),
});

const passwordResetSchema = z
  .object({
    token: z.string().min(1, "Reset-token saknas."),
    password: z
      .string()
      .min(12, "Lösenordet måste vara minst 12 tecken."),
    confirmPassword: z.string().min(12, "Bekräfta ditt lösenord."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Lösenorden matchar inte.",
    path: ["confirmPassword"],
  });

const invitationSchema = z
  .object({
    token: z.string().min(1, "Inbjudningstoken saknas."),
    password: z.string().min(12, "Lösenordet måste vara minst 12 tecken."),
    confirmPassword: z.string().min(12, "Bekräfta ditt lösenord."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Lösenorden matchar inte.",
    path: ["confirmPassword"],
  });

export async function requestPasswordResetAction(
  _previousState: AuthFormState,
  formData: FormData,
) {
  const parsed = emailSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Kunde inte tolka formularet.",
    } satisfies AuthFormState;
  }

  try {
    await requestPasswordReset(parsed.data.email);
  } catch {
    return {
      status: "error",
      message: "Kunde inte skicka återställningsmejl just nu.",
    } satisfies AuthFormState;
  }

  return {
    status: "success",
    message:
      "Om adressen finns i systemet har en återställningslänk skickats via e-post.",
  } satisfies AuthFormState;
}

export async function resetPasswordAction(
  _previousState: AuthFormState,
  formData: FormData,
) {
  const parsed = passwordResetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Kunde inte uppdatera lösenordet.",
    } satisfies AuthFormState;
  }

  const result = await resetPasswordWithToken(
    parsed.data.token,
    parsed.data.password,
  );

  return {
    status: result.ok ? "success" : "error",
    message: result.message,
  } satisfies AuthFormState;
}

export async function resendVerificationAction(
  _previousState: AuthFormState,
  formData: FormData,
) {
  const user = await getCurrentUser();
  const emailField = formData.get("email");
  const emailValue = typeof emailField === "string" ? emailField : "";
  const email = (emailValue || user?.email || "").trim();

  if (!email) {
    return {
      status: "error",
      message: "Ange e-postadressen som ska verifieras.",
    } satisfies AuthFormState;
  }

  try {
    await sendVerificationEmail(email);
  } catch {
    return {
      status: "error",
      message: "Kunde inte skicka verifieringsmejl just nu.",
    } satisfies AuthFormState;
  }

  return {
    status: "success",
    message:
      "Om adressen finns och inte redan är verifierad har en ny verifieringslänk skickats.",
  } satisfies AuthFormState;
}

export async function acceptInvitationAction(
  _previousState: AuthFormState,
  formData: FormData,
) {
  const parsed = invitationSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success)
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Kunde inte tolka formuläret.",
    } satisfies AuthFormState;

  const result = await acceptInvitationWithToken(
    parsed.data.token,
    parsed.data.password,
    { newsletter: formData.get("newsletter") === "on" },
  );
  return {
    status: result.ok ? "success" : "error",
    message: result.message,
  } satisfies AuthFormState;
}
