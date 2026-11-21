// Omförsegling till nyckelringens aktuella hemlighet (2026-10-25, beslut 3a). Runbook: docs/drift/NYCKELROTATION.md.
//   npm run secrets:reseal -- check
//   npm run secrets:reseal -- apply   --backup <file outside the repository>
//   npm run secrets:reseal -- restore --backup <the same file>
// check counts what is current, on an older secret or format, or unreadable – never a value. apply first writes every
// sealed value it will touch, exactly as stored (ciphertexts only), to the backup file with a SHA-256 beside it, reads the
// file back and compares, and only then reseals in one transaction where every new value is opened again and compared.
// restore writes the file back exactly. Against any other database than kfid_v3_test, apply and restore also need
// --confirm-production (the owner's yes, after the database backup on the database server has been taken and read back).
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../../lib/db";
import { env } from "../../lib/env";
import { keyRingStatus } from "../../lib/security/key-ring";
import { blockers, inventory, reseal, restore, snapshot, snapshotDigest, type Inventory, type Snapshot } from "../../lib/secrets/reseal";

const args = process.argv.slice(2);
const command = args[0];
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const flag = (name: string) => args.includes(name);

function print(counts: Inventory) {
  const ring = keyRingStatus();
  console.log(`Nyckelringen: aktuell nyckel ${ring.currentKeyId}, ${ring.separate ? "egen förseglingshemlighet" : "förseglar med AUTH_SECRET (ingen egen INTEGRATION_KEYS_SECRET)"}, ${ring.previousCount} föregående.`);
  for (const [place, count] of Object.entries(counts)) console.log(`  ${place}: ${count.current} aktuella, ${count.older} äldre, ${count.unreadable} går inte att öppna`);
  if (!Object.keys(counts).length) console.log("  (inga förseglade värden)");
}

function backupPath() {
  const file = option("--backup");
  if (!file) throw new Error("Ange --backup <fil>.");
  const resolved = path.resolve(file);
  // Never inside the repository: the file holds every sealed value and must not end up in Git or a build.
  if (resolved.startsWith(path.resolve(process.cwd()) + path.sep)) throw new Error("Säkerhetskopian ska ligga utanför repot (till exempel i en mapp på din egen dator).");
  return resolved;
}

function guardProduction() {
  if (new URL(env.DATABASE_URL).pathname === "/kfid_v3_test") return;
  if (!flag("--confirm-production")) throw new Error("Det här är inte testdatabasen. Kör bara med --confirm-production, efter ett uttryckligt ja och en läst databasbackup.");
}

async function main() {
  if (command === "check") { print(await inventory()); return; }
  if (command === "apply") {
    guardProduction();
    const file = backupPath();
    if (existsSync(file)) throw new Error("Säkerhetskopian finns redan. Välj ett nytt filnamn – en gammal kopia skrivs aldrig över.");
    const before = await inventory();
    print(before);
    const stopped = blockers(before);
    if (stopped.length) throw new Error(`Värden som inte går att öppna i ${stopped.join(", ")}. Lägg in eller ta bort dem först. Ingenting ändrades.`);
    const text = JSON.stringify(await snapshot());
    const digest = snapshotDigest(text);
    writeFileSync(file, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    writeFileSync(`${file}.sha256`, `${digest}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    // Read back and compare before anything is changed.
    const again = readFileSync(file, "utf8");
    if (snapshotDigest(again) !== digest) throw new Error("Säkerhetskopian kunde inte läsas tillbaka oförändrad. Ingenting ändrades.");
    JSON.parse(again) as Snapshot;
    console.log(`Säkerhetskopia skriven och kontrollerad: ${file} (SHA-256 ${digest.slice(0, 16)}…).`);
    const done = await reseal();
    console.log(`Omförseglat: ${Object.entries(done).map(([place, count]) => `${place} ${count}`).join(", ") || "inget behövde göras"}.`);
    print(await inventory());
    return;
  }
  if (command === "restore") {
    guardProduction();
    const file = backupPath();
    const text = readFileSync(file, "utf8");
    const expected = readFileSync(`${file}.sha256`, "utf8").trim();
    if (snapshotDigest(text) !== expected) throw new Error("Säkerhetskopian stämmer inte med sin kontrollsumma. Ingenting återställdes.");
    await restore(JSON.parse(text) as Snapshot);
    console.log("Återställt från säkerhetskopian.");
    print(await inventory());
    return;
  }
  throw new Error("Använd check, apply --backup <fil> eller restore --backup <fil>.");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Omförseglingen misslyckades."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
