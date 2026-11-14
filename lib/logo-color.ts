import sharp from "sharp";
import { normalizeCustomerPrimary, rgbToHex } from "@/lib/theme";

type Bucket = { count: number; r: number; g: number; b: number; score: number };

export async function extractLogoPrimary(buffer: Buffer) {
  const { data, info } = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 128, height: 128, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, Bucket>();
  for (let index = 0; index < data.length; index += info.channels) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const alpha = data[index + 3] / 255;
    if (alpha < 0.3) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const lightness = (max + min) / 510;
    if (lightness > 0.94 || lightness < 0.04) continue;
    const saturation = max ? chroma / max : 0;
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const weight = alpha * (0.35 + saturation) * (0.7 + chroma / 255);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, score: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.score += weight;
    buckets.set(key, bucket);
  }
  const best = [...buckets.values()].sort(
    (first, second) => second.score - first.score || second.count - first.count,
  )[0];
  if (!best) return null;
  return normalizeCustomerPrimary(
    rgbToHex({ r: best.r / best.count, g: best.g / best.count, b: best.b / best.count }),
  );
}
