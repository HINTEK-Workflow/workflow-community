// Reading package-lock.json without the network (2026-11-02): which packages a manifest really reaches, a lock with packages
// taken out, the third-party notices without them and an SBOM. Used by scripts/licenses/sbom.mjs and the Community export.

const packageName = (path, entry) => entry?.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);

/** Where Node would find `name` from the package installed at `from`: the nearest node_modules going up. */
export function resolveInLock(packages, from, name) {
  let dir = from;
  for (;;) {
    const candidate = `${dir ? `${dir}/` : ""}node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!dir) return null;
    const at = dir.lastIndexOf("/node_modules/");
    dir = at < 0 ? "" : dir.slice(0, at);
  }
}

const dependencyNames = (entry, root) => [
  ...Object.keys(entry.dependencies ?? {}),
  ...Object.keys(entry.optionalDependencies ?? {}),
  ...Object.keys(entry.peerDependencies ?? {}),
  ...(root ? Object.keys(entry.devDependencies ?? {}) : []),
];

/** Every package path the root reaches, following dependencies, optional and peer dependencies the way the lock resolves them. */
export function reachablePackages(packages) {
  const seen = new Set([""]);
  const queue = [""];
  while (queue.length) {
    const path = queue.pop();
    const entry = packages[path];
    for (const name of dependencyNames(entry, path === "")) {
      const found = resolveInLock(packages, path, name);
      if (found && !seen.has(found)) {
        seen.add(found);
        queue.push(found);
      }
    }
  }
  return seen;
}

/**
 * The lock without the named direct dependencies and whatever only they needed; every other entry stays byte for byte,
 * so `npm ci` installs the same versions. → { lock, removed: [{ name, version }] }
 */
export function pruneLock(lock, names, identity = {}) {
  const packages = structuredClone(lock.packages);
  const root = packages[""];
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"])
    for (const name of names) if (root[group]) delete root[group][name];
  const reached = reachablePackages(packages);
  const removed = [];
  for (const path of Object.keys(packages)) {
    if (reached.has(path)) continue;
    removed.push({ name: packageName(path, packages[path]), version: packages[path].version ?? "" });
    delete packages[path];
  }
  const { name = lock.name, version = lock.version, license } = identity;
  root.name = name;
  root.version = version;
  if (license) root.license = license;
  return { lock: { ...lock, name, version, packages }, removed };
}

/**
 * The notices file without one "== Rubrik ==" section (the heading, its lines and the blank line before the next heading).
 * The Community export drops the Cloud-only icon section this way (2026-11-20).
 */
export function withoutSection(notices, heading) {
  const start = notices.indexOf(`\n${heading}\n`);
  if (start < 0) return notices;
  const next = notices.indexOf("\n== ", start + heading.length + 1);
  return next < 0 ? notices.slice(0, start).replace(/\n*$/, "\n") : `${notices.slice(0, start)}${notices.slice(next)}`;
}

/** The notices file (scripts/licenses/collect.mjs) with these packages gone and the version it speaks of. */
export function pruneNotices(notices, removed, version) {
  let text = notices;
  for (const { name, version: packageVersion } of removed) {
    const id = `${name}@${packageVersion}`;
    text = text.replace(new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} – .*\\n`, "m"), "");
    // A licence text shared with others keeps them; one of its own goes with the package. The blocks are headed by their owners.
    text = text.split(/(?=^--- )/m).flatMap((block) => {
      const head = /^--- (.*) ---\n/.exec(block);
      if (!head) return [block];
      const owners = head[1].split(", ");
      if (!owners.includes(id)) return [block];
      const left = owners.filter((owner) => owner !== id);
      if (!left.length) return /^== /m.test(block) ? [block.slice(block.search(/^== /m))] : [];
      return [`--- ${left.join(", ")} ---\n${block.slice(head[0].length)}`];
    }).join("");
  }
  const count = Number(/^== Paket \((\d+)\) ==$/m.exec(text)?.[1] ?? NaN);
  if (Number.isFinite(count)) text = text.replace(/^== Paket \(\d+\) ==$/m, `== Paket (${count - removed.length}) ==`);
  return version ? text.replace(/Workflow \d+\.\d+\.\d+(?= i servern)/, `Workflow ${version}`) : text;
}

