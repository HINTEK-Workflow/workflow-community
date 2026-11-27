// Granskningen 2026-10-20, drift (förberett 2026-10-24): checks on the repository side of T4, D3, S9, T5, D1/D2/D4, so that
// a later edit does not quietly bring back what was fixed. Nothing here runs a script against a server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

test("T4: the image that runs has only the runtime packages; prisma, typescript and tsx are runtime packages", () => {
  const dockerfile = read("Dockerfile");
  const stages = dockerfile.split(/^FROM /m).slice(1);
  const runtime = stages.find((stage) => /^\S+ AS runtime\b/.test(stage));
  assert.ok(runtime, "a stage named runtime");
  assert.ok(stages.at(-1) === runtime, "the runtime stage is the last one (the one docker build tags)");
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(runtime, /COPY --from=deps-runtime \/app\/node_modules/);
  assert.match(runtime, /COPY --from=build [^\n]*\/app\/\.next \.\/\.next/);
  assert.doesNotMatch(runtime, /^RUN[^\n]*npm ci/m, "no npm ci of its own in the runtime stage");
  const depsRuntime = stages.find((stage) => /^\S+ AS deps-runtime\b/.test(stage)) ?? "";
  assert.match(depsRuntime, /^RUN [^\n]*npm ci --omit=dev$/m);
  assert.match(dockerfile, /npm run build/);
  assert.match(runtime, /CMD \["container-start"\]/);

  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string>; scripts: Record<string, string> };
  assert.ok(pkg.dependencies.tsx && !pkg.devDependencies.tsx, "tsx runs the scheduled jobs, so it is a runtime package");
  assert.ok(pkg.dependencies.prisma && !pkg.devDependencies.prisma, "prisma migrate deploy runs at every container start");
  const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, { dev?: boolean; devOptional?: boolean }> };
  for (const name of ["tsx", "prisma", "typescript", "@prisma/engines", "@prisma/client", "dotenv", "pg"]) {
    const entry = lock.packages[`node_modules/${name}`];
    assert.ok(entry, `${name} is in package-lock.json`);
    // npm ci --omit=dev leaves out "dev" only; "devOptional" (typescript, an optional peer of prisma) stays.
    assert.ok(!entry.dev, `${name} is not left out by npm ci --omit=dev`);
  }
  assert.equal((lock.packages[""] as { dependencies?: Record<string, string> }).dependencies?.tsx, pkg.dependencies.tsx, "package-lock.json agrees with package.json");
});

test("T3: the index names migration only renames the four long names to Prisma's names", () => {
  const sql = read("prisma/migrations/20261024200000_t3_index_names/migration.sql");
  const statements = sql.split("\n").filter((line) => line.trim() && !line.startsWith("--"));
  assert.equal(statements.length, 4);
  for (const line of statements) {
    const match = /^ALTER INDEX "([^"]+)" RENAME TO "([^"]+)";$/.exec(line);
    assert.ok(match, line);
    assert.equal(match[1].length, 63, "the old name is Postgres' cut at 63 characters");
    assert.ok(match[2].length <= 63 && /_(idx|key)$/.test(match[2]), "the new name is Prisma's, with its suffix");
  }
});

