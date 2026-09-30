import nodemailer from "nodemailer";
import { env } from "@/lib/env";

declare global {
  var workflowTransporter: ReturnType<typeof nodemailer.createTransport> | undefined;
}

function createTransporter() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER
      ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        }
      : undefined,
  });
}

function getTransporter() {
  if (!global.workflowTransporter) {
    global.workflowTransporter = createTransporter();
  }

  return global.workflowTransporter;
}

export async function sendSystemEmail(input: {
  to: string;
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
}) {
  const transporter = getTransporter();

  return transporter.sendMail({
    from: `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM_ADDRESS}>`,
    to: input.to,
    bcc: input.bcc,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}
