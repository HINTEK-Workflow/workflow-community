import { ApiError } from "@/lib/kfid/errors";

/**
 * Reading a request body with a ceiling (security review 2026-10-04). The body is read in chunks and the reading stops
 * as soon as it passes the limit, so a huge or endless upload – also one without Content-Length (chunked) – never fills
 * the server's memory. The routes' own limits on files and fields still apply after this.
 */
export class BodyTooLarge extends ApiError {
  constructor(readonly limit: number) { super(413, "För stor begäran."); }
}

export async function readLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new BodyTooLarge(limit);
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge(limit);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readLimitedText(request: Request, limit: number) {
  return new TextDecoder().decode(await readLimited(request, limit));
}

/** Said when a route that takes a form gets something else (S5, review 2026-10-20: 400, not a 500). */
export const NOT_A_FORM = "Begäran ska skickas som ett formulär.";

/**
 * A multipart or url-encoded form, read with a ceiling and then parsed as usual. Another content type, or a form that
 * cannot be parsed, is the sender's mistake: 400 with a Swedish text instead of the parser's TypeError as a 500.
 */
export async function readLimitedFormData(request: Request, limit: number) {
  const type = request.headers.get("content-type") ?? "";
  if (!/^\s*(multipart\/form-data|application\/x-www-form-urlencoded)\b/i.test(type)) throw new ApiError(400, NOT_A_FORM);
  const bytes = await readLimited(request, limit);
  try {
    return await new Response(bytes, { headers: { "content-type": type } }).formData();
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError(400, NOT_A_FORM);
    throw error;
  }
}
