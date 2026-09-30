import assert from "node:assert/strict";
import { test } from "node:test";
import { canAccessTest, isAllowedPrivateEmail, localRoleQaEnabled, localRoleQaSessionCookie, QA_ROLE_EMAILS } from "../lib/auth/access";

test("synthetic identities require explicit loopback QA and test database", () => {
  const saved = {
    flag: process.env.KFID_LOCAL_ROLE_QA,
    app: process.env.APP_URL,
    database: process.env.DATABASE_URL,
    delivery: process.env.INVITATION_DELIVERY_ENABLED,
    role: process.env.KFID_LOCAL_ROLE_QA_ROLE,
  };
  try {
    process.env.KFID_LOCAL_ROLE_QA = "true";
    process.env.APP_URL = "http://localhost:3001";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/kfid_v3_test";
    process.env.INVITATION_DELIVERY_ENABLED = "false";
    assert.equal(localRoleQaEnabled(), true);
    process.env.KFID_LOCAL_ROLE_QA_ROLE = "owner";
    assert.equal(localRoleQaSessionCookie(), "next-auth.qa-owner.session-token");
    process.env.KFID_LOCAL_ROLE_QA_ROLE = "worker";
    assert.equal(localRoleQaSessionCookie(), "next-auth.qa-worker.session-token");
    process.env.KFID_LOCAL_ROLE_QA_ROLE = "superadmin";
    assert.equal(localRoleQaSessionCookie(), "next-auth.qa-superadmin.session-token");
    assert.equal(canAccessTest({ email: QA_ROLE_EMAILS.superadmin, isActive: true }), true);
    process.env.KFID_LOCAL_ROLE_QA_ROLE = "admin";
    assert.equal(localRoleQaSessionCookie(), null, "only the three named roles exist");
    assert.equal(canAccessTest({ email: QA_ROLE_EMAILS.owner, isActive: true }), true);
    assert.equal(canAccessTest({ email: QA_ROLE_EMAILS.worker, isActive: false }), false);
    assert.equal(isAllowedPrivateEmail("unrelated@example.test"), false);
    process.env.APP_URL = "https://workflow.hintek.se";
    assert.equal(localRoleQaEnabled(), false);
    process.env.APP_URL = "http://localhost:3001";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/workflow";
    assert.equal(localRoleQaEnabled(), false);
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/kfid_v3_test";
    process.env.INVITATION_DELIVERY_ENABLED = "true";
    assert.equal(localRoleQaEnabled(), false);
    assert.equal(canAccessTest({ email: QA_ROLE_EMAILS.superadmin, isActive: true }), false, "the QA superadmin is refused outside loopback QA");
  } finally {
    for (const [key, value] of [
      ["KFID_LOCAL_ROLE_QA", saved.flag], ["APP_URL", saved.app],
      ["DATABASE_URL", saved.database], ["INVITATION_DELIVERY_ENABLED", saved.delivery],
      ["KFID_LOCAL_ROLE_QA_ROLE", saved.role],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
