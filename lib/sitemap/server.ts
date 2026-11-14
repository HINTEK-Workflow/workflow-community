import "server-only";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { SITEMAP_FILE_PARTS } from "./access";

const run = promisify(execFile);

/**
 * The site map as the build wrote it (`npm run build` runs scripts/sitemap/generate.cjs after `next build`), as JSON text,
 * or null when it is missing. Outside production a missing map is worked out once on the spot, so the dev server shows
 * it too; in production a failed build step only means no map (the page says so), never a failed release.
 */
export async function readSitemap(): Promise<string | null> {
  const file = path.join(process.cwd(), ...SITEMAP_FILE_PARTS);
  const text = await readFile(file, "utf8").catch(() => null);
  if (text !== null || process.env.NODE_ENV === "production") return text;
  try {
    await run(process.execPath, [path.join(process.cwd(), "scripts", "sitemap", "generate.cjs"), "--out", file], { timeout: 60_000 });
  } catch {
    return null;
  }
  return readFile(file, "utf8").catch(() => null);
}
