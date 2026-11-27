// Min webbsida (2026-11-10): the server reaches a company's own WordPress only under the outbound rules (SSRF) – https on 443,
// public addresses only (also every address a name resolves to, and the connection is made to the checked one), no redirects,
// time and size limits; http and the own network only with the installation setting. And the REST address is found from the
// site's normal address. Everything against 127.0.0.1 here, never a real site.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { addressProblem, guardedLookup, siteRequest, urlProblem, WpError } from "../lib/website/net";
import { announcedRestBase, discoverRestBase, normalSiteUrl } from "../lib/website/wp-client";
import { startFakeWordPress } from "./fake-wordpress";

const cloud = { allowLocal: false };
const lan = { allowLocal: true };

test("addresses: private, loopback, link-local, metadata, CGNAT, multicast and their IPv6 forms are refused in Cloud", () => {
  for (const address of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "127.0.0.1", "127.8.9.1", "100.64.0.1", "100.127.255.254", "169.254.169.254", "169.254.0.1",
    "0.0.0.0", "224.0.0.1", "239.255.255.250", "255.255.255.255", "198.18.0.1", "192.0.2.1", "100.100.100.200",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe", "fd00:ec2::254", "2001:db8::1"])
    assert.ok(addressProblem(address, cloud), `${address} is refused`);
  for (const address of ["93.184.216.34", "185.199.108.153", "8.8.8.8", "2606:4700::6810:84e5", "2a00:1450:4001:82a::200e"])
    assert.equal(addressProblem(address, cloud), null, `${address} is public`);
  assert.equal(addressProblem("not an address", cloud), "Adressen kunde inte läsas.");
});

test("the installation setting opens the own network, never link-local, multicast or the metadata address", () => {
  for (const address of ["10.0.0.5", "192.168.1.20", "127.0.0.1", "::1", "fd00::5", "100.64.1.1"]) assert.equal(addressProblem(address, lan), null, address);
  for (const address of ["169.254.169.254", "::ffff:169.254.169.254", "fe80::1", "ff02::1", "224.0.0.251", "0.0.0.0", "fd00:ec2::254"]) assert.ok(addressProblem(address, lan), address);
});

test("the address itself: https on 443, no sign-in, no internal names (the setting allows http and other ports)", () => {
  assert.equal(urlProblem("https://example.se/wp-json/", cloud), null);
  assert.equal(urlProblem("https://example.se:443/wp-json/", cloud), null);
  assert.match(urlProblem("http://example.se/", cloud)!, /https/);
  assert.match(urlProblem("ftp://example.se/", cloud)!, /https/);
  assert.match(urlProblem("https://example.se:8443/", cloud)!, /portnummer/);
  assert.match(urlProblem("https://user:pw@example.se/", cloud)!, /inloggning/);
  for (const host of ["localhost", "intranet", "wp.local", "server.internal", "nas.home.arpa"]) assert.match(urlProblem(`https://${host}/`, cloud)!, /intern/, host);
  for (const host of ["127.0.0.1", "[::1]", "169.254.169.254", "10.0.0.1", "[::ffff:127.0.0.1]"]) assert.ok(urlProblem(`https://${host}/`, cloud), host);
  assert.equal(urlProblem("http://192.168.1.5:8080/", lan), null);
  assert.ok(urlProblem("http://169.254.169.254/latest/meta-data/", lan), "the metadata address, also with the setting");
  assert.match(urlProblem("not a url", cloud)!, /giltig/);
});

const lookup = (policy: { allowLocal: boolean }, addresses: { address: string; family: number }[], hostname = "site.example") =>
  new Promise<{ error: NodeJS.ErrnoException | null; address: unknown }>((resolve) =>
    guardedLookup(policy, (_name, callback) => callback(null, addresses))(hostname, {}, (error, address) => resolve({ error, address })));

test("a name is refused when any address it resolves to is not allowed (DNS rebinding included)", async () => {
  assert.equal((await lookup(cloud, [{ address: "93.184.216.34", family: 4 }])).address, "93.184.216.34");
  assert.equal((await lookup(cloud, [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }])).error?.code, "EBLOCKED", "one bad address stops it");
  assert.equal((await lookup(cloud, [{ address: "169.254.169.254", family: 4 }])).error?.code, "EBLOCKED");
  assert.equal((await lookup(cloud, [{ address: "::ffff:10.0.0.1", family: 6 }])).error?.code, "EBLOCKED");
  assert.equal((await lookup(lan, [{ address: "10.0.0.1", family: 4 }])).address, "10.0.0.1");
  const missing = await new Promise<NodeJS.ErrnoException | null>((resolve) => guardedLookup(cloud, (_name, callback) => callback(Object.assign(new Error("x"), { code: "ENOTFOUND" }), []))("x.example", {}, (error) => resolve(error)));
  assert.equal(missing?.code, "ENOTFOUND");
});

