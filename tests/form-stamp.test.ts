// Formulärets tidsstämpel (2026-11-13, made general for Rapportera fel eller förslag): the purpose is part of the signature,
// so one form's stamp never passes another's, and the newsletter keeps its own behaviour. The bell's notice of a report is
// built only from the number, the kind and GitHub's address.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFormStamp, issueFormStamp, MIN_FILL_MS } from "../lib/security/form-stamp";
import { checkStamp, issueStamp } from "../lib/mail/newsletter-subscribers";
import { issueReportDetail, issueReportNotice, parseIssueReport } from "../lib/workflow/issue-report-notice";
import { noticeKindsOf, availableNoticeKinds } from "../lib/workflow/notice-channels";
import { RATE_RULES } from "../lib/security/rate-limit";

test("a stamp passes only the form it was issued for", () => {
  const now = Date.now();
  const report = issueFormStamp("issue-report-stamp", now);
  assert.equal(checkFormStamp("issue-report-stamp", report, now + MIN_FILL_MS), "ok");
  assert.equal(checkFormStamp("issue-report-stamp", report, now + 100), "fast");
  assert.equal(checkFormStamp("newsletter-stamp", report, now + MIN_FILL_MS), "invalid", "another form's stamp");
  assert.equal(checkStamp(report, now + MIN_FILL_MS), "invalid", "the newsletter refuses a report's stamp");
  const newsletter = issueStamp(now);
  assert.equal(checkFormStamp("newsletter-stamp", newsletter, now + MIN_FILL_MS), "ok", "the newsletter's purpose is unchanged");
  assert.equal(checkFormStamp("issue-report-stamp", newsletter, now + MIN_FILL_MS), "invalid");
});

test("the report limits: five an hour per address, ten a day per person, fifty a day in all", () => {
  assert.deepEqual([RATE_RULES.reportIp.limit, RATE_RULES.reportIp.windowSeconds], [5, 3600]);
  assert.deepEqual([RATE_RULES.reportUser.limit, RATE_RULES.reportUser.windowSeconds], [10, 86_400]);
  assert.deepEqual([RATE_RULES.reportDay.limit, RATE_RULES.reportDay.windowSeconds], [50, 86_400]);
});

test("a report's notice: the number, the kind and GitHub's address only; anything else is no notice", () => {
  const detail = issueReportDetail({ number: 12, kind: "fel", url: "https://github.com/owner/repo/issues/12" });
  assert.deepEqual(parseIssueReport(detail), { number: 12, kind: "fel", url: "https://github.com/owner/repo/issues/12" });
  const notice = issueReportNotice({ id: "e1", detail, createdAt: new Date("2026-11-13T10:00:00Z") })!;
  assert.equal(notice.title, "Ny felrapport #12");
  assert.equal(notice.kind, "ISSUE_REPORT");
  assert.equal(notice.href, "https://github.com/owner/repo/issues/12");
  assert.equal(notice.dueDate, "2026-11-13");
  assert.equal(issueReportNotice({ id: "e2", detail: issueReportDetail({ number: 3, kind: "forbattring", url: "https://github.com/o/r/issues/3" }), createdAt: new Date() })!.title, "Nytt förslag #3");
  for (const bad of ["#12 fel https://evil.example/x", "#12 annat https://github.com/o/r/issues/12", "12 fel https://github.com/o/r/issues/12", "#12 fel javascript:alert(1)"])
    assert.equal(parseIssueReport(bad), null, bad);
  assert.deepEqual(noticeKindsOf(notice), ["ISSUE_REPORTS"]);
  assert.ok(availableNoticeKinds({ superadmin: true }).some((kind) => kind.key === "ISSUE_REPORTS"));
  assert.ok(!availableNoticeKinds({ superadmin: false }).some((kind) => kind.key === "ISSUE_REPORTS"), "only the product owner may choose it");
});
