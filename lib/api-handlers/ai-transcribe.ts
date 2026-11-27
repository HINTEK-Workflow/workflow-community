import { NextResponse } from "next/server";
import { ApiError, checkOrigin, context, failure } from "@/lib/kfid/server";
import { readLimitedUpload } from "@/lib/security/limited-body";
import { VOICE_MAX_BYTES, VOICE_TOO_LONG, VOICE_WRONG_TYPE } from "@/lib/ai/chat-media";
import { transcribeForCompany } from "@/lib/ai/transcription-server";

export const dynamic = "force-dynamic";

/**
 * Tal till text (2026-11-21): the chat's microphone sends one recording here as a form (`audio`, and `seconds` as the
 * browser measured it). The server transcribes it with the company's AI provider and answers with the text only; the audio is
 * never written to disk, the database or a log, and the text is never sent to the chat by itself – it goes into the field.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.organization.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Tal till text kräver serverlagring.");
    const form = await readLimitedUpload(request, VOICE_MAX_BYTES + 64_000, { tooLarge: VOICE_TOO_LONG, notAForm: VOICE_WRONG_TYPE });
    const file = form.get("audio");
    if (!(file instanceof File) || !file.size) throw new ApiError(400, VOICE_WRONG_TYPE);
    if (file.size > VOICE_MAX_BYTES) throw new ApiError(413, VOICE_TOO_LONG);
    const seconds = Number(form.get("seconds"));
    const text = await transcribeForCompany(ctx, new Uint8Array(await file.arrayBuffer()), seconds, request.signal);
    return NextResponse.json({ text }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
