import { NextResponse } from "next/server";
import { clientIp } from "@/lib/security/client-ip";
import { BodyTooLarge, readLimitedText } from "@/lib/security/limited-body";
import { RATE_RULES, hitRateLimit } from "@/lib/security/rate-limit";
import { MAX_BODY_BYTES } from "@/lib/machine/intake";
import { authenticateMachineSource, isRefusal } from "@/lib/machine/authenticate";
import { sourceKeyMissingText, sourceKeyRefusalText } from "@/lib/machine/keys";
import { RAW_ERROR_TEXT } from "@/lib/machine/raw-profile";
import { receiveRaw } from "@/lib/machine/raw-store";
import { refuseMachineIntake } from "@/lib/machine/intake-off";

export const dynamic = "force-dynamic";

/**
 * Rådata-intag (integrationsmotorn E4, 2026-10-24 beslut 3): POST /api/ingest/v1/raw with the device's own JSON. The
 * source's format profile says how it is read; nothing about the device is in the code. The same key, rate and size as
 * /events. The key goes in `Authorization: Bearer <nyckel>` or, for a device that cannot set Authorization, in
 * `X-Hintek-Key` – never in the address or the body, so it is not written to proxy logs. The answer is 200 (devices that
 * only count 200 as delivered would otherwise send for ever) with counts and fixed codes, never text from the body.
 */
const headers = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const address = clientIp(request.headers);
  const authorization = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] ?? (request.headers.get("x-hintek-key") ?? "").trim();
  const principal = await authenticateMachineSource(token);
  if (isRefusal(principal)) {
    const guess = await hitRateLimit(RATE_RULES.ingestRefused, address);
    if (!guess.allowed) return NextResponse.json({ error: "För många försök. Vänta en stund.", code: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(guess.retryAfterSeconds) } });
    return NextResponse.json({ error: token ? sourceKeyRefusalText(principal.problem) : sourceKeyMissingText(true), code: "invalid_key" }, { status: 401, headers: { ...headers, "WWW-Authenticate": "Bearer" } });
  }
  const limit = await hitRateLimit(RATE_RULES.ingestCall, principal.sourceId);
  if (!limit.allowed) return NextResponse.json({ error: "För många anrop från den här källan. Vänta och skicka igen.", code: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfterSeconds) } });
  if (principal.intakeOff) return refuseMachineIntake(principal, headers);
  let text: string;
  try {
    text = await readLimitedText(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLarge) return NextResponse.json({ error: "Kroppen är för stor (högst 64 kB).", code: "too_large" }, { status: 413, headers });
    return NextResponse.json({ error: RAW_ERROR_TEXT.invalid_json, code: "invalid_json" }, { status: 400, headers });
  }
  const outcome = await receiveRaw(principal, text);
  if (!outcome.ok) return NextResponse.json({ error: RAW_ERROR_TEXT[outcome.error], code: outcome.error }, { status: outcome.status, headers });
  const { ok: _ok, ...counts } = outcome;
  void _ok;
  return NextResponse.json({ schemaVersion: 1, ...counts }, { status: 200, headers });
}
