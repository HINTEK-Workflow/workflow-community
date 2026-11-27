// A software passkey for tests (2026-10-11): an ES256 key pair that answers WebAuthn registration and authentication
// the way a browser and a platform authenticator do (attestation "none"), so the server's checks can be exercised
// without a browser. Test code only – never imported by the app.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

const b64url = (value: Uint8Array) => Buffer.from(value).toString("base64url");
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest();

// The few CBOR shapes WebAuthn needs: unsigned and negative integers, byte and text strings, maps.
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function head(major: number, value: number) {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const out = Buffer.alloc(3); out[0] = (major << 5) | 25; out.writeUInt16BE(value, 1); return out;
}
export function cbor(value: Cbor): Buffer {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") { const text = Buffer.from(value, "utf8"); return Buffer.concat([head(3, text.length), text]); }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}

const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_AT = 0x40;

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly cose: Buffer;
  counter = 0;
  /** Whether the "fingerprint" is checked: false makes an answer without user verification. */
  userVerified = true;

  constructor(private readonly rpId: string, private readonly origin: string) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" });
    this.cose = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]));
  }

  get id() { return b64url(this.credentialId); }

  private authData(attested: boolean) {
    const flags = FLAG_UP | (this.userVerified ? FLAG_UV : 0) | (attested ? FLAG_AT : 0);
    const count = Buffer.alloc(4); count.writeUInt32BE(this.counter);
    const parts: Buffer[] = [sha256(this.rpId), Buffer.from([flags]), count];
    if (attested) {
      const length = Buffer.alloc(2); length.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), length, this.credentialId, this.cose);
    }
    return Buffer.concat(parts);
  }

  private clientData(type: string, challenge: string, origin = this.origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** The answer to navigator.credentials.create() for these options. */
  register(options: { challenge: string }, origin?: string) {
    const attestationObject = cbor(new Map<Cbor, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", this.authData(true)]]));
    return {
      id: this.id, rawId: this.id, type: "public-key" as const, clientExtensionResults: {}, authenticatorAttachment: "platform" as const,
      response: { clientDataJSON: b64url(this.clientData("webauthn.create", options.challenge, origin)), attestationObject: b64url(attestationObject), transports: ["internal" as const] },
    };
  }

  /** The answer to navigator.credentials.get(); the counter goes up by one unless told otherwise. */
  authenticate(options: { challenge: string }, { origin, counter }: { origin?: string; counter?: number } = {}) {
    this.counter = counter ?? this.counter + 1;
    const authenticatorData = this.authData(false);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge, origin);
    const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), this.privateKey);
    return {
      id: this.id, rawId: this.id, type: "public-key" as const, clientExtensionResults: {}, authenticatorAttachment: "platform" as const,
      response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authenticatorData), signature: b64url(signature) },
    };
  }
}
