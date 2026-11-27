import assert from "node:assert/strict";
import test from "node:test";
import { safeLocalPath } from "../lib/security/safe-return";
import { safeReturnTo } from "../lib/workflow/navigation";
import { returnOf } from "../lib/workflow/return-link";

// Säkerhetsgranskning 2026-11-20, M1: `/login?returnTo=/%09/ond.example` became `//ond.example` in the browser.
const HOSTILE = [
  "/%09/ond.example", "/\t/ond.example", "/\tond", "/\n/ond", "/\r\n/ond", "/\u0000/ond", "/\u001F/ond", "/\u007F/ond",
  "//ond", "//ond.example/?view=stats", "/\\ond", "\\\\ond", "/\\/ond", "https://ond", "http://ond.example/", "javascript:alert(1)",
  "JaVaScRiPt:alert(1)", "data:text/html,x", "/%2F%2Fond", "/%2f/ond", "/%5Cond", "/%0A/ond", " //ond", "ond.example", "", "%", "/%E0%A4%A",
];

test("safe return: only a path on Workflow's own address is followed", () => {
  for (const value of ["/", "/login/klar", "/?view=stats", "/?view=customers&customerId=c1&q=a%20b", "/p/abc123", "/design-lab/operator", "/a//b"]) {
    assert.equal(safeLocalPath(value), value, value);
  }
  for (const bad of HOSTILE) assert.equal(safeLocalPath(bad), null, JSON.stringify(bad));
  assert.equal(safeLocalPath(null), null);
  assert.equal(safeLocalPath(undefined), null);
  assert.equal(safeLocalPath(`/?q=${"a".repeat(3000)}`), null, "an overlong address is refused");
});

test("safe return: the way back from sub-pages reads the same rule", () => {
  assert.equal(safeReturnTo("/?view=workflow_task&taskId=t1"), "/?view=workflow_task&taskId=t1");
  for (const bad of [...HOSTILE, "/?\u0000x", "/?view=x\u0007"]) assert.equal(safeReturnTo(bad), null, JSON.stringify(bad));
  assert.equal(returnOf("/?view=new_task&returnTo=%2F%09%2Fond.example"), null);
});
