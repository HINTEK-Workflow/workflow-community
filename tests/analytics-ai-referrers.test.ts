import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { AI_SERVICES, aiServiceOf, cleanUtmSource, isLandingKey, kindLabel, landingKeyLabel, validCounter } from "../lib/analytics/catalog";
import { AI_ROBOTS, isAutomatedVisitor } from "../lib/analytics/bots";
import { buildComparedReport, buildReport, countersCsv, periodTotals } from "../lib/analytics/report";
import { siteAnalyticsView } from "../lib/tools/marketing-view";

// Från AI-tjänster (Growth Engine paket 2, 2026-11-28): visits from AI assistants as a source of their own in Beteendeanalys.

test("the AI services are recognised by the referring host name, its subdomains too", () => {
  const cases: [string, string][] = [
    ["chatgpt.com", "ai:chatgpt"], ["chat.openai.com", "ai:chatgpt"], ["openai.com", "ai:chatgpt"], ["www.chatgpt.com", "ai:chatgpt"],
    ["perplexity.ai", "ai:perplexity"], ["www.perplexity.ai", "ai:perplexity"],
    ["copilot.microsoft.com", "ai:copilot"], ["copilot.cloud.microsoft", "ai:copilot"], ["m365.cloud.microsoft", "ai:copilot"], ["edgeservices.bing.com", "ai:copilot"],
    ["gemini.google.com", "ai:gemini"], ["claude.ai", "ai:claude"], ["chat.mistral.ai", "ai:mistral"], ["chat.deepseek.com", "ai:deepseek"],
    ["meta.ai", "ai:meta"], ["www.meta.ai", "ai:meta"], ["grok.com", "ai:grok"], ["CHATGPT.COM.", "ai:chatgpt"],
  ];
  for (const [host, key] of cases) assert.equal(aiServiceOf(host), key, host);
  for (const host of ["google.com", "www.google.com", "bing.com", "microsoft.com", "facebook.com", "notchatgpt.com", "chatgpt.com.example.org", "mistral.ai", "", null, undefined])
    assert.equal(aiServiceOf(host), null, String(host));
  assert.equal(AI_SERVICES.length, 9);
});

test("utm_source counts too (ChatGPT writes utm_source=chatgpt.com), but never Meta's ads' plain \"meta\"", () => {
  assert.equal(aiServiceOf("", "chatgpt.com"), "ai:chatgpt");
  assert.equal(aiServiceOf(undefined, "ChatGPT"), "ai:chatgpt");
  assert.equal(aiServiceOf("", "perplexity"), "ai:perplexity");
  assert.equal(aiServiceOf("", "copilot.microsoft.com"), "ai:copilot");
  assert.equal(aiServiceOf("", "meta.ai"), "ai:meta");
  assert.equal(aiServiceOf("", "meta"), null, "utm_source=meta is Meta's ads");
  for (const utm of ["facebook", "newsletter", "linkedin", "google", ""]) assert.equal(aiServiceOf("", utm), null, utm);
  assert.equal(aiServiceOf("google.com", "chatgpt.com"), "ai:chatgpt", "the link's own source decides when the referrer is another site");
});

test("utm_source is cleaned: lower case, only a–z, 0–9, dot and hyphen, at most 100 characters", () => {
  assert.equal(cleanUtmSource("ChatGPT.com"), "chatgpt.com");
  assert.equal(cleanUtmSource("<script>x</script>"), "scriptxscript");
  assert.equal(cleanUtmSource("a b_c/d?e=f"), "abcdef");
  assert.equal(cleanUtmSource("x".repeat(300)).length, 100);
  assert.equal(cleanUtmSource(null), "");
});

