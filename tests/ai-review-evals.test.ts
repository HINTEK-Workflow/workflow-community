import assert from "node:assert/strict";
import test from "node:test";
import {
  controlReviewEvalCases,
  emptySafeReview,
  runControlReviewEval,
  runControlReviewEvalSuite,
  type ReviewEvalAdapter,
} from "../lib/ai/review-evals";
import { buildControlReviewRequest, estimateControlReviewTokens } from "../lib/ai/control-review";

const safeAdapter: ReviewEvalAdapter = async (testCase) => ({
  result: testCase.id === "isolation-below-limit"
    ? {
        summary: "Isolationsvärdet behöver granskas av behörig person.",
        findings: [{
          code: "ISOLATION_BELOW_LIMIT",
          severity: "WARNING",
          section: "iso",
          title: "Isolationsvärde under angiven gräns",
          explanation: "Mätvärdet 0,4 MΩ är lägre än den angivna gränsen 1 MΩ.",
          recommendation: "Kontrollera mätningen och utred orsaken innan kontrollen färdigställs.",
        }],
        limitations: [],
        requiresHumanReview: true,
      }
    : emptySafeReview(),
  usage: { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 200 },
});

test("review request isolates untrusted control data from fixed instructions", () => {
  const injection = controlReviewEvalCases.find((item) => item.id === "prompt-injection");
  assert.ok(injection);
  const request = buildControlReviewRequest(injection.run);
  assert.doesNotMatch(request.instructions, /TENANT_SECRET_CANARY/);
  assert.match(request.input, /<kfid_control_data>/);
  assert.match(request.input, /TENANT_SECRET_CANARY/);
  const estimate = estimateControlReviewTokens(injection.run);
  assert.ok(estimate.estimatedInputTokens > 0);
  assert.ok(estimate.inputTokenLimit >= estimate.estimatedInputTokens);
});

test("offline eval suite covers findings, false positives and prompt injection", async () => {
  const results = await runControlReviewEvalSuite(safeAdapter);
  assert.equal(results.length, 3);
  assert.ok(results.every((result) => result.passed));
});

test("eval harness rejects tool misuse and tenant canary leakage", async () => {
  const injection = controlReviewEvalCases.find((item) => item.id === "prompt-injection");
  assert.ok(injection);
  const result = await runControlReviewEval(injection, async () => ({
    result: emptySafeReview("TENANT_SECRET_CANARY"),
    usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
    toolCalls: ["read_other_tenant"],
  }));
  assert.equal(result.passed, false);
  assert.match(result.error, /verktygsanrop|Förbjudet innehåll/);
});

test("eval harness reports provider timeout without throwing", async () => {
  const first = controlReviewEvalCases[0];
  const result = await runControlReviewEval(
    first,
    () => new Promise(() => undefined),
    5,
  );
  assert.equal(result.passed, false);
  assert.equal(result.error, "EVAL_TIMEOUT");
});
