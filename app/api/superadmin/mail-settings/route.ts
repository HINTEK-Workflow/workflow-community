import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { deliverSystemEmail } from "@/lib/mail/mailer";
import { mailConfig, saveMailSettings } from "@/lib/mail/settings-server";
import { publicMailSettings } from "@/lib/mail/settings";
import { publicInstance } from "@/lib/instance";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";

/**
 * E-post (2026-09-30): the installation's SMTP server, sender and which mail is sent, set by the superadmin in
 * the app. The password is written, never read back; the test mail goes only to the superadmin's own address.
 */
async function superadmin() {
  const ctx = await context({ skipLegal: true });
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratör krävs.");
  return ctx;
}

export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(publicMailSettings(await mailConfig()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const parsed = await body(request);
    try {
      await saveMailSettings(parsed);
    } catch (error) {
      if (error instanceof z.ZodError) throw new ApiError(400, error.issues[0]?.message ?? "Kontrollera uppgifterna.");
      throw error;
    }
    await prisma.administrationEvent.create({
      data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "mail_settings", detail: "Sparade e-postinställningarna." },
    });
    return NextResponse.json(publicMailSettings(await mailConfig()));
  } catch (error) {
    return failure(error);
  }
}

/** Sends a test mail to the superadmin's own address with the saved settings; the SMTP error text is not passed on. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const config = await mailConfig();
    if (config.blockedReason) throw new ApiError(409, config.blockedReason);
    const { name } = publicInstance();
    const transporter = nodemailer.createTransport({
      host: config.transport.host, port: config.transport.port, secure: config.transport.secure,
      auth: config.transport.user ? { user: config.transport.user, pass: config.transport.password } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
    try {
      await deliverSystemEmail(transporter, config.from, {
        to: ctx.user.email,
        subject: `Testmejl från ${name}`,
        text: `E-posten fungerar. Det här testmejlet skickades från ${name} via ${config.transport.host}.`,
        html: `<p>E-posten fungerar. Det här testmejlet skickades från ${name.replace(/[<>&]/g, "")}.</p>`,
      });
    } catch {
      throw new ApiError(502, "Testmejlet kunde inte skickas. Kontrollera server, port, kryptering, användarnamn och lösenord.");
    }
    return NextResponse.json({ ok: true, to: ctx.user.email });
  } catch (error) {
    return failure(error);
  }
}
