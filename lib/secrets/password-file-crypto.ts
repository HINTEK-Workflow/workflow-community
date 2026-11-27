import { createCipheriv, createDecipheriv, createHmac, pbkdf2, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

/**
 * Lösenordsskyddad nyckelfil (2026-11-26): the file a company's admin downloads with the company's own keys. It is the
 * password-protected JSON export that the common password managers write and read (choose "JSON, lösenordsskyddad" or
 * "password protected" when importing), so the admin opens it in the password manager the company already has – and Workflow
 * reads the same file back after a reinstall. The algorithm, as the password manager's own export writes it (checked against
 * its public source, 2026-11-26):
 * - salt: 16 random bytes as base64; the KDF takes the base64 TEXT as UTF-8 bytes (not the decoded bytes);
 * - kdfType 0: PBKDF2-SHA256 over the password's UTF-8 bytes, 600 000 iterations, 32 bytes out;
 * - stretched with HKDF-Expand only (no extract), SHA-256: 32 bytes with info "enc" (AES key) and 32 with info "mac" (HMAC key);
 * - each value an EncString of type 2: "2.<iv>|<data>|<mac>", standard base64, a random 16-byte IV, AES-256-CBC with PKCS#7,
 *   MAC = HMAC-SHA256(mac key, iv || data) – encrypt-then-MAC, checked before anything is decrypted (timing-safe);
 * - encKeyValidation_DO_NOT_EDIT: a random GUID encrypted with the same key, which tells a wrong password before the data;
 * - data: the unencrypted JSON export ({ encrypted: false, folders, items }) encrypted as one EncString.
 * A changed file (any byte of iv, data or mac, or a lower iteration count, which gives another key) opens nothing.
 *
 * The passphrase is new for every file: 24 characters from a CSPRNG in Crockford's base32 (no I, L, O or U), six groups of
 * four (120 bits). The password manager takes it exactly as shown; Workflow's own import also takes it in small letters or
 * without the dashes. It is never stored or logged.
 *
 * Server code only, no database and no environment.
 */
export const PASSWORD_FILE_ITERATIONS = 600_000;
/** What an import accepts: never fewer iterations than a weak file, never so many that one request ties up the server. */
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 2_000_000;
/** Workflow's own key files are small; anything larger is refused before it is parsed. */
export const PASSWORD_FILE_MAX_BYTES = 512 * 1024;

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS = 6;
const GROUP_LENGTH = 4;
export const EXPORT_PASSPHRASE_LENGTH = GROUPS * GROUP_LENGTH;

export type PasswordProtectedFile = {
  encrypted: true;
  passwordProtected: true;
  salt: string;
  kdfType: 0;
  kdfIterations: number;
  encKeyValidation_DO_NOT_EDIT: string;
  data: string;
};

/** Why a file could not be opened: not such a file at all, or a wrong passphrase / a changed file (they cannot be told apart). */
export class PasswordFileError extends Error {
  constructor(readonly reason: "format" | "password") {
    super(reason === "format" ? "Filen är inte en lösenordsskyddad nyckelfil." : "Fel lösenfras, eller så är filen ändrad. Inget har lästs in.");
  }
}

/** A new passphrase: six groups of four characters, from 24 random bytes (32 divides 256, so every character is equally likely). */
export function newExportPassphrase(random: (size: number) => Uint8Array = randomBytes) {
  const bytes = random(EXPORT_PASSPHRASE_LENGTH);
  const characters = Array.from(bytes, (byte) => ALPHABET[byte & 31]).join("");
  return characters.match(new RegExp(`.{${GROUP_LENGTH}}`, "g"))!.join("-");
}

/**
 * The passwords an import tries, in order: what was typed (without spaces at the ends), then the passphrase's shown form (upper
 * case, dashes) when what was typed reads as one of Workflow's passphrases in another way. Never more than two PBKDF2 runs.
 */
export function passphraseCandidates(typed: string): string[] {
  const trimmed = typed.trim();
  const normal = trimmed.toUpperCase().replace(/[\s-]+/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  const shown = normal.length === EXPORT_PASSPHRASE_LENGTH && [...normal].every((character) => ALPHABET.includes(character))
    ? normal.match(new RegExp(`.{${GROUP_LENGTH}}`, "g"))!.join("-") : null;
  return [...new Set([trimmed, ...(shown ? [shown] : [])])].filter(Boolean);
}

const derive = promisify(pbkdf2);
type FileKey = { enc: Buffer; mac: Buffer };

/** HKDF-Expand (RFC 5869) for one block: T(1) = HMAC(prk, info || 0x01). */
const expand = (prk: Buffer, info: string) => createHmac("sha256", prk).update(Buffer.concat([Buffer.from(info, "utf8"), Buffer.from([1])])).digest();

export async function passwordFileKey(password: string, salt: string, iterations: number): Promise<FileKey> {
  const master = await derive(Buffer.from(password, "utf8"), Buffer.from(salt, "utf8"), iterations, 32, "sha256");
  const key = { enc: expand(master, "enc"), mac: expand(master, "mac") };
  master.fill(0);
  return key;
}

const wipe = (key: FileKey) => { key.enc.fill(0); key.mac.fill(0); };
const macOf = (key: FileKey, iv: Buffer, data: Buffer) => createHmac("sha256", key.mac).update(iv).update(data).digest();

function encryptString(plain: string, key: FileKey) {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key.enc, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `2.${iv.toString("base64")}|${data.toString("base64")}|${macOf(key, iv, data).toString("base64")}`;
}

const ENC_STRING = /^2\.([A-Za-z0-9+/]+={0,2})\|([A-Za-z0-9+/]+={0,2})\|([A-Za-z0-9+/]+={0,2})$/;

/** Opens an EncString of type 2, or throws PasswordFileError("password") when its MAC does not match (wrong key or changed). */
function decryptString(text: string, key: FileKey): string {
  const parts = ENC_STRING.exec(text);
  if (!parts) throw new PasswordFileError("format");
  const iv = Buffer.from(parts[1], "base64");
  const data = Buffer.from(parts[2], "base64");
  const mac = Buffer.from(parts[3], "base64");
  if (iv.length !== 16 || mac.length !== 32 || data.length === 0 || data.length % 16 !== 0) throw new PasswordFileError("format");
  if (!timingSafeEqual(macOf(key, iv, data), mac)) throw new PasswordFileError("password");
  try {
    const decipher = createDecipheriv("aes-256-cbc", key.enc, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new PasswordFileError("password");
  }
}

/** Encrypts the unencrypted export with a passphrase (shown, never kept). */
export async function sealPasswordFile(payload: unknown, passphrase: string, iterations = PASSWORD_FILE_ITERATIONS): Promise<PasswordProtectedFile> {
  if (passphrase.length < EXPORT_PASSPHRASE_LENGTH) throw new Error("The passphrase is too short.");
  const salt = randomBytes(16).toString("base64");
  const key = await passwordFileKey(passphrase, salt, iterations);
  try {
    return {
      encrypted: true, passwordProtected: true, salt, kdfType: 0, kdfIterations: iterations,
      encKeyValidation_DO_NOT_EDIT: encryptString(randomUUID(), key),
      data: encryptString(JSON.stringify(payload), key),
    };
  } finally {
    wipe(key);
  }
}

/** The file's text, as the password manager writes its own (two spaces); ASCII only. */
export const passwordFileText = (file: PasswordProtectedFile) => `${JSON.stringify(file, null, 2)}\n`;

const fileSchema = z.object({
  encrypted: z.literal(true),
  passwordProtected: z.literal(true),
  salt: z.string().min(16).max(200),
  kdfType: z.literal(0),
  kdfIterations: z.number().int().min(MIN_ITERATIONS).max(MAX_ITERATIONS),
  kdfMemory: z.null().optional(),
  kdfParallelism: z.null().optional(),
  encKeyValidation_DO_NOT_EDIT: z.string().min(10).max(1000),
  data: z.string().min(10).max(PASSWORD_FILE_MAX_BYTES * 2),
}).strict();

/** Parses the file's text (size, JSON, schema) without a passphrase; throws PasswordFileError("format"). */
export function parsePasswordFile(text: string): PasswordProtectedFile {
  if (Buffer.byteLength(text, "utf8") > PASSWORD_FILE_MAX_BYTES) throw new PasswordFileError("format");
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^﻿/, "")); } catch { throw new PasswordFileError("format"); }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) throw new PasswordFileError("format");
  return parsed.data as PasswordProtectedFile;
}

/**
 * Opens the file with the typed passphrase: the key check first, then the data. Returns the decrypted JSON text. Throws
 * PasswordFileError: "format" when it is no such file, "password" when the passphrase is wrong or any part was changed.
 */
export async function openPasswordFile(text: string, typed: string): Promise<string> {
  const file = parsePasswordFile(text);
  for (const candidate of passphraseCandidates(typed)) {
    const key = await passwordFileKey(candidate, file.salt, file.kdfIterations);
    try {
      try { decryptString(file.encKeyValidation_DO_NOT_EDIT, key); } catch (error) {
        if (error instanceof PasswordFileError && error.reason === "password") continue;
        throw error;
      }
      // The key is right; a data part that does not open now was changed.
      return decryptString(file.data, key);
    } finally {
      wipe(key);
    }
  }
  throw new PasswordFileError("password");
}