test("the keys are a closed list with the services' own names", () => {
  for (const service of AI_SERVICES) {
    assert.ok(isLandingKey(`ai:${service.key}`), service.key);
    assert.ok(validCounter("landing", `ai:${service.key}`), service.key);
    assert.equal(landingKeyLabel(`ai:${service.key}`), service.label);
  }
  for (const bad of ["ai:", "ai:other", "ai:chatgpt.com", "ai:chatgpt:x"]) assert.equal(isLandingKey(bad), false, bad);
  assert.equal(kindLabel("landing", "ai:claude"), "Claude");
});

test("robots are not visits: the AI services' own robots too, also those without bot in their name", () => {
  for (const agent of [
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    "Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
    "Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
    "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)", "OAI-SearchBot/1.0", "ClaudeBot/1.0", "PerplexityBot/1.0", "CCBot/2.0",
    "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider)", "Amazonbot/0.1",
  ]) assert.equal(isAutomatedVisitor(agent), true, agent);
  assert.equal(isAutomatedVisitor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"), false);
  assert.equal(isAutomatedVisitor("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"), false);
  for (const name of ["gptbot", "oai-searchbot", "chatgpt-user", "claudebot", "claude-user", "perplexitybot", "perplexity-user", "ccbot", "bytespider", "amazonbot", "meta-externalagent"])
    assert.ok((AI_ROBOTS as readonly string[]).includes(name), name);
  // The beacon's route asks before counting a page view, so an AI robot that runs the page's script counts nothing. The route
  // lives in ee/, so the core without ee/ skips this check.
  if (existsSync("ee/api/analytics-event.ts")) {
    const route = readFileSync("ee/api/analytics-event.ts", "utf8");
    assert.match(route, /else if \(!isAutomatedVisitor\(request\.headers\.get\("user-agent"\)\)\) \{\s*if \(event\.type === "landing-click"\)/);
  }
});

test("the report: Från AI-tjänster per service and per week; they are not extra page views", () => {
  const rows = [
    { day: "2026-11-23", kind: "landing", key: "page:start", count: 10 },
    { day: "2026-11-23", kind: "landing", key: "ai:chatgpt", count: 3 },
    { day: "2026-11-24", kind: "landing", key: "ai:perplexity", count: 1 },
    { day: "2026-11-30", kind: "landing", key: "ai:chatgpt", count: 2 },
    { day: "2026-11-30", kind: "landing", key: "ai:claude", count: 4 },
    // A key outside the list (an old or a tampered row) is not shown as a service.
    { day: "2026-11-30", kind: "landing", key: "ai:unknown", count: 9 },
  ];
  const report = buildReport(rows, "2026-11-23", "2026-12-06");
  assert.equal(report.landing.views, 10, "only page loads are views");
  assert.equal(periodTotals(report).landingViews, 10);
  const ai = report.landing.aiServices;
  assert.equal(ai.total, 10);
  assert.deepEqual(ai.services.map((row) => [row.key, row.label, row.count]), [["ai:chatgpt", "ChatGPT", 5], ["ai:claude", "Claude", 4], ["ai:perplexity", "Perplexity", 1]]);
  assert.deepEqual(ai.weekly.map((week) => [week.date, week.label, week.total, week.counts]), [
    ["2026-11-23", "v. 48", 4, { "ai:chatgpt": 3, "ai:perplexity": 1 }],
    ["2026-11-30", "v. 49", 6, { "ai:chatgpt": 2, "ai:claude": 4 }],
  ]);
  assert.equal(buildReport([], "2026-11-23", "2026-11-29").landing.aiServices.total, 0);
  assert.match(countersCsv(rows.slice(1, 2)), /"ai:chatgpt";"ChatGPT";"3"/);
});

test("get_site_analytics gives Growth Engine the figures as website.aiServices", () => {
  const rows = [{ day: "2026-11-28", kind: "landing", key: "ai:gemini", count: 2 }];
  const report = buildComparedReport(rows, "2026-11-22", "2026-11-28");
  const view = siteAnalyticsView(report, periodTotals(report));
  assert.equal(view.website.aiServices.total, 2);
  assert.equal(view.website.aiServices.services[0].label, "Gemini");
});
