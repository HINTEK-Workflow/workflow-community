import sharp from "sharp";
import { ApiError } from "@/lib/kfid/errors";
import {
  CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_MAX_PIXELS, CHAT_IMAGE_MAX_PREPARED_BYTES, CHAT_IMAGE_MAX_SIDE, IMAGE_TOO_LARGE, IMAGE_UNREADABLE, IMAGE_WRONG_TYPE,
  imageTokenEstimate, sniffImageType,
} from "@/lib/ai/chat-media";

/** A photo ready for the model: a JPEG data URL without metadata, its size and the input tokens it is reserved for. */
export type PreparedChatImage = { dataUrl: string; width: number; height: number; bytes: number; tokens: number };

/**
 * A photo for Workflow AI, prepared on Workflow's own server (2026-11-21) before anything is sent: the bytes must be a real
 * JPEG, PNG or WebP of at most 10 MB and 40 megapixels; it is turned upright by its EXIF orientation, made at most 1600 px on the
 * longest side and saved again as JPEG. sharp writes no metadata unless asked (`keepMetadata`/`withMetadata` is never called), so
 * EXIF – the position (GPS), the camera, the time – XMP and IPTC are gone from what the provider gets. Nothing is stored here: the
 * photo lives only in this request's memory. Used only by the server's handlers (sharp is a server library).
 */
export async function prepareChatImage(input: Uint8Array): Promise<PreparedChatImage> {
  if (!input.byteLength) throw new ApiError(400, IMAGE_UNREADABLE);
  if (input.byteLength > CHAT_IMAGE_MAX_BYTES) throw new ApiError(413, IMAGE_TOO_LARGE);
  if (!sniffImageType(input)) throw new ApiError(400, IMAGE_WRONG_TYPE);
  let output: { data: Buffer; info: { width: number; height: number } };
  try {
    output = await sharp(input, { limitInputPixels: CHAT_IMAGE_MAX_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width: CHAT_IMAGE_MAX_SIDE, height: CHAT_IMAGE_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      // A transparent PNG becomes white behind, not black.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ApiError(400, IMAGE_UNREADABLE);
  }
  if (output.data.length > CHAT_IMAGE_MAX_PREPARED_BYTES) throw new ApiError(413, IMAGE_TOO_LARGE);
  return {
    dataUrl: `data:image/jpeg;base64,${output.data.toString("base64")}`,
    width: output.info.width, height: output.info.height, bytes: output.data.length,
    tokens: imageTokenEstimate(output.info.width, output.info.height),
  };
}
