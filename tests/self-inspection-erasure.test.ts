import assert from "node:assert/strict";
import { test } from "node:test";
import { changeFingerprint, contentSchema, redactPersonInContent, type ProgramContent } from "../lib/self-inspection/model";

// Egenkontroll och GDPR (2026-10-10): an approved version keeps an erased person's name and role, nothing else.
const competence = (personId: string, name: string, assessment: string) => ({ personId, name, workTypes: [], scope: "Service", assessment, assessedAt: "2026-01-02", limitations: "Ej högspänning", supervised: false });
const content: ProgramContent = contentSchema.parse({
  title: "Program", templateVersion: "qa", activityTypes: [], worksOnOthersInstallations: true, registrationCheckedAt: null, sections: [],
  roles: [
    { key: "ere", name: "Elinstallatör för regelefterlevnad", description: "", duties: "", isEre: true, capabilities: ["approve"], level: 3,
      members: [{ personId: "anna", name: "", authorizationLevel: "A", registered: true }, { personId: "bo", name: "Bo", authorizationLevel: "B", registered: false }] },
    { key: "tech", name: "Montör", description: "", duties: "", isEre: false, capabilities: ["perform"], level: 1, members: [{ personId: "anna", name: "", authorizationLevel: "A", registered: false }] },
  ],
  people: [competence("anna", "", "Behörighet A sedan 2010"), competence("bo", "Bo", "Lärling")],
});

test("the erased person keeps name and roles; authorisation level and competence go", () => {
  const redacted = redactPersonInContent(content, "anna", "Anna Andersson", "2026-10-10")!;
  assert.ok(redacted);
  for (const role of redacted.roles) {
    const anna = role.members.find((member) => member.personId === "anna")!;
    assert.equal(anna.name, "Anna Andersson", "the name is frozen when the version had none");
    assert.equal(anna.authorizationLevel, "");
  }
  assert.equal(redacted.roles[0]!.members[0]!.registered, true, "the ERE registration is a fact about the role");
  assert.deepEqual(redacted.roles[0]!.members[1], content.roles[0]!.members[1], "others untouched");
  assert.deepEqual(redacted.people?.map((person) => person.personId), ["bo"]);
  assert.ok(!JSON.stringify(redacted).includes("Behörighet A"));
  assert.deepEqual(redacted.redactions, [{ personId: "anna", at: "2026-10-10" }]);
  assert.equal(contentSchema.safeParse(redacted).success, true, "still a valid version content");
});

test("a frozen name is kept as frozen; a second erasure changes nothing; a stranger is not touched", () => {
  const frozen = { ...content, roles: content.roles.map((role) => ({ ...role, members: role.members.map((member) => ({ ...member, name: member.name || "Anna vid fastställandet" })) })) };
  const once = redactPersonInContent(frozen, "anna", "Borttagen användare", "2026-10-10")!;
  assert.equal(once.roles[0]!.members[0]!.name, "Anna vid fastställandet");
  assert.equal(redactPersonInContent(once, "anna", "Borttagen användare", "2026-10-11"), null);
  assert.equal(redactPersonInContent(content, "someone-else", "X", "2026-10-10"), null);
});

test("the last person's competence removed leaves no empty list, and the change check ignores the marker", async () => {
  const onlyAnna = { ...content, people: [content.people![0]!] };
  const redacted = redactPersonInContent(onlyAnna, "anna", "Anna", "2026-10-10")!;
  assert.equal("people" in redacted, false);
  const plain = { ...redacted };
  delete plain.redactions;
  assert.equal(await changeFingerprint(redacted), await changeFingerprint(plain));
});
