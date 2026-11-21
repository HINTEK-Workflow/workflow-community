import assert from "node:assert/strict";
import test from "node:test";
import { decryptExternalKey, encryptExternalKey } from "../lib/integrations/keys";
import { openPassword, sealPassword } from "../lib/mail/settings";
import { openPushKey, sealPushKey } from "../lib/push/settings";

const secret = "review-only-secret-with-sufficient-length";

function truncateTag(value: string, encoding: BufferEncoding) {
  const parts = value.split(".");
  const tag = Buffer.from(parts[2]!, encoding);
  parts[2] = tag.subarray(0, 4).toString(encoding);
  return parts.join(".");
}

test("external integration keys reject authentication tags shorter than 128 bits", () => {
  const external = truncateTag(encryptExternalKey("placeholder", secret), "base64url");
  assert.throws(() => decryptExternalKey(external, secret));
});

test("mail passwords reject authentication tags shorter than 128 bits", () => {
  const mail = truncateTag(sealPassword("placeholder", secret), "base64");
  assert.equal(openPassword(mail, secret), "");
});

test("push private keys reject authentication tags shorter than 128 bits", () => {
  const push = truncateTag(sealPushKey("placeholder", secret), "base64");
  assert.equal(openPushKey(push, secret), "");
});
