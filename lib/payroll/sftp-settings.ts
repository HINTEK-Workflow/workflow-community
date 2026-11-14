import { z } from "zod";

/**
 * SFTP settings (2026-10-29), pure so the settings page and the demo can read them: host, port, user, folders, the server's host
 * key fingerprint and the schedule – never the password or key, which is a company key (IntegrationKey, sealed per company).
 * The host must be a public name or address: never localhost, a private network or link-local (the server must not be turned
 * into a door to Workflow's own network).
 */
const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const ipv6 = /^[0-9a-f:]+$/i;

/** A literal address or name that must never be reached from the server: loopback, private, link-local and the like. */
export function isBlockedHost(host: string) {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!value || value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local") || value.endsWith(".internal")) return true;
  if (ipv4.test(value)) {
    const [a, b] = value.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (value.includes(":") && ipv6.test(value)) return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80") || value.startsWith("::ffff:");
  return !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value);
}

const folder = z.string().trim().max(200).regex(/^[\w./ -]*$/, "Mappen får bara ha bokstäver, siffror, / . - och _.").refine((value) => !value.split("/").includes(".."), "Mappen får inte innehålla ..");
export const sftpSettingsSchema = z.object({
  host: z.string().trim().max(253).default("").refine((value) => !value || !isBlockedHost(value), "Ange en publik server (inte en intern adress)."),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().trim().max(100).default(""),
  importDir: folder.default(""),
  exportDir: folder.default(""),
  /** The server's host key fingerprint (SHA256:…), checked on every connection. */
  hostKey: z.string().trim().max(120).regex(/^(SHA256:[A-Za-z0-9+/=]{20,})?$/, "Ange serverns fingerprint (SHA256:…).").default(""),
  schedule: z.enum(["off", "nightly"]).default("off"),
});
export type SftpSettings = z.infer<typeof sftpSettingsSchema>;
export const sftpReady = (settings: SftpSettings) => Boolean(settings.host && settings.username && settings.hostKey);
export const SFTP_UNAVAILABLE = "SFTP är förberett men inte påslaget: ingen SFTP-klient är installerad på servern ännu. Använd filer för hand så länge.";
