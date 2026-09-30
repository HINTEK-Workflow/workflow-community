import { test } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { deliverSystemEmail } from "../lib/mail/mailer";
import { buildOrganizationInvitationEmail } from "../lib/mail/templates";
import { invitationActiveKey } from "../lib/auth/invitations";
test("mail transport composes one recipient and preserves Swedish content without delivering mail", async () => {
  const transporter = nodemailer.createTransport({ jsonTransport: true });
  const result = await deliverSystemEmail(transporter, { name: "Workflow", address: "noreply@example.test" }, {
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
  assert.equal(message.from.address, "noreply@example.test");
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
