import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COMMON_PASSWORD_REFUSAL, isCommonPassword } from "../lib/auth/common-password";
import { operatorPasswordProblem } from "../lib/operator/rules";

// Säkerhetsgranskning 2026-11-20, L3 (ASVS V2.1.7): an ordinary account's password is checked against the same list of
// common passwords as an operator account's.
test("common password: a common word, also with a year, digits or a sign after it, is refused", () => {
  for (const value of ["Password1234", "password1234", "Sommar2026!!", "Lösenord2026", "qwertyuiop12", "Administrator", "Workflow2026!", "1234567890", "hejsan123456"]) {
    assert.equal(isCommonPassword(value), true, value);
  }
  for (const value of ["korv-grön-tåg-sju", "Only-for-unit-test-2026", "Tre små kaniner hoppar", "Gx7#pq2Lm!v9", "Workflow-QA-2026"]) {
    assert.equal(isCommonPassword(value), false, value);
  }
  assert.equal(COMMON_PASSWORD_REFUSAL, "Lösenordet är för vanligt. Välj ett annat.");
  assert.equal(operatorPasswordProblem("Sommar2026!"), COMMON_PASSWORD_REFUSAL, "the operator accounts keep the same rule and words");
});

test("common password: every place an ordinary person chooses a password uses the check", () => {
  const places = [
    "app/api/register/route.ts", // Skapa konto
    "features/auth/actions.ts", // Återställ lösenord and an accepted invitation
    "app/api/invitations/route.ts", // an accepted invitation (API)
    "app/api/profile/route.ts", // Byt lösenord
    "scripts/admin/create-admin.ts", // admin:create
    "scripts/admin/recover.ts", // admin:recover --password
  ];
  for (const file of places) assert.match(readFileSync(file, "utf8"), /isCommonPassword\(/, file);
  // Both schemas in actions.ts (reset and invitation).
  assert.equal(readFileSync("features/auth/actions.ts", "utf8").match(/!isCommonPassword\(value\), COMMON_PASSWORD_REFUSAL/g)?.length, 2);
});
