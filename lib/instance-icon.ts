import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { INSTANCE_DEFAULTS } from "@/lib/instance-defaults";
import { filePath } from "@/lib/kfid/storage";

/**
 * Appikonen (2026-11-10, val D): the icon in the browser tab and on the home screen. The installation's built-in icon
 * comes from its defaults (Workflow's for Workflow's installation, a neutral one in Community); where the installation may have
 * its own (features.ownIcon), its superadmin uploads a picture under Drift och säkerhet. One square PNG of 512 px is kept in
 * the installation's file storage under a fixed name, beside its other files and in the same backup; every size is made
 * from it when asked for. No database column: the file is the setting, and who changed it is in the history.
 */
export const ICON_SIZES = ["32", "192", "512", "maskable"] as const;
export type IconSize = (typeof ICON_SIZES)[number];
export type IconUrls = Record<IconSize, string>;

/** The largest file accepted. */
export const ICON_MAX_BYTES = 2_000_000;
const MAX_INPUT_PIXELS = 25_000_000;
export const ICON_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const ICON_KEY = "instance-icon.png";

/** The built-in icon's addresses (public/icons), from the installation's defaults. */
export const builtInIconUrls = (): IconUrls => ({ ...INSTANCE_DEFAULTS.icons });

/** The addresses of the installation's own icon; the version makes a browser fetch it again after a change. */
export const ownIconUrls = (version: string): IconUrls =>
  Object.fromEntries(ICON_SIZES.map((size) => [size, `/api/instance-icon?size=${size}&v=${version}`])) as IconUrls;

export type OwnIcon = { png: Buffer; version: string; changedAt: string };

const CACHE_MS = 10_000;
let cached: { at: number; icon: OwnIcon | null } | null = null;
export const clearIconCache = () => { cached = null; };

/** The installation's own icon, or null (none uploaded). Read again at most every ten seconds. */
export async function readOwnIcon(): Promise<OwnIcon | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.icon;
  let icon: OwnIcon | null = null;
  try {
    const file = filePath(ICON_KEY);
    const [png, info] = await Promise.all([readFile(file), stat(file)]);
    icon = { png, version: createHash("sha256").update(png).digest("hex").slice(0, 12), changedAt: info.mtime.toISOString() };
  } catch {
    icon = null;
  }
  cached = { at: Date.now(), icon };
  return icon;
}

/** The icons the page links: the installation's own when it has one (and may), otherwise the built-in. Never fails a page. */
export async function instanceIconUrls(ownAllowed: boolean): Promise<IconUrls> {
  if (!ownAllowed) return builtInIconUrls();
  const icon = await readOwnIcon().catch(() => null);
  return icon ? ownIconUrls(icon.version) : builtInIconUrls();
}

export class IconError extends Error {}

/** The uploaded picture as the stored square PNG (512 px, the picture fitted inside on a white ground). */
export async function normalizeIcon(input: Uint8Array): Promise<Buffer> {
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height || meta.width < 48 || meta.height < 48) throw new IconError("Bilden är för liten. Välj en bild på minst 192 × 192 px.");
    return await image.resize(512, 512, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } }).flatten({ background: "#ffffff" }).png().toBuffer();
  } catch (error) {
    if (error instanceof IconError) throw error;
    throw new IconError("Bilden kunde inte läsas. Välj PNG, JPEG eller WebP.");
  }
}

/** One size of the stored icon. The maskable one keeps the picture inside the safe zone (80 %) on white. */
export async function iconOfSize(stored: Buffer, size: IconSize): Promise<Buffer> {
  if (size === "maskable") return sharp(stored).resize(410, 410).extend({ top: 51, bottom: 51, left: 51, right: 51, background: "#ffffff" }).png().toBuffer();
  const pixels = Number(size);
  return pixels === 512 ? stored : sharp(stored).resize(pixels, pixels).png().toBuffer();
}

/** Saves a new icon in place of the old one (written beside it first, then moved, so a reader never sees half a file). */
export async function saveInstanceIcon(input: Uint8Array): Promise<OwnIcon> {
  const png = await normalizeIcon(input);
  const file = filePath(ICON_KEY);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, png, { mode: 0o600 });
  await rename(temporary, file);
  clearIconCache();
  return (await readOwnIcon())!;
}

/** Back to the built-in icon. */
export async function removeInstanceIcon() {
  await unlink(filePath(ICON_KEY)).catch(() => undefined);
  clearIconCache();
}
