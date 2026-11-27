import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Startläge (2026-11-20, docs/beslut/local-cloud-och-hwf.md): a new company starts in Cloud, in every installation. The
// decision is read from the source files, since the registration module itself needs the database.
const text = (file: string) => readFileSync(file, "utf8");

test("a new company starts in Cloud: no Local start anywhere", () => {
  const registration = text("lib/auth/registration.ts");
  assert.match(registration, /export const registrationStorageMode = async \(\) => "HINTEK_CLOUD" as const;/);
  assert.doesNotMatch(registration, /localStartOn|"LOCAL"/);
  // ee/ is absent in the core-without-ee gate and in Community; its files are checked when they are there.
  for (const file of ["lib/extensions/types.ts", "lib/extensions/none/server.ts", "ee/server.ts"].filter(existsSync)) assert.doesNotMatch(text(file), /localStartOn/, file);
  if (existsSync("ee/ui/pricing-administration.tsx")) assert.doesNotMatch(text("ee/ui/pricing-administration.tsx"), /Nya konton kan börja i Local/);
  const form = text("features/auth/components/register-form.tsx");
  assert.doesNotMatch(form, /localStart|register-local-note/);
  assert.doesNotMatch(text("app/(public)/register/page.tsx"), /localStart|registrationStorageMode/);
});