const hexOfIntegrity = (integrity) => {
  const match = /^sha512-(.+)$/.exec(integrity ?? "");
  return match ? Buffer.from(match[1], "base64").toString("hex") : null;
};
const purlOf = (name, version) => `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;
// A package without a licence field whose own licence file says which (reviewed by hand; scripts/licenses/collect.mjs).
const LICENCE_FROM_FILE = { "seq-queue": "MIT" };
const SIMPLE_SPDX = /^[A-Za-z0-9.+-]+$/;
const SCOPE_RANK = { excluded: 0, optional: 1, required: 2 };

/** A licence of the lock as CycloneDX writes it: an id, an expression, or a name when it is neither. */
function licenceOf(name, entry) {
  const value = entry.license ?? LICENCE_FROM_FILE[name];
  if (!value) return [];
  const text = String(value).trim();
  if (SIMPLE_SPDX.test(text) && !/\//.test(text)) return [{ license: { id: text } }];
  if (/\b(AND|OR)\b/.test(text)) return [{ expression: text.replace(/^\((.*)\)$/, "$1") }];
  return [{ license: { name: text } }];
}

/**
 * A CycloneDX 1.5 SBOM of everything the lock installs, with licence, hash and the graph of what needs what. Dev packages
 * are marked `excluded` (they never ship). Deterministic: no timestamp or serial number, unless the caller adds them.
 */
export function cycloneDx(lock, { name, version, licence } = {}) {
  const packages = lock.packages;
  const refOf = (path) => `${packageName(path, packages[path])}@${packages[path].version ?? ""}`;
  const rootRef = `${name ?? lock.name}@${version ?? lock.version}`;
  const seen = new Map();
  const graph = new Map();
  for (const path of Object.keys(packages)) {
    if (!path) continue;
    const entry = packages[path];
    const packageId = packageName(path, entry);
    const ref = refOf(path);
    const scope = entry.dev ? "excluded" : entry.optional ? "optional" : "required";
    const known = seen.get(ref);
    if (known) {
      // The same package and version installed twice: what ships decides.
      if (SCOPE_RANK[scope] > SCOPE_RANK[known.scope]) known.scope = scope;
    } else {
      const hex = hexOfIntegrity(entry.integrity);
      seen.set(ref, {
        type: "library",
        "bom-ref": ref,
        name: packageId,
        version: entry.version ?? "",
        scope,
        licenses: licenceOf(packageId, entry),
        purl: purlOf(packageId, entry.version ?? ""),
        ...(hex ? { hashes: [{ alg: "SHA-512", content: hex }] } : {}),
      });
    }
    const needs = graph.get(ref) ?? new Set();
    for (const dependency of dependencyNames(entry, false)) {
      const found = resolveInLock(packages, path, dependency);
      if (found) needs.add(refOf(found));
    }
    graph.set(ref, needs);
  }
  const rootNeeds = new Set();
  for (const dependency of dependencyNames(packages[""], true)) {
    const found = resolveInLock(packages, "", dependency);
    if (found) rootNeeds.add(refOf(found));
  }
  const sorted = (items) => [...items].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      tools: [{ name: "scripts/licenses/sbom.mjs" }],
      component: { type: "application", "bom-ref": rootRef, name: name ?? lock.name, version: version ?? lock.version, ...(licence ? { licenses: [{ license: { id: licence } }] } : {}) },
    },
    components: [...seen.values()].sort((a, b) => (a["bom-ref"] < b["bom-ref"] ? -1 : 1)),
    dependencies: [
      { ref: rootRef, dependsOn: sorted(rootNeeds) },
      ...sorted(graph.keys()).map((ref) => ({ ref, dependsOn: sorted(graph.get(ref)) })),
    ],
  };
}
