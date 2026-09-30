import { publicInstance } from "@/lib/instance";
type MailTemplateInput = {
  heading: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  outro: string;
  expiresText: string;
};

function renderBaseTemplate(input: MailTemplateInput) {
  const escapeHtml = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[character]!,
    );
  const safeUrl = escapeHtml(input.actionUrl);
  const heading = escapeHtml(input.heading);
  const intro = escapeHtml(input.intro);
  const outro = escapeHtml(input.outro);
  const actionLabel = escapeHtml(input.actionLabel);
  const expiresText = escapeHtml(input.expiresText);

  const html = `
    <div style="margin:0;background:#f3f7ff;padding:32px 16px;font-family:'Segoe UI',Arial,sans-serif;color:#172033;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f0;border-radius:24px;overflow:hidden;box-shadow:0 18px 50px rgba(23,32,51,0.08);">
        <tr>
          <td style="padding:28px 28px 10px;">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#7b8798;">${escapeHtml(publicInstance().name)}</p>
            <h1 style="margin:0;font-size:28px;line-height:1.15;color:#172033;">${heading}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 12px;font-size:15px;line-height:1.7;color:#384458;">
            <p style="margin:0 0 12px;">${intro}</p>
            <p style="margin:0 0 24px;">${outro}</p>
            <p style="margin:0 0 24px;">
              <a href="${safeUrl}" style="display:inline-block;padding:14px 20px;border-radius:999px;background:#135bec;color:#ffffff;text-decoration:none;font-weight:700;">
                ${actionLabel}
              </a>
            </p>
            <div style="padding:14px 16px;border-radius:16px;background:#eef4ff;border:1px solid #dbeafe;font-size:13px;color:#576377;">
              <p style="margin:0 0 8px;">Om knappen inte fungerar kan du kopiera länkadressen nedan:</p>
              <p style="margin:0;word-break:break-all;">${safeUrl}</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 28px;font-size:12px;line-height:1.6;color:#6b7280;">
            <p style="margin:0 0 8px;">${expiresText}</p>
            <p style="margin:0;">Detta mejl skickades automatiskt från ${escapeHtml(publicInstance().name)}.</p>
          </td>
        </tr>
      </table>
    </div>
  `.trim();

  const text = [
    publicInstance().name,
    "",
    input.heading,
    "",
    input.intro,
    "",
    input.outro,
    "",
    `${input.actionLabel}: ${input.actionUrl}`,
    "",
    input.expiresText,
  ].join("\n");

  return { html, text };
}

export function buildPasswordResetEmail(input: {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}) {
  return renderBaseTemplate({
    heading: "Återställ lösenord",
    intro: `Hej ${input.name}, du har begärt att få sätta ett nytt lösenord för ditt konto.`,
    outro: "Om du inte gjorde begaran kan du ignorera detta meddelande.",
    actionLabel: "Sätt nytt lösenord",
    actionUrl: input.resetUrl,
    expiresText: `Länken är giltig i ${input.expiresInMinutes} minuter.`,
  });
}

export function buildEmailVerificationEmail(input: {
  name: string;
  verifyUrl: string;
  expiresInHours: number;
}) {
  return renderBaseTemplate({
    heading: "Verifiera din e-post",
    intro: `Hej ${input.name}, bekräfta din e-postadress för att få tillgång till ${publicInstance().name}.`,
    outro: "När adressen är verifierad kan du fortsätta till den skyddade dashboarden.",
    actionLabel: "Verifiera e-post",
    actionUrl: input.verifyUrl,
    expiresText: `Länken är giltig i ${input.expiresInHours} timmar.`,
  });
}

export function buildOrganizationInvitationEmail(input: {
  name: string;
  organizationName: string;
  inviteUrl: string;
  expiresInHours: number;
}) {
  return renderBaseTemplate({
    heading: `Inbjudan till ${publicInstance().name}`,
    intro: `Hej ${input.name}, du har blivit inbjuden till ${input.organizationName} i ${publicInstance().name}.`,
    outro:
      "Följ länken för att verifiera din e-postadress och aktivera medlemskapet.",
    actionLabel: "Granska inbjudan",
    actionUrl: input.inviteUrl,
    expiresText: `Länken är giltig i ${input.expiresInHours} timmar och kan bara användas en gång.`,
  });
}

/** A round to do today (Daniel 2026-09-30): what, where and a link to Driftronder – no answers or customer data beyond the place. */
export function buildRoundReminderEmail(input: { organizationName: string; roundTitle: string; day: string; place: string; roundsUrl: string }) {
  return renderBaseTemplate({
    heading: `Rond idag: ${input.roundTitle}`,
    intro: `${input.organizationName}: ronden ”${input.roundTitle}”${input.place ? ` på ${input.place}` : ""} ska göras idag, ${input.day}.`,
    outro: `Starta ronden under Driftronder i ${publicInstance().name}. Påminnelsen skickas en gång per tillfälle.`,
    actionLabel: "Öppna Driftronder",
    actionUrl: input.roundsUrl,
    expiresText: "Du får påminnelsen eftersom du är ansvarig för ronden, eller administratör när ingen ansvarig är vald.",
  });
}

export function buildBillingNoticeEmail(input: {
  organizationName: string;
  title: string;
  message: string;
  billingUrl: string;
}) {
  return renderBaseTemplate({
    heading: input.title,
    intro: `${input.organizationName}: ${input.message}`,
    outro: "Logga in för att se aktuell betalningsstatus. Svara inte med betalningsuppgifter via e-post.",
    actionLabel: "Visa betalningsstatus",
    actionUrl: input.billingUrl,
    expiresText: "Meddelandet visar den status som var registrerad när utskicket skapades.",
  });
}