async function localServer(handler: Parameters<typeof createServer>[1]) {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port, stop: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("the connection is made to the checked address: a name that points inward never reaches the server", async () => {
  let reached = 0;
  const local = await localServer((_request, response) => { reached += 1; response.end("{}"); });
  try {
    // The name resolves to 127.0.0.1: refused in Cloud before any connection (https, so the address rule is the one that stops it).
    const pinnedInward = (_name: string, callback: (error: NodeJS.ErrnoException | null, addresses: { address: string; family: number }[]) => void) => callback(null, [{ address: "127.0.0.1", family: 4 }]);
    await assert.rejects(siteRequest(`https://site.example/`, { policy: cloud, resolver: pinnedInward }), (error: unknown) => error instanceof WpError && error.code === "blocked");
    assert.equal(reached, 0, "nothing reached the inner server");
    // With the setting, the same name is reached at the address that was looked up (port given, http allowed).
    const answer = await siteRequest(`http://site.example:${local.port}/`, { policy: lan, resolver: pinnedInward });
    assert.equal(answer.status, 200);
    assert.equal(reached, 1);
  } finally { await local.stop(); }
});

test("no redirects, a size limit and a time limit", async () => {
  const local = await localServer((request, response) => {
    if (request.url === "/moved") { response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); response.end(); return; }
    if (request.url === "/big") { response.writeHead(200, { "content-type": "text/plain" }); response.end("x".repeat(5000)); return; }
    if (request.url === "/slow") return; // never answers
    response.end("ok");
  });
  try {
    const base = `http://127.0.0.1:${local.port}`;
    const moved = await siteRequest(`${base}/moved`, { policy: lan });
    assert.equal(moved.status, 302, "a redirect is an answer, never followed");
    await assert.rejects(siteRequest(`${base}/big`, { policy: lan, maxBytes: 1000 }), (error: unknown) => error instanceof WpError && error.code === "too-large");
    await assert.rejects(siteRequest(`${base}/slow`, { policy: lan, timeoutMs: 200 }), (error: unknown) => error instanceof WpError && error.code === "timeout");
    await assert.rejects(siteRequest(`${base}/`, { policy: cloud }), (error: unknown) => error instanceof WpError && error.code === "blocked", "http in Cloud");
  } finally { await local.stop(); }
});

test("the REST address is found from the site's own address: announced, /wp-json/, ?rest_route=", async () => {
  assert.equal(normalSiteUrl("example.se"), "https://example.se/");
  assert.equal(normalSiteUrl("https://example.se/blogg/wp-json/"), "https://example.se/blogg/");
  assert.equal(normalSiteUrl("https://example.se/index.php/wp-json/?x=1#a"), "https://example.se/");
  assert.equal(normalSiteUrl("https://user:pw@example.se/"), null);
  const announced = (link: string | undefined, html = "") => announcedRestBase({ headers: link ? { link } : {}, body: Buffer.from(html) }, "https://example.se/");
  assert.equal(announced('<https://example.se/wp-json/>; rel="https://api.w.org/"'), "https://example.se/wp-json/");
  assert.equal(announced(undefined, `<link rel='https://api.w.org/' href='https://example.se/index.php/wp-json/' />`), "https://example.se/index.php/wp-json/");
  assert.equal(announced('<https://other.example/wp-json/>; rel="https://api.w.org/"'), null, "another host is never taken");

  process.env.WEBSITE_ALLOW_LOCAL_ADDRESSES = "true";
  try {
    const path = await startFakeWordPress({ pages: [], username: "a", password: "b" });
    const query = await startFakeWordPress({ pages: [], username: "a", password: "b", rest: "query" });
    try {
      assert.equal(await discoverRestBase(path.url), path.base);
      assert.equal(await discoverRestBase(`${path.url}/wp-json/`), path.base, "the REST address written as the site's");
      assert.equal(await discoverRestBase(query.url), `${query.url}/?rest_route=/`);
    } finally { await path.stop(); await query.stop(); }
    const empty = await localServer((_request, response) => { response.writeHead(404); response.end("nej"); });
    try { await assert.rejects(discoverRestBase(`http://127.0.0.1:${empty.port}/`), /Ingen WordPress/); } finally { await empty.stop(); }
    const moved = await localServer((_request, response) => { response.writeHead(301, { location: "https://www.example.se/" }); response.end(); });
    try { await assert.rejects(discoverRestBase(`http://127.0.0.1:${moved.port}/`), /skickar vidare till https:\/\/www\.example\.se/); } finally { await moved.stop(); }
  } finally { delete process.env.WEBSITE_ALLOW_LOCAL_ADDRESSES; }
  await assert.rejects(discoverRestBase("http://127.0.0.1:1/"), /https/, "without the setting nothing local is asked");
});
