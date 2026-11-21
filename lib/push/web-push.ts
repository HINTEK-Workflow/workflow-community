import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from "node:crypto";

/**
 * Webbpush (2026-10-07) with VAPID, written on node:crypto so no package is needed (the usual library is under a
 * copyleft-per-file licence, and the protocol is small): RFC 8030 (the push request), RFC 8291 (the message encryption,
 * aes128gcm) and RFC 8292 (VAPID, the application server's identity). Pure but for `sendWebPush`, which does the one
 * request; the tests check the encryption against the example in RFC 8291 section 5.
 */
export type VapidKeys = {
  /** The public key as the browser needs it: the uncompressed P-256 point (65 bytes), base64url. */
  publicKey: string;
  /** The private key: the 32-byte scalar, base64url. Kept sealed (lib/push/settings.ts), never sent anywhere. */
  privateKey: string;
};
export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };

const b64 = (data: Uint8Array) => Buffer.from(data).toString("base64url");
const fromB64 = (value: string) => Buffer.from(value, "base64url");

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as { x: string; y: string; d: string };
  return { publicKey: b64(Buffer.concat([Buffer.from([4]), fromB64(jwk.x), fromB64(jwk.y)])), privateKey: jwk.d };
}

/** Whether a stored pair is a usable P-256 key pair (65-byte public point, 32-byte private scalar, and they belong together). */
export function validVapidKeys(keys: VapidKeys) {
  try {
    const point = fromB64(keys.publicKey);
    const scalar = fromB64(keys.privateKey);
    if (point.length !== 65 || point[0] !== 4 || scalar.length !== 32) return false;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(scalar);
    return ecdh.getPublicKey().equals(point);
  } catch {
    return false;
  }
}

/**
 * The push services a browser's subscription can point to. The server only ever sends to these (https, the default
 * port, no credentials), so a person cannot make it call an address of its own choosing.
 */
const PUSH_HOST_SUFFIXES = [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"] as const;
const PUSH_HOSTS = new Set(["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
export function isPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password || endpoint.length > 1000) return false;
    const host = url.hostname.toLowerCase();
    return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
  } catch {
    return false;
  }
}

/** The subscription's keys as the Push API gives them: the device's public point (65 bytes) and a 16-byte secret. */
export function validSubscriptionKeys(keys: { p256dh: string; auth: string }) {
  try {
    const point = fromB64(keys.p256dh);
    return point.length === 65 && point[0] === 4 && fromB64(keys.auth).length === 16;
  } catch {
    return false;
  }
}

/** The VAPID subject: a mailto: or https: address the push service can reach the sender on. */
export const validVapidSubject = (value: string) => /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value) || /^https:\/\/[^\s/]+(\/\S*)?$/i.test(value);

/** The Authorization header (RFC 8292): a JWT signed with the private key, valid for the push service's origin. */
export function vapidAuthorization(input: { endpoint: string; subject: string; keys: VapidKeys; now?: Date; validForSeconds?: number }) {
  const point = fromB64(input.keys.publicKey);
  const header = b64(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // At most 24 hours (RFC 8292); twelve is plenty for a single request.
  const exp = Math.floor((input.now ?? new Date()).getTime() / 1000) + (input.validForSeconds ?? 12 * 3600);
  const claims = b64(Buffer.from(JSON.stringify({ aud: new URL(input.endpoint).origin, exp, sub: input.subject })));
  const unsigned = `${header}.${claims}`;
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", x: b64(point.subarray(1, 33)), y: b64(point.subarray(33, 65)), d: input.keys.privateKey }, format: "jwk" });
  // ES256 signatures are the raw r||s pair, not DER.
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64(signature)}, k=${input.keys.publicKey}`;
}

/** One message must fit one record of 4 096 bytes: header 86, tag 16, delimiter 1. */
export const MAX_PUSH_PAYLOAD = 3000;

/**
 * Encrypts a message for a subscription (RFC 8291, aes128gcm, one record). The server's one-time key pair and the salt
 * are chosen here; the options exist so the tests can use the example in the RFC.
 */
export function encryptPushPayload(payload: Uint8Array, subscription: { p256dh: string; auth: string }, options: { salt?: Uint8Array; serverPrivateKey?: Uint8Array } = {}) {
  if (payload.length > MAX_PUSH_PAYLOAD) throw new Error("Push-meddelandet är för långt.");
  const uaPublic = fromB64(subscription.p256dh);
  const authSecret = fromB64(subscription.auth);
  const server = createECDH("prime256v1");
  if (options.serverPrivateKey) server.setPrivateKey(Buffer.from(options.serverPrivateKey)); else server.generateKeys();
  const asPublic = server.getPublicKey();
  const salt = Buffer.from(options.salt ?? randomBytes(16));
  const sharedSecret = server.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32));
  const contentKey = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "latin1"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0", "latin1"), 12));
  // The only record is the last one: the message, then the delimiter 0x02 (no padding).
  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  const record = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, record]);
}

export type PushResult = { status: number };
export type PushOptions = { subject: string; keys: VapidKeys; ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high"; fetchImpl?: typeof fetch; now?: Date };

/**
 * Sends one message to one subscription. 201 is delivered to the push service; 404 and 410 mean the device has gone
 * (the caller removes the subscription); anything else is a failure to try again later. Never follows a redirect.
 */
export async function sendWebPush(subscription: PushSubscriptionKeys, payload: string, options: PushOptions): Promise<PushResult> {
  if (!isPushEndpoint(subscription.endpoint)) throw new Error("Okänd push-adress.");
  const body = encryptPushPayload(Buffer.from(payload, "utf8"), subscription);
  const response = await (options.fetchImpl ?? fetch)(subscription.endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: vapidAuthorization({ endpoint: subscription.endpoint, subject: options.subject, keys: options.keys, now: options.now }),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(options.ttlSeconds ?? 12 * 3600),
      Urgency: options.urgency ?? "normal",
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status };
}
