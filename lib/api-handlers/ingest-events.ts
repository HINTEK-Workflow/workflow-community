import { NextResponse } from "next/server";
import { clientIp } from "@/lib/security/client-ip";
import { BodyTooLarge, readLimitedText } from "@/lib/security/limited-body";
import { RATE_RULES, hitRateLimit } from "@/lib/security/rate-limit";
import { MAX_BODY_BYTES, INGEST_SCHEMA_VERSION, type EnvelopeError } from "@/lib/machine/intake";
import { authenticateMachineSource, isRefusal } from "@/lib/machine/authenticate";
import { sourceKeyMissingText, sourceKeyRefusalText } from "@/lib/machine/keys";
import { receiveEvents } from "@/lib/machine/store";
import { refuseMachineIntake } from "@/lib/machine/intake-off";

export const dynamic = "force-dynamic";

/**
 * Maskinintag (S2): POST /api/ingest/v1/events with `Authorization: Bearer <källans nyckel>` and a JSON body
 * { schemaVersion: 1, events: [1–20 händelser] }. Only this one thing: the key cannot read or do anything else. The company
 * comes from the key, never from the body. The answer is 202 with one result per event (accepted | duplicate | rejected).
 */
const headers = { "Cache-Control": "no-store" } as const;
const ENVELOPE_TEXT: Record<EnvelopeError, string> = {
  invalid_json: "Kroppen är inte giltig JSON.",
  not_an_object: "Kroppen ska vara ett JSON-objekt med schemaVersion och events.",
  unknown_field: "Kroppen har ett okänt fält. Tillåtna fält är schemaVersion och events.",
  unsupported_version: `schemaVersion ska vara ${INGEST_SCHEMA_VERSION}.`,
  bad_events: "events ska vara en lista.",
  bad_batch_size: "events ska innehålla 1–20 händelser.",
};

export async function POST(request: Request) {
  const address = clientIp(request.headers);
  const authorization = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] ?? "";
  const principal = await authenticateMachineSource(token);
  if (isRefusal(principal)) {
    // Guessing keys is limited per address; a refused key never says more than the sender is entitled to know.
    const guess = await hitRateLimit(RATE_RULES.ingestRefused, address);
    if (!guess.allowed) return NextResponse.json({ error: "För många försök. Vänta en stund.", code: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(guess.retryAfterSeconds) } });
    return NextResponse.json({ error: token ? sourceKeyRefusalText(principal.problem) : sourceKeyMissingText(), code: "invalid_key" }, { status: 401, headers: { ...headers, "WWW-Authenticate": "Bearer" } });
  }
  const limit = await hitRateLimit(RATE_RULES.ingestCall, principal.sourceId);
  if (!limit.allowed) return NextResponse.json({ error: "För många anrop från den här källan. Vänta och skicka igen.", code: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfterSeconds) } });
  if (principal.intakeOff) return refuseMachineIntake(principal, headers);

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(await readLimitedText(request, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof BodyTooLarge) return NextResponse.json({ error: "Kroppen är för stor (högst 64 kB).", code: "too_large" }, { status: 413, headers });
    return NextResponse.json({ error: ENVELOPE_TEXT.invalid_json, code: "invalid_json" }, { status: 400, headers });
  }
  const received = await receiveEvents(principal, parsedBody);
  if (!received.ok) return NextResponse.json({ error: ENVELOPE_TEXT[received.error], code: received.error }, { status: 400, headers });
  return NextResponse.json({ schemaVersion: INGEST_SCHEMA_VERSION, results: received.results, counts: received.counts }, { status: 202, headers });
}
