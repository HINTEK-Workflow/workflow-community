import type { DraftProgram, SelfInspectionDocument } from "./model";
import { isOldTemplateVersion, OLD_TEMPLATE_ROLES, oldTemplateSections } from "./template-2026-10-07";
import { SELF_INSPECTION_TEMPLATE_VERSION, TEMPLATE_ROLES, TEMPLATE_SECTIONS } from "./template";

/**
 * Moving an untouched copy of an earlier template edition to the current one (2026-10-08, next-wave 6: the older
 * edition must not survive as a company's current programme). A copy is untouched when its templateVersion is an earlier
 * edition, nothing has been approved and every section is still the earlier edition's text: the same keys, no section of
 * the company's own, every body equal (whitespace at the ends aside). Anything else is the company's work and is left as it
 * is, templateVersion included – the company keeps its edition and only new programmes get the new one.
 *
 * The upgrade keeps ids where it can (a section with the same key keeps its id, every role keeps its id, members and
 * level), writes the new texts, adds the new sections and removes the earlier edition's sections that no longer exist.
 * Role texts are replaced only where they still read as the earlier edition wrote them. Nothing is approved: the first
 * Fastställ after the upgrade is version 1, as before it.
 *
 * Cloud runs the same rule as SQL (scripts/self-inspection/template-release-migration.ts, generated into a Prisma
 * migration, so it runs in the ordinary deploy step); Local runs this when a file is opened.
 */
const same = (a: string, b: string) => a.trim() === b.trim();

export type UpgradeVerdict = { upgrade: true } | { upgrade: false; reason: "current" | "unknown-edition" | "approved" | "edited" };

export function templateUpgradeVerdict(program: Pick<DraftProgram, "templateVersion" | "sections">, versionsCount: number): UpgradeVerdict {
  if (program.templateVersion === SELF_INSPECTION_TEMPLATE_VERSION) return { upgrade: false, reason: "current" };
  if (!isOldTemplateVersion(program.templateVersion)) return { upgrade: false, reason: "unknown-edition" };
  if (versionsCount > 0) return { upgrade: false, reason: "approved" };
  const original = oldTemplateSections(program.templateVersion);
  if (program.sections.length !== original.length) return { upgrade: false, reason: "edited" };
  for (const section of program.sections) {
    const was = original.find((item) => item.key === section.key);
    if (!section.key || !was || !same(was.body, section.body)) return { upgrade: false, reason: "edited" };
  }
  return { upgrade: true };
}

/** The programme on the current edition; the caller has checked the verdict. Returns the same object when nothing is to do. */
export function upgradeProgramToCurrentTemplate(program: DraftProgram, input: { now: string; newId: () => string }): DraftProgram {
  if (!templateUpgradeVerdict(program, 0).upgrade) return program;
  const byKey = new Map(program.sections.map((section) => [section.key, section]));
  const oldRoles = new Map(OLD_TEMPLATE_ROLES.map((role) => [role.key, role]));
  return {
    ...program,
    templateVersion: SELF_INSPECTION_TEMPLATE_VERSION,
    revision: program.revision + 1,
    updatedAt: input.now,
    sections: TEMPLATE_SECTIONS.map((section, sortOrder) => ({ id: byKey.get(section.key)?.id ?? input.newId(), ...section, sortOrder })),
    roles: program.roles.map((role) => {
      const was = oldRoles.get(role.key);
      const next = TEMPLATE_ROLES.find((item) => item.key === role.key);
      if (!was || !next || !same(was.name, role.name) || !same(was.description, role.description) || !same(was.duties, role.duties)) return role;
      return { ...role, name: next.name, description: next.description, duties: next.duties };
    }),
  };
}

/** Local: the file's programme moved to the current edition when it is an untouched copy of an earlier one. */
export function upgradeLegacySelfInspectionTemplate(doc: SelfInspectionDocument, input: { now: string; newId: () => string }): SelfInspectionDocument {
  if (!doc.program || !templateUpgradeVerdict(doc.program, doc.versions.length).upgrade) return doc;
  return { ...doc, program: upgradeProgramToCurrentTemplate(doc.program, input) };
}
