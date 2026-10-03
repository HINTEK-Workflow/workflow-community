import assert from "node:assert/strict";
import test from "node:test";
import { classifyProviderEvalFailure } from "../lib/ai/provider-eval-errors";

test("provider eval exposes a safe actionable EU geography blocker", () => {
  assert.deepEqual(
    classifyProviderEvalFailure({
      status: 401,
      message: "This endpoint is only accessible by projects with geography restrictions enabled.",
      request_id: "synthetic-request-id",
    }),
    {
      status: 409,
      code: "EU_GEOGRAPHY_NOT_ENABLED",
      message:
        "OpenAI-projektet saknar aktiverad EU geography restriction. Aktivera EU Data Residency/Regional Processing för projektet innan evalen körs igen.",
    },
  );
});

test("provider eval sanitizes authentication, access, capacity and outage failures", () => {
  const providerShape = { headers: { "content-type": "application/json" } };
  assert.equal(
    classifyProviderEvalFailure({ ...providerShape, status: 401, message: "secret detail" })?.code,
    "PROVIDER_AUTHENTICATION_FAILED",
  );
  assert.equal(
    classifyProviderEvalFailure({ ...providerShape, status: 403, message: "secret detail" })?.code,
    "PROVIDER_ACCESS_MISSING",
  );
  assert.equal(
    classifyProviderEvalFailure({ ...providerShape, status: 429, message: "secret detail" })?.code,
    "PROVIDER_CAPACITY_OR_BILLING",
  );
  assert.equal(
    classifyProviderEvalFailure({ ...providerShape, status: 503, message: "secret detail" })?.code,
    "PROVIDER_UNAVAILABLE",
  );
});

test("provider eval does not misclassify application API errors", () => {
  assert.equal(
    classifyProviderEvalFailure({ status: 401, message: "Authentication required" }),
    null,
  );
  assert.equal(classifyProviderEvalFailure(new Error("local failure")), null);
});
