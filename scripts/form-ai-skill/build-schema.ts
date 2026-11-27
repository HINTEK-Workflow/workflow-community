/**
 * Writes skills/hintek-workflow-form-builder/references/schema.json from the import's own zod schemas
 * (lib/kfid/form-ai-skill.ts). Run after a change of the form file format, together with a new package version:
 *
 *   npx tsx scripts/form-ai-skill/build-schema.ts          write the file
 *   npx tsx scripts/form-ai-skill/build-schema.ts --check  only say whether it is current (exit code 1 if not)
 *
 * tests/form-ai-skill.test.ts fails while the committed file differs from the generated one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FORM_AI_SKILL_DIR, FORM_AI_SKILL_SCHEMA_SHA256, formAiSkillSchemaFingerprint, formAiSkillSchemaText } from "@/lib/kfid/form-ai-skill";

const target = path.join(process.cwd(), FORM_AI_SKILL_DIR, "references", "schema.json");
const text = formAiSkillSchemaText();
const fingerprint = formAiSkillSchemaFingerprint();
let current = "";
try { current = readFileSync(target, "utf8"); } catch { current = ""; }
if (fingerprint !== FORM_AI_SKILL_SCHEMA_SHA256) {
  process.stdout.write(`Importformatet har ändrats. Uppdatera SKILL.md och referenserna, höj FORM_AI_SKILL_VERSION och skriv in FORM_AI_SKILL_SCHEMA_SHA256 = "${fingerprint}" i lib/kfid/form-ai-skill.ts.\n`);
}
if (process.argv.includes("--check")) {
  const ok = current === text && fingerprint === FORM_AI_SKILL_SCHEMA_SHA256;
  process.stdout.write(ok ? "schema.json är aktuell.\n" : "schema.json är inte aktuell.\n");
  process.exitCode = ok ? 0 : 1;
} else if (current === text) process.stdout.write("schema.json är redan aktuell.\n");
else { writeFileSync(target, text); process.stdout.write(`Skrev ${path.relative(process.cwd(), target)}.\n`); }
