import { test } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { sendSystemEmail } from "../lib/mail/mailer";
import { buildOrganizationInvitationEmail } from "../lib/mail/templates";
import { invitationActiveKey } from "../lib/auth/invitations";
test("mail transport composes one recipient and preserves Swedish content without delivering mail", async () => {
  global.workflowTransporter = nodemailer.createTransport({
    jsonTransport: true,
  });
  const result = await sendSystemEmail({
    to: "qa@example.test",
    subject: "KFID · Åäö",
    html: "<p>Kontrollen är färdig.</p>",
    text: "Kontrollen är färdig.",
  });
  const message = JSON.parse(result.message.toString());
  assert.equal(message.to.length, 1);
  assert.equal(message.to[0].address, "qa@example.test");
  assert.equal(message.subject, "KFID · Åäö");
  assert.equal(message.text, "Kontrollen är färdig.");
  global.workflowTransporter = undefined;
});

test("invitation mail escapes tenant-controlled HTML and active keys normalize email", () => {
  const template = buildOrganizationInvitationEmail({
    name: '<script>alert("name")</script>',
    organizationName: "El & Kraft <AB>",
    inviteUrl: "https://workflow.hintek.se/invite?token=test&next=1",
    expiresInHours: 72,
  });
  assert.doesNotMatch(template.html, /<script>/);
  assert.match(template.html, /&lt;script&gt;/);
  assert.match(template.html, /El &amp; Kraft &lt;AB&gt;/);
  assert.match(template.html, /token=test&amp;next=1/);
  assert.equal(
    invitationActiveKey("org-1", " Person@Example.COM "),
    "org-1:person@example.com",
  );
});
