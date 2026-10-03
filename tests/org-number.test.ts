import assert from "node:assert/strict";
import test from "node:test";
import { formatOrgNumber, normalizeOrgNumber } from "../lib/kfid/org-number";
import { registrationAllowsEmail } from "../lib/auth/registration-gate";

test("an organisation number is ten digits with a Luhn check digit; dashes and the century prefix are accepted", () => {
  assert.equal(normalizeOrgNumber("556012-5790"), "5560125790");
  assert.equal(normalizeOrgNumber("16556012-5790"), "5560125790");
  assert.equal(normalizeOrgNumber("556012 5790"), "5560125790");
  assert.equal(normalizeOrgNumber("556012-5791"), null, "a wrong check digit");
  assert.equal(normalizeOrgNumber("55601257"), null, "too short");
  assert.equal(formatOrgNumber("5560125790"), "556012-5790");
});

test("on a loopback test instance only synthetic addresses may register; on the real server any address", () => {
  assert.equal(registrationAllowsEmail("someone@example.invalid", "http://localhost:3001"), true);
  assert.equal(registrationAllowsEmail("someone@gmail.com", "http://localhost:3001"), false);
  assert.equal(registrationAllowsEmail("someone@gmail.com", "https://workflow.example.com"), true);
});
