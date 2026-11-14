import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import test from "node:test";
import { encryptPushPayload, generateVapidKeys, isPushEndpoint, MAX_PUSH_PAYLOAD, sendWebPush, validSubscriptionKeys, validVapidKeys, validVapidSubject, vapidAuthorization } from "../lib/push/web-push";

// Webbpush (2026-10-07): VAPID and the message encryption written on node:crypto, checked against the example in
// RFC 8291 section 5 and against an independent decryption on the device's side.
const b64 = (value: Uint8Array | Buffer) => Buffer.from(value).toString("base64url");
const unb64 = (value: string) => Buffer.from(value, "base64url");

// RFC 8291, section 5 (the example message "When I grow up, I want to be a watermelon").
const rfc = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** The device's side (RFC 8291 section 4): opens a message with the device's private key and secret. */
function decrypt(body: Buffer, device: { privateKey: Uint8Array; publicKey: Buffer; auth: Buffer }) {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body[20];
  const serverPublic = body.subarray(21, 21 + idLength);
  const record = body.subarray(21 + idLength);
  assert.equal(recordSize, 4096);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(device.privateKey));
  const secret = ecdh.computeSecret(serverPublic);
  const ikm = Buffer.from(hkdfSync("sha256", secret, device.auth, Buffer.concat([Buffer.from("WebPush: info\0"), device.publicKey, serverPublic]), 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2, "the last record ends with the delimiter 0x02");
  return plain.subarray(0, plain.length - 1);
}

test("the encryption gives the example message in RFC 8291 exactly", () => {
  const body = encryptPushPayload(unb64(rfc.plaintext), { p256dh: rfc.uaPublic, auth: rfc.auth }, { salt: unb64(rfc.salt), serverPrivateKey: unb64(rfc.asPrivate) });
  assert.equal(b64(body), rfc.body);
  assert.equal(unb64(rfc.plaintext).toString(), "When I grow up, I want to be a watermelon");
});

test("a message encrypted for a device opens only with that device's keys, and is new every time", () => {
  const device = createECDH("prime256v1");
  device.generateKeys();
  const auth = Buffer.from("0123456789abcdef");
  const subscription = { p256dh: b64(device.getPublicKey()), auth: b64(auth) };
  const keys = { privateKey: device.getPrivateKey(), publicKey: device.getPublicKey(), auth };
  const first = encryptPushPayload(Buffer.from("Förfallen: Skyddsrond ✓"), subscription);
  const second = encryptPushPayload(Buffer.from("Förfallen: Skyddsrond ✓"), subscription);
  assert.equal(decrypt(first, keys).toString("utf8"), "Förfallen: Skyddsrond ✓");
  assert.notDeepEqual(first, second, "a fresh salt and server key each time");
  const other = createECDH("prime256v1");
  other.generateKeys();
  assert.throws(() => decrypt(first, { ...keys, privateKey: other.getPrivateKey(), publicKey: other.getPublicKey() }));
  assert.throws(() => decrypt(first, { ...keys, auth: Buffer.from("fedcba9876543210") }));
  assert.throws(() => encryptPushPayload(Buffer.alloc(MAX_PUSH_PAYLOAD + 1), subscription), /för långt/);
});

test("generated VAPID keys are a matching P-256 pair in the form the browser needs", () => {
  const keys = generateVapidKeys();
  assert.equal(unb64(keys.publicKey).length, 65);
  assert.equal(unb64(keys.publicKey)[0], 4);
  assert.equal(unb64(keys.privateKey).length, 32);
  assert.equal(validVapidKeys(keys), true);
  assert.equal(validVapidKeys({ publicKey: keys.publicKey, privateKey: generateVapidKeys().privateKey }), false, "a private key from another pair");
  assert.equal(validVapidKeys({ publicKey: "x", privateKey: "y" }), false);
  assert.notEqual(generateVapidKeys().publicKey, keys.publicKey);
});

