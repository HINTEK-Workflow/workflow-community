import {
  cleanTranscript, sniffAudioType, transcriptionRequest, transcriptionUsage, VOICE_MAX_BYTES, VOICE_MAX_OUTPUT_TOKENS, VOICE_MAX_SECONDS,
  VOICE_TOKENS_PER_SECOND, VOICE_TOO_LONG, VOICE_WRONG_TYPE,
} from "@/lib/ai/chat-media";
import type { ProviderUsage } from "@/lib/ai/structured-provider";

/** The provider's transcription endpoint as Workflow uses it (OpenAI's SDK shape; on Azure the deployment is the model). */
export type TranscriptionClient<F> = {
  audio: { transcriptions: { create(params: ReturnType<typeof transcriptionRequest<F>>, options?: { signal?: AbortSignal }): Promise<{ text?: string; usage?: unknown }> } };
};
/** How a run is recorded: a reservation before, the provider's usage after, or the reservation returned. Never the audio. */
export type TranscriptionLedger = {
  reserve(input: { estimatedInputTokens: number; inputTokenLimit: number; maxOutputTokens: number }): Promise<{ runId: string }>;
  settle(runId: string, usage: ProviderUsage): Promise<void>;
  fail(runId: string, code: string): Promise<void>;
};
/** A refusal the person reads (Swedish), with the HTTP status the route answers with. */
export class TranscriptionRefused extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** The reservation's ceiling: the longest recording at the estimate's rate, twice over. */
export const VOICE_INPUT_TOKEN_LIMIT = VOICE_MAX_SECONDS * VOICE_TOKENS_PER_SECOND * 2;

/**
 * Tal till text (2026-11-21): one recording from the chat's microphone, turned into Swedish text by the company's AI
 * provider – on the server, never in the browser. The bytes must be a real recording (WebM, Ogg, MP4, WAV or MP3) of at most 4 MB
 * and 60 seconds. The audio goes only to the provider's transcription call: the ledger gets token counts and nothing else, the
 * function keeps no reference, and the buffer is overwritten with zeros when the call is done, whatever the outcome. The text is
 * handed back for the person to check in the field – it is never sent on its own.
 */
export async function transcribeSpeech<F>(input: {
  audio: Uint8Array; seconds: number; deployment: string;
  client: TranscriptionClient<F>; ledger: TranscriptionLedger;
  toFile: (bytes: Uint8Array, name: string, type: string) => Promise<F>;
  signal?: AbortSignal;
}): Promise<{ text: string; usage: ProviderUsage }> {
  const { audio } = input;
  try {
    if (!audio.byteLength) throw new TranscriptionRefused(400, VOICE_WRONG_TYPE);
    if (audio.byteLength > VOICE_MAX_BYTES) throw new TranscriptionRefused(413, VOICE_TOO_LONG);
    if (Number.isFinite(input.seconds) && input.seconds > VOICE_MAX_SECONDS + 2) throw new TranscriptionRefused(400, VOICE_TOO_LONG);
    const type = sniffAudioType(audio);
    if (!type) throw new TranscriptionRefused(400, VOICE_WRONG_TYPE);
    const seconds = Math.min(VOICE_MAX_SECONDS, Math.max(1, Number.isFinite(input.seconds) ? input.seconds : VOICE_MAX_SECONDS));
    const { runId } = await input.ledger.reserve({ estimatedInputTokens: Math.ceil(seconds * VOICE_TOKENS_PER_SECOND), inputTokenLimit: VOICE_INPUT_TOKEN_LIMIT, maxOutputTokens: VOICE_MAX_OUTPUT_TOKENS });
    let response: { text?: string; usage?: unknown };
    try {
      // A copy for the SDK's upload, wiped below like the original.
      const file = await input.toFile(audio, `tal.${type.extension}`, type.mime);
      response = await input.client.audio.transcriptions.create(transcriptionRequest(input.deployment, file), input.signal ? { signal: input.signal } : undefined);
    } catch (error) {
      await input.ledger.fail(runId, input.signal?.aborted ? "CLIENT_ABORTED" : "PROVIDER_FAILED");
      throw error;
    }
    const text = cleanTranscript(response.text);
    const usage = transcriptionUsage(response.usage, seconds, text);
    await input.ledger.settle(runId, usage);
    return { text, usage };
  } finally {
    audio.fill(0);
  }
}
