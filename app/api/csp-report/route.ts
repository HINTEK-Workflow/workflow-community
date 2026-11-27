// S2 (review 2026-10-20): the receiver for the report-only Content-Security-Policy (lib/security/csp.ts). Browsers send
// reports without a session and often without Origin, so this route checks neither: it changes no data and only writes a
// short, redacted log line (lib/security/csp-report.ts). The body size and the rate per address are limited, and the
// answer is always empty.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { BodyTooLarge, readLimitedText } from "@/lib/security/limited-body";
import { clientIp } from "@/lib/security/client-ip";
import { createCspReportSink, isCspReportType, MAX_CSP_REPORT_BYTES, parseCspReports } from "@/lib/security/csp-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sink = createCspReportSink();

export async function POST(request: Request) {
  if (!isCspReportType(request.headers.get("content-type"))) return new NextResponse(null, { status: 415 });
  const address = createHash("sha256").update(`csp-report:${clientIp(request.headers)}`).digest("base64url").slice(0, 24);
  if (!sink.allow(address)) return new NextResponse(null, { status: 429, headers: { "Retry-After": "600" } });
  let text: string;
  try {
    text = await readLimitedText(request, MAX_CSP_REPORT_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLarge) return new NextResponse(null, { status: 413 });
    return new NextResponse(null, { status: 400 });
  }
  sink.record(parseCspReports(text));
  return new NextResponse(null, { status: 204 });
}