test("the VAPID header is a JWT for the push service's origin, signed so that the public key verifies it", () => {
  const keys = generateVapidKeys();
  const now = new Date("2026-10-08T08:00:00Z");
  const header = vapidAuthorization({ endpoint: "https://fcm.googleapis.com/fcm/send/abc123", subject: "mailto:drift@example.test", keys, now });
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert.ok(match, header);
  const [, head, claims, signature, publicKey] = match;
  assert.equal(publicKey, keys.publicKey);
  assert.deepEqual(JSON.parse(unb64(head).toString()), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(unb64(claims).toString()), { aud: "https://fcm.googleapis.com", exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: "mailto:drift@example.test" });
  const point = unb64(keys.publicKey);
  const publicObject = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64(point.subarray(1, 33)), y: b64(point.subarray(33, 65)) }, format: "jwk" });
  assert.equal(unb64(signature).length, 64, "raw r||s, not DER");
  assert.equal(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicObject, dsaEncoding: "ieee-p1363" }, unb64(signature)), true);
  assert.equal(verify("sha256", Buffer.from(`${head}.${claims}x`), { key: publicObject, dsaEncoding: "ieee-p1363" }, unb64(signature)), false);
  assert.ok(Math.floor(now.getTime() / 1000) + 12 * 3600 - Math.floor(now.getTime() / 1000) <= 24 * 3600, "within the 24 hours RFC 8292 allows");
});

test("only the known push services are ever called, over https on the default port", () => {
  for (const endpoint of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc", "https://wns2-par02p.notify.windows.com/w/?token=abc", "https://eu.push.apple.com/abc"])
    assert.equal(isPushEndpoint(endpoint), true, endpoint);
  for (const endpoint of ["http://fcm.googleapis.com/fcm/send/abc", "https://fcm.googleapis.com:8443/x", "https://user:pass@fcm.googleapis.com/x", "https://example.com/push", "https://127.0.0.1/x", "https://10.0.0.1/x", "https://localhost/x",
    "https://fcm.googleapis.com.evil.example/x", "https://evilfcm.googleapis.com.example/x", "https://notify.windows.com/x", "https://push.apple.com/x", "ftp://fcm.googleapis.com/x", "not a url", ""])
    assert.equal(isPushEndpoint(endpoint), false, endpoint);
});

test("a subscription's keys must be a 65-byte point and a 16-byte secret; the subject a mailto or https address", () => {
  assert.equal(validSubscriptionKeys({ p256dh: rfc.uaPublic, auth: rfc.auth }), true);
  assert.equal(validSubscriptionKeys({ p256dh: rfc.uaPublic, auth: "AAAA" }), false);
  assert.equal(validSubscriptionKeys({ p256dh: "AAAA", auth: rfc.auth }), false);
  assert.equal(validVapidSubject("mailto:drift@example.test"), true);
  assert.equal(validVapidSubject("https://example.test/kontakt"), true);
  for (const bad of ["drift@example.test", "http://example.test", "mailto:", "javascript:alert(1)", "mailto:a b@example.test"]) assert.equal(validVapidSubject(bad), false, bad);
});

test("the request carries the encrypted body and the headers the push service needs, and never follows a redirect", async () => {
  const keys = generateVapidKeys();
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status: 201 }); }) as unknown as typeof fetch;
  const result = await sendWebPush({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: rfc.uaPublic, auth: rfc.auth }, JSON.stringify({ title: "Workflow", body: "En ny påminnelse" }), { subject: "mailto:drift@example.test", keys, fetchImpl: fakeFetch });
  assert.deepEqual(result, { status: 201 });
  const [call] = calls;
  assert.equal(call.url, "https://fcm.googleapis.com/fcm/send/abc");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.redirect, "error");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers["Content-Encoding"], "aes128gcm");
  assert.equal(headers["Content-Type"], "application/octet-stream");
  assert.match(headers.Authorization, /^vapid t=.+, k=.+$/);
  assert.match(headers.TTL, /^\d+$/);
  assert.ok((call.init.body as Uint8Array).length > 86);
  // An address outside the known services is refused before anything is sent.
  await assert.rejects(() => sendWebPush({ endpoint: "https://example.com/x", p256dh: rfc.uaPublic, auth: rfc.auth }, "x", { subject: "mailto:drift@example.test", keys, fetchImpl: fakeFetch }), /Okänd push-adress/);
  assert.equal(calls.length, 1);
});
