#!/usr/bin/env node
/**
 * The software bill of materials (2026-11-02): a CycloneDX 1.5 file of every package package-lock.json installs, with version,
 * licence, hash and dependency graph. From the lock alone, without the network and without an outside tool.
 *
 *   node scripts/licenses/sbom.mjs [--out <file>]    writes the file (default: sbom.cdx.json in the current folder)
 *
 * The Community export writes the edition's own sbom.cdx.json from its pruned lock; for a Cloud release this is run by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { cycloneDx } from "./lock-tools.mjs";

const at = process.argv.indexOf("--out");
const out = at > 0 ? process.argv[at + 1] : "sbom.cdx.json";
if (!out) throw new Error("Usage: node scripts/licenses/sbom.mjs [--out <file>]");
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const bom = cycloneDx(lock, { name: manifest.name, version: manifest.version, licence: manifest.license });
writeFileSync(out, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`${out}: ${bom.components.length} komponenter.`);
