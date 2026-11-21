import assert from "node:assert/strict";
import { test } from "node:test";
import { controlPeriod, controlScope, onSiteViewAuditDetail, ON_SITE_VIEW_DENIED, ON_SITE_VIEW_NO_EXPORT, ON_SITE_VIEW_TODAY_ONLY, StaffRegisterError } from "../lib/staff-register/model";

// "Visa för Skatteverket" (2026-10-10): a person checked in on the site sees today's Kontrollvy of that site only.
const today = controlPeriod(null, null, "2026-10-10");
const yesterday = controlPeriod("2026-10-09", "2026-10-09", "2026-10-10");
const week = controlPeriod("2026-10-04", "2026-10-10", "2026-10-10");
const refused = (message: string) => (error: unknown) => error instanceof StaffRegisterError && error.status === 403 && error.message === message;

test("the Kontrollvy right keeps the full view, any period and the export", () => {
  assert.equal(controlScope({ control: true, checkedInHere: false, exporting: false, ...week, today }), "full");
  assert.equal(controlScope({ control: true, checkedInHere: true, exporting: true, ...yesterday, today }), "full");
});

test("a checked-in person gets today only", () => {
  assert.equal(controlScope({ control: false, checkedInHere: true, exporting: false, ...today, today }), "today");
  assert.throws(() => controlScope({ control: false, checkedInHere: true, exporting: false, ...yesterday, today }), refused(ON_SITE_VIEW_TODAY_ONLY));
  assert.throws(() => controlScope({ control: false, checkedInHere: true, exporting: false, ...week, today }), refused(ON_SITE_VIEW_TODAY_ONLY));
});

test("never the export, and nothing when not checked in", () => {
  assert.throws(() => controlScope({ control: false, checkedInHere: true, exporting: true, ...today, today }), refused(ON_SITE_VIEW_NO_EXPORT));
  assert.throws(() => controlScope({ control: false, checkedInHere: false, exporting: false, ...today, today }), refused(ON_SITE_VIEW_DENIED));
  assert.throws(() => controlScope({ control: false, checkedInHere: false, exporting: true, ...today, today }), refused(ON_SITE_VIEW_DENIED));
});

test("the history line has the site, the day and the count – never names or numbers", () => {
  assert.equal(onSiteViewAuditDetail({ siteId: "QA-1", day: "2026-10-10", rows: 1 }),
    "Personalliggarens kontrollvy visades på plats (Visa för Skatteverket) av en incheckad person: byggarbetsplats QA-1, 2026-10-10, 1 rad.");
  assert.match(onSiteViewAuditDetail({ siteId: "", day: "2026-10-10", rows: 3 }), /utan id-nummer, 2026-10-10, 3 rader\.$/);
});
