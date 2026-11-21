import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

/**
 * Min webbsida (2026-11-10): every request the server makes to a company's own WordPress goes through here, because the
 * address is the company's own text (SSRF):
 *
 * - https on port 443 only; no sign-in in the address; no redirects followed (an answer 3xx is an answer);
 * - the host is resolved here and every address it resolves to is checked – private, loopback, link-local (also the cloud
 *   metadata address 169.254.169.254), CGNAT, multicast, reserved and documentation ranges and their IPv6 equivalents
 *   are refused – and the connection is made to the address that was checked (the lookup is the socket's own), so a name
 *   that changes between the check and the connection (DNS rebinding) never reaches another address;
 * - a time limit for the whole answer and a size limit while it is read.
 *
 * An installation that runs its own WordPress on its own network (Community, a server on the LAN) may allow http and
 * private addresses with the installation setting WEBSITE_ALLOW_LOCAL_ADDRESSES=true (off by default). Link-local,
 * multicast and the metadata addresses stay refused also then.
 */
export class WpError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) { super(message); this.name = "WpError"; }
}

export type NetPolicy = { allowLocal: boolean };

/** The installation's setting (read when asked, so a test can set it). */
export const installationPolicy = (): NetPolicy => ({ allowLocal: process.env.WEBSITE_ALLOW_LOCAL_ADDRESSES === "true" });

const subnets = (list: BlockList, family: "ipv4" | "ipv6", ranges: string[]) => {
  for (const range of ranges) { const [address, prefix] = range.split("/"); list.addSubnet(address, Number(prefix), family); }
  return list;
};

/** Never reached, whatever the setting. */
const ALWAYS = subnets(subnets(new BlockList(), "ipv4", [
  "0.0.0.0/8", "169.254.0.0/16", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "100.100.100.200/32",
]), "ipv6", [
  "::/128", "fe80::/10", "ff00::/8", "2001:db8::/32", "fd00:ec2::254/128", "2001::/32", "2002::/16", "100::/64",
]);
/** The local network: only with WEBSITE_ALLOW_LOCAL_ADDRESSES=true. */
const LOCAL = subnets(subnets(new BlockList(), "ipv4", [
  "10.0.0.0/8", "127.0.0.0/8", "100.64.0.0/10", "172.16.0.0/12", "192.168.0.0/16", "192.0.0.0/24", "198.18.0.0/15",
]), "ipv6", ["::1/128", "fc00::/7", "fec0::/10", "64:ff9b::/96", "64:ff9b:1::/48"]);

/** An IPv4 address carried inside an IPv6 one (::ffff:a.b.c.d, ::a.b.c.d), or null. */
function embeddedV4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:0*:)*(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower.replace(/^::/, "0:"));
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) { const high = parseInt(hex[1], 16); const low = parseInt(hex[2], 16); return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`; }
  return null;
}

/** Why the server may not connect to this address, or null. Pure. */
export function addressProblem(address: string, policy: NetPolicy): string | null {
  const family = isIP(address);
  if (!family) return "Adressen kunde inte läsas.";
  const inner = family === 6 ? embeddedV4(address) : null;
  if (inner) return addressProblem(inner, policy);
  const type = family === 4 ? "ipv4" : "ipv6";
  if (ALWAYS.check(address, type)) return "Webbplatsen pekar på en adress som inte får nås.";
  if (LOCAL.check(address, type) && !policy.allowLocal) return "Webbplatsen pekar på en intern adress. Bara publika webbplatser kan kopplas.";
  return null;
}

/** Why the address may not be asked at all (before any lookup), or null. */
export function urlProblem(value: string | URL, policy: NetPolicy): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return "Adressen är inte en giltig webbadress."; }
  if (url.username || url.password) return "Adressen får inte innehålla inloggning.";
  if (url.protocol === "https:") {
    if (url.port && url.port !== "443" && !policy.allowLocal) return "Adressen får inte ha ett eget portnummer.";
  } else if (url.protocol === "http:") {
    if (!policy.allowLocal) return "Adressen måste börja med https://.";
  } else return "Adressen måste börja med https://.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return "Adressen saknar värdnamn.";
  if (isIP(host)) return addressProblem(host, policy);
  if (!policy.allowLocal && (/(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i.test(host) || !host.includes("."))) return "Webbplatsen pekar på en intern adress. Bara publika webbplatser kan kopplas.";
  return null;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
type Resolver = (hostname: string, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;
const systemResolver: Resolver = (hostname, callback) => dnsLookup(hostname, { all: true, verbatim: true }, callback);

/**
 * The socket's own lookup: resolves the name, refuses it when any address it gives is not allowed, and hands the socket the
 * checked addresses only – the connection is made to what was checked.
 */
export function guardedLookup(policy: NetPolicy, resolver: Resolver = systemResolver) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) => {
    resolver(hostname, (error, addresses) => {
      if (error || !addresses?.length) { callback(Object.assign(new Error("Webbplatsens namn kunde inte slås upp."), { code: "ENOTFOUND" }), ""); return; }
      for (const entry of addresses) {
        const problem = addressProblem(entry.address, policy);
        if (problem) { callback(Object.assign(new Error(problem), { code: "EBLOCKED" }), ""); return; }
      }
      if (typeof options === "object" && options?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

export type SiteAnswer = { status: number; headers: Record<string, string>; body: Buffer };
export type SiteRequest = {
  method?: string; headers?: Record<string, string>; body?: string | Uint8Array; timeoutMs?: number; maxBytes?: number;
  policy?: NetPolicy; resolver?: Resolver;
};

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

/** One request to a company's site under the rules above. The answer's body is read whole, up to the size limit. */
export function siteRequest(target: string | URL, options: SiteRequest = {}): Promise<SiteAnswer> {
  const policy = options.policy ?? installationPolicy();
  const url = new URL(target);
  const problem = urlProblem(url, policy);
  if (problem) return Promise.reject(new WpError(problem, 400, "blocked"));
  const limit = options.maxBytes ?? MAX_BYTES;
  const client = url.protocol === "https:" ? https : http;
  const body = options.body === undefined ? undefined : typeof options.body === "string" ? Buffer.from(options.body, "utf8") : Buffer.from(options.body);
  return new Promise<SiteAnswer>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, answer?: SiteAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(answer!);
    };
    const request = client.request(url, {
      method: options.method ?? "GET",
      headers: { "user-agent": "Workflow", ...options.headers, ...(body ? { "content-length": String(body.byteLength) } : {}) },
      agent: false,
      lookup: guardedLookup(policy, options.resolver) as unknown as typeof dnsLookup,
    }, (response) => {
      const length = Number(response.headers["content-length"] ?? 0);
      if (length > limit) { response.destroy(); finish(new WpError("Svaret från webbplatsen är för stort.", 502, "too-large")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > limit) { response.destroy(); finish(new WpError("Svaret från webbplatsen är för stort.", 502, "too-large")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
        finish(null, { status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
      });
      response.on("error", () => finish(new WpError("Ingen kontakt med webbplatsen.", 504, "network")));
    });
    const timer = setTimeout(() => { request.destroy(); finish(new WpError("Webbplatsen svarar inte (tidsgränsen gick ut).", 504, "timeout")); }, options.timeoutMs ?? TIMEOUT_MS);
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EBLOCKED") finish(new WpError(error.message, 400, "blocked"));
      else if (error.code === "ENOTFOUND") finish(new WpError("Webbplatsens namn kunde inte slås upp. Kontrollera adressen.", 502, "dns"));
      else finish(new WpError("Ingen kontakt med webbplatsen.", 504, "network"));
    });
    if (body) request.write(body);
    request.end();
  });
}
