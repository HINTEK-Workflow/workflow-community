import nodemailer from "nodemailer";
import { mailConfig } from "@/lib/mail/settings-server";
import type { MailConfig } from "@/lib/mail/settings";

declare global {
  var workflowTransporter: { key: string; transporter: ReturnType<typeof nodemailer.createTransport> } | undefined;
}

// One transporter per SMTP setting: a change on the E-post page takes effect at the next mail without a restart.
function transporterFor(transport: MailConfig["transport"]) {
  const key = JSON.stringify(transport);
  if (global.workflowTransporter?.key !== key) {
    global.workflowTransporter = {
      key,
      transporter: nodemailer.createTransport({
        host: transport.host,
        port: transport.port,
        secure: transport.secure,
        auth: transport.user ? { user: transport.user, pass: transport.password } : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
      }),
    };
  }
  return global.workflowTransporter.transporter;
}

type SystemEmail = { to: string; bcc?: string[]; subject: string; html: string; text: string };

/** Sends with the settings that apply now (E-post in the app, otherwise .env). */
export async function sendSystemEmail(input: SystemEmail) {
  const config = await mailConfig();
  return deliverSystemEmail(transporterFor(config.transport), config.from, input);
}

export function deliverSystemEmail(transporter: ReturnType<typeof nodemailer.createTransport>, from: MailConfig["from"], input: SystemEmail) {
  return transporter.sendMail({
    from: { name: from.name, address: from.address },
    to: input.to,
    bcc: input.bcc,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}
