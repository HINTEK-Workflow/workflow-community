import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAX_CLOUD_WORKSPACE_BUNDLE_BYTES } from "@/lib/kfid/cloud-reimport";

// proxy.ts runs before every route (2026-10-15), and Next then keeps only proxyClientMaxBodySize bytes of a request body
// (10 MB by default): a larger price file or Cloud copy would arrive cut off. The limit must hold the largest upload.
const bytes = (file: string, name: string) => {
  const match = new RegExp(name + String.raw`:?\s*=?\s*([\d_]+)`).exec(readFileSync(file, "utf8"));
  assert.ok(match, `${file} sets ${name}`);
  return Number(match[1].replace(/_/g, ""));
};

test("the proxy lets the largest upload through whole", () => {
  const limit = bytes("next.config.ts", "proxyClientMaxBodySize");
  assert.ok(limit >= bytes("lib/catalogue/request.ts", "MAX_PRICE_FILE_BYTES") + 1_000_000, "a price file with its form fits");
  assert.ok(limit >= MAX_CLOUD_WORKSPACE_BUNDLE_BYTES + 1_000_000, "a Cloud copy with its form fits");
});
