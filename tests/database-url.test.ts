import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PeerCertificate } from "node:tls";
import { databaseTlsProblem } from "../lib/database-tls-policy";
import { nodePgConfig, prismaCliUrl } from "../lib/database-url";

// Databasen på egen server (2026-10-04): one libpq-style DATABASE_URL, translated for node-pg and for Prisma's CLI.
const folder = mkdtempSync(join(tmpdir(), "database-url-"));
const caPath = join(folder, "ca.crt");
writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nnot-a-real-certificate\n-----END CERTIFICATE-----\n");
const remote = `postgresql://workflow_app:p%40ss@10.0.0.10:5432/workflow?schema=public&sslmode=verify-full&sslrootcert=${encodeURIComponent(caPath)}`;
const certificateFor = (ip: string) => ({ subject: {}, subjectaltname: `IP Address:${ip}` }) as unknown as PeerCertificate;

test("node-pg gets the CA and an identity check against the host in the URL, never plain text", () => {
  const config = nodePgConfig(remote);
  assert.ok(config.ssl, "TLS is set explicitly");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.match(String(config.ssl.ca), /not-a-real-certificate/);
  assert.equal(config.ssl.checkServerIdentity?.("localhost", certificateFor("10.0.0.10")), undefined, "the IP in the URL is what is checked, not localhost");
  assert.ok(config.ssl.checkServerIdentity?.("localhost", certificateFor("10.9.9.9")) instanceof Error, "another IP in the certificate is refused");
  const left = new URL(config.connectionString);
  assert.equal(left.searchParams.get("sslmode"), null, "no TLS words left for pg-connection-string to override with");
  assert.equal(left.searchParams.get("sslrootcert"), null);
  assert.equal(left.searchParams.get("schema"), "public");
  assert.equal(decodeURIComponent(left.password), "p@ss");
});

test("Prisma's CLI gets its own verifying form", () => {
  const url = new URL(prismaCliUrl(remote));
  assert.equal(url.searchParams.get("sslmode"), "require");
  assert.equal(url.searchParams.get("sslcert"), caPath);
  assert.equal(url.searchParams.get("sslaccept"), "strict");
  assert.equal(url.searchParams.get("sslrootcert"), null);
  assert.equal(url.searchParams.get("schema"), "public");
});

test("without verify-full both are passed through unchanged; verify-full without a CA fails closed", () => {
  const local = "postgresql://workflow:x@postgres:5432/workflow?schema=public";
  assert.deepEqual(nodePgConfig(local), { connectionString: local });
  assert.equal(prismaCliUrl(local), local);
  assert.throws(() => nodePgConfig("postgresql://a:b@10.0.0.10/workflow?sslmode=verify-full"), /sslrootcert/);
  assert.throws(() => prismaCliUrl("postgresql://a:b@10.0.0.10/workflow?sslmode=verify-full"), /sslrootcert/);
});

test("only a database on another machine must use verified TLS", () => {
  assert.equal(databaseTlsProblem("postgresql://a:b@postgres:5432/workflow"), null);
  assert.equal(databaseTlsProblem("postgresql://a:b@localhost:5432/workflow"), null);
  assert.equal(databaseTlsProblem("postgresql://a:b@127.0.0.1:5432/workflow"), null);
  assert.match(String(databaseTlsProblem("postgresql://a:b@10.0.0.10:5432/workflow?sslmode=prefer")), /verify-full/);
  assert.match(String(databaseTlsProblem("postgresql://a:b@db.example.internal:5432/workflow?sslmode=verify-full")), /sslrootcert/);
  assert.equal(databaseTlsProblem(remote), null);
});

test.after(() => rmSync(folder, { recursive: true, force: true }));
