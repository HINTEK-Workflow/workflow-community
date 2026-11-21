import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { deliverSystemEmail } from "@/lib/mail/mailer";
import { mailConfig, saveMailSettings } from "@/lib/mail/settings-server";
import { publicMailSettings, testMailTarget } from "@/lib/mail/settings";
import { publicInstance } from "@/lib/instance";
import nodemailer from "nodemailer";
import { requireCentralKeyChange, requireCentralKeyViewer } from "@/lib/secrets/central-access";
import { CentralStoreError } from "@/lib/secrets/central-store";

export const dynamic = "force-dynamic";

/**
 * E-post (2026-09-30): the installation's SMTP server, sender and which mail is sent, set by the superadmin in
 * the app. The password is written, never read back; the test mail goes only to the superadmin's own address.
 */
// Workflow's superadmin only, and a fresh sign-in for every change of a key (lib/secrets/central-access.ts, 2026-10-25).
async function superadmin() {
  const ctx = await context({ skipLegal: true });
  requireCentralKeyViewer(ctx);
  return ctx;
}

export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(publicMailSettings(await mailConfig()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}

export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    // The SMTP server decides where "Glömt lösenord" goes: every save is a change of a central key's use (M1).
    const actor = await requireCentralKeyChange(ctx);
    const parsed = await body(request);
    try {
      await saveMailSettings(parsed, actor);
    } catch (error) {
      if (error instanceof z.ZodError) throw new ApiError(400, error.issues[0]?.message ?? "Kontrollera uppgifterna.");
      throw error;
    }
    await prisma.administrationEvent.create({
      data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "mail_settings", detail: "Sparade e-postinställningarna." },
    });
    return NextResponse.json(publicMailSettings(await mailConfig()));
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}

/**
 * Sends a test mail with the saved settings; the SMTP error text is not passed on. `{}` goes to the superadmin's own
 * address; `{ "to": "alerts" }` (Skicka provlarm, 2026-11-20) goes to the saved recipient of Driftlarm.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const config = await mailConfig();
    if (config.blockedReason) throw new ApiError(409, config.blockedReason);
    const target = testMailTarget(await body(request), config, ctx.user.email);
    if ("error" in target) throw new ApiError(400, target.error);
    const { name } = publicInstance();
    const transporter = nodemailer.createTransport({
      host: config.transport.host, port: config.transport.port, secure: config.transport.secure,
      auth: config.transport.user ? { user: config.transport.user, pass: config.transport.password } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
    const alarm = target.kind === "alerts";
    try {
      await deliverSystemEmail(transporter, config.from, alarm ? {
        to: target.to,
        subject: "Provlarm från Workflow",
        text: `Det här är ett provlarm från ${name}. Larmen om driften kommer fram till den här adressen.`,
        html: `<p>Det här är ett provlarm från ${name.replace(/[<>&]/g, "")}. Larmen om driften kommer fram till den här adressen.</p>`,
      } : {
        to: target.to,
        subject: `Testmejl från ${name}`,
        text: `E-posten fungerar. Det här testmejlet skickades från ${name} via ${config.transport.host}.`,
        html: `<p>E-posten fungerar. Det här testmejlet skickades från ${name.replace(/[<>&]/g, "")}.</p>`,
      });
    } catch {
      throw new ApiError(502, `${alarm ? "Provlarmet" : "Testmejlet"} kunde inte skickas. Kontrollera server, port, kryptering, användarnamn och lösenord.`);
    }
    if (alarm) {
      await prisma.administrationEvent.create({
        data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "mail_settings", detail: "Skickade ett provlarm till mottagaren av driftlarm." },
      });
    }
    return NextResponse.json({ ok: true, to: target.to });
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}
