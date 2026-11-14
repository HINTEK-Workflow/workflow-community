import assert from "node:assert/strict";
import { test } from "node:test";
import { api, setSignedOutHandler, unreadableAnswerMessage } from "../features/kfid/api";
import { sessionBackHref, signInHere } from "../lib/auth/session-return";

// T12 finding F1 (2026-10-28): an answer that is not the app's own JSON (a proxy's HTML 503, a lost connection, an empty
// body) gives a plain Swedish message with the status – never "Unexpected token '<' … not valid JSON".
const realFetch = globalThis.fetch;
const answer = (body: string, status: number, type = "text/html") => async () => new Response(body, { status, headers: { "content-type": type } });

test("a 401 tells the signed-out handler and still fails as before; other answers do not", async () => {
  let heard = 0;
  setSignedOutHandler(() => { heard += 1; });
  try {
    globalThis.fetch = answer(JSON.stringify({ error: "Logga in för att fortsätta." }), 401, "application/json") as typeof fetch;
    await assert.rejects(api("/api/x"), /Logga in för att fortsätta/);
    assert.equal(heard, 1);
    globalThis.fetch = answer(JSON.stringify({ error: "Nej" }), 403, "application/json") as typeof fetch;
    await assert.rejects(api("/api/x"), /Nej/);
    assert.equal(heard, 1);
  } finally { setSignedOutHandler(null); globalThis.fetch = realFetch; }
  assert.equal(sessionBackHref(), "/login?returnTo=%2Flogin%2Fklar");
  assert.equal(signInHere("/", "?view=workflow_task&taskId=a"), "/login?returnTo=%2F%3Fview%3Dworkflow_task%26taskId%3Da");
});

test("a proxy's HTML error, a lost connection and a sign-out give plain Swedish messages", async () => {
  try {
    globalThis.fetch = answer("<html><body>503 Service Unavailable</body></html>", 503) as typeof fetch;
    await assert.rejects(api("/api/overview?tab=me"), (error: Error & { status?: number }) => error.message === "Servern svarar inte just nu. Försök igen om en stund." && error.status === 503);
    globalThis.fetch = answer("<html>login</html>", 401) as typeof fetch;
    await assert.rejects(api("/api/x"), /Du är utloggad/);
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    await assert.rejects(api("/api/x"), (error: Error & { status?: number }) => /Ingen kontakt med servern/.test(error.message) && error.status === 0);
    globalThis.fetch = answer("<html>ok?</html>", 200) as typeof fetch;
    await assert.rejects(api("/api/x"), /Servern svarar inte/, "a 200 that is not JSON is not taken as data");
    globalThis.fetch = answer(JSON.stringify({ error: "Arbetsordern har ändrats." }), 409, "application/json") as typeof fetch;
    await assert.rejects(api("/api/x", { method: "POST" }), (error: Error & { status?: number }) => error.message === "Arbetsordern har ändrats." && error.status === 409, "the app's own errors are kept");
    globalThis.fetch = answer(JSON.stringify({ ok: true }), 200, "application/json") as typeof fetch;
    assert.deepEqual(await api("/api/x"), { ok: true });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(unreadableAnswerMessage(500), "Åtgärden misslyckades.");
});
