// Serveruppdateringar (2026-10-25): scripts/ops/host-status.sh run against made-up files (a fake root, apt's list
// and apt-config's values from files), and its output read by the app's own parser. Nothing here touches a server.
// Needs bash (Git Bash on Windows, /bin/bash elsewhere); skipped where there is none – never WSL's bash.exe.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { evaluateHostStatus, parseHostStatus } from "../lib/ops/host-status";

const bash = process.platform === "win32"
  ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((file) => existsSync(file))
  : ["/bin/bash", "/usr/bin/bash"].find((file) => existsSync(file));
const slash = (file: string) => file.replaceAll("\\", "/");
const script = slash(path.resolve("scripts/ops/host-status.sh"));

function fakeServer(options: { hostup: boolean; fix: boolean; reboot: boolean }) {
  const base = mkdtempSync(path.join(tmpdir(), "host-status-"));
  const root = path.join(base, "root");
  for (const dir of ["var/run", "var/lib/apt/periodic", "var/lib/apt/lists", "etc/apt/apt.conf.d", "boot", "proc", "usr/bin"]) mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, "proc/uptime"), "200000.12 400000.00\n");
  writeFileSync(path.join(root, "etc/os-release"), 'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n');
  writeFileSync(path.join(root, "boot/vmlinuz-6.8.0-45-generic"), "");
  writeFileSync(path.join(root, "usr/bin/unattended-upgrade"), "#!/bin/sh\n");
  chmodSync(path.join(root, "usr/bin/unattended-upgrade"), 0o755);
  const stamp = path.join(root, "var/lib/apt/periodic/update-success-stamp");
  writeFileSync(stamp, "");
  utimesSync(stamp, new Date("2026-10-04T03:00:00Z"), new Date("2026-10-04T03:00:00Z"));
  writeFileSync(path.join(root, "var/lib/apt/lists/archive.ubuntu.com_ubuntu_dists_noble-updates_main_binary-amd64_Packages"), "");
  if (options.reboot) {
    writeFileSync(path.join(root, "boot/vmlinuz-6.8.0-47-generic"), "");
    writeFileSync(path.join(root, "var/run/reboot-required"), "*** System restart required ***\n");
    writeFileSync(path.join(root, "var/run/reboot-required.pkgs"), "linux-image-6.8.0-47-generic\nlibc6\nlinux-image-6.8.0-47-generic\n");
  }
  const config = ['APT::Periodic::Enable "1";'];
  if (options.hostup) {
    writeFileSync(path.join(root, "etc/apt/apt.conf.d/99-hostup-disable-automatic-apt"), 'APT::Periodic::Update-Package-Lists "0";\nAPT::Periodic::Unattended-Upgrade "0";\n');
    config.push('APT::Periodic::Update-Package-Lists "0";', 'APT::Periodic::Unattended-Upgrade "0";');
  }
  if (options.fix) {
    writeFileSync(path.join(root, "etc/apt/apt.conf.d/99z-hintek-enable-automatic-apt"), 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\nAPT::Periodic::Enable "1";\n');
    // apt-config prints the merged value once, as the last file left it.
    const merged = ['APT::Periodic::Enable "1";', 'APT::Periodic::Update-Package-Lists "1";', 'APT::Periodic::Unattended-Upgrade "1";'];
    config.splice(0, config.length, ...merged);
  }
  writeFileSync(path.join(base, "apt-config"), `APT "";\nAPT::Architecture "amd64";\n${config.join("\n")}\n`);
  writeFileSync(path.join(base, "apt-list"), [
    "Listing...",
    "openssl/noble-updates,noble-security 3.0.13-0ubuntu3.4 amd64 [upgradable from: 3.0.13-0ubuntu3.1]",
    "linux-image-generic/noble-updates,noble-security 6.8.0.47.47 amd64 [upgradable from: 6.8.0.45.45]",
    "curl/noble-updates 8.5.0-2ubuntu10.5 amd64 [upgradable from: 8.5.0-2ubuntu10.4]",
    'evil"name/noble-updates 1 amd64',
    "",
  ].join("\n"));
  return base;
}

function run(base: string, extra: Record<string, string> = {}) {
  const result = spawnSync(bash!, [script], {
    encoding: "utf8",
    env: {
      ...process.env, HOST_LABEL: "db-server", OUT_DIR: slash(path.join(base, "out")), STATE_DIR: slash(path.join(base, "state")),
      HS_ROOT: slash(path.join(base, "root")), HS_APT_LIST_FILE: slash(path.join(base, "apt-list")), HS_APT_CONFIG_FILE: slash(path.join(base, "apt-config")),
      HS_KERNEL: "6.8.0-45-generic", HS_TIMER: "enabled", ...extra,
    },
  });
  return result;
}

test("the script's file on a server like db-server on 2026-10-25: security updates, a restart, Hostup's file", { skip: !bash && "no bash here" }, () => {
  const base = fakeServer({ hostup: true, fix: false, reboot: true });
  try {
    const result = run(base);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /host-status: db-server .* 3 väntande \(0 stegvis utrullade räknas inte\), 2 säkerhet, omstart true, automatik false/);
    const raw = readFileSync(path.join(base, "out/db-server.json"), "utf8");
    const status = parseHostStatus(raw);
    assert.ok(status, `the app reads the script's file:\n${raw}`);
    assert.equal(status.host, "db-server");
    assert.equal(status.os, "Ubuntu 24.04.1 LTS");
    assert.equal(status.updates.pending, 3, "the line with a quote in its name is not a package line");
    assert.equal(status.updates.security, 2);
    assert.deepEqual(status.updates.securityPackages, ["openssl", "linux-image-generic"]);
    assert.equal(status.reboot.required, true);
    assert.deepEqual(status.reboot.packages, ["libc6", "linux-image-6.8.0-47-generic"]);
    assert.equal(status.kernel.running, "6.8.0-45-generic");
    assert.equal(status.kernel.newestInstalled, "6.8.0-47-generic");
    assert.equal(status.kernel.newerInstalled, true);
    assert.equal(status.uptimeSeconds, 200000);
    assert.equal(status.automatic.effective, false);
    assert.equal(status.automatic.updatePackageLists, "0");
    assert.deepEqual(status.automatic.zeroFiles, ["99-hostup-disable-automatic-apt"]);
    assert.equal(status.apt.updateSuccess, "2026-10-04T03:00:00.000Z");
    assert.doesNotMatch(raw, /10.202.|206.168./, "no addresses, only the server name");
    const view = evaluateHostStatus("db-server", status, new Date(Date.parse(status.generatedAt) + 60_000));
    assert.deepEqual(view.badges, ["SECURITY", "REBOOT", "AUTO_OFF", "PENDING"]);
    assert.deepEqual(view.alerts.map((alert) => alert.kind), ["auto-off"], "only the automatic updates at once; the rest after three days");

    // A second run remembers since when; once the state is gone it is forgotten.
    const first = status.updates.securitySince;
    assert.ok(first);
    run(base);
    const again = parseHostStatus(readFileSync(path.join(base, "out/db-server.json"), "utf8"));
    assert.equal(again?.updates.securitySince, first, "the first time it was seen is kept");
    writeFileSync(path.join(base, "apt-list"), "Listing...\n");
    run(base);
    assert.equal(parseHostStatus(readFileSync(path.join(base, "out/db-server.json"), "utf8"))?.updates.securitySince, null, "forgotten when nothing waits");
    assert.ok(!existsSync(path.join(base, "state/since.security")));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("the script's file after the fix: 99z-hintek-enable-automatic-apt wins over Hostup's file", { skip: !bash && "no bash here" }, () => {
  const base = fakeServer({ hostup: true, fix: true, reboot: false });
  try {
    assert.equal(run(base).status, 0);
    const status = parseHostStatus(readFileSync(path.join(base, "out/db-server.json"), "utf8"));
    assert.ok(status);
    assert.equal(status.automatic.effective, true, "the effective values decide, not that a file says 0");
    assert.deepEqual(status.automatic.zeroFiles, ["99-hostup-disable-automatic-apt"], "the provider's file is still named");
    assert.equal(status.reboot.required, false);
    assert.equal(status.kernel.newerInstalled, false);
    assert.equal(status.automatic.offSince, null);
    // Without unattended-upgrades, or with its timer switched off, they are not effectively on.
    rmSync(path.join(base, "root/usr/bin/unattended-upgrade"));
    run(base);
    assert.equal(parseHostStatus(readFileSync(path.join(base, "out/db-server.json"), "utf8"))?.automatic.effective, false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("the script refuses a wrong server name and a missing folder", { skip: !bash && "no bash here" }, () => {
  const base = fakeServer({ hostup: false, fix: false, reboot: false });
  try {
    assert.equal(run(base, { HOST_LABEL: "Hintek DB" }).status, 64);
    assert.equal(run(base, { OUT_DIR: "" }).status, 64);
    assert.ok(!existsSync(path.join(base, "out")));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("Ubuntu's phased updates are not pending: apt holds them back until the server's turn (2026-11-14)", { skip: !bash && "no bash here" }, () => {
  const base = fakeServer({ hostup: false, fix: true, reboot: false });
  try {
    // apt-get -s upgrade as on the servers: curl is phased; openssl is phased too but comes from the security suite and counts.
    writeFileSync(path.join(base, "apt-sim"), [
      "Reading package lists...",
      "Calculating upgrade...",
      "The following upgrades have been deferred due to phasing:",
      "  curl openssl",
      "The following packages will be upgraded:",
      "  linux-image-generic",
      "1 upgraded, 0 newly installed, 0 to remove and 2 not upgraded.",
      "",
    ].join("\n"));
    const result = run(base, { HS_APT_PHASED_FILE: slash(path.join(base, "apt-sim")) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 väntande \(1 stegvis utrullade räknas inte\), 2 säkerhet/);
    const status = parseHostStatus(readFileSync(path.join(base, "out/db-server.json"), "utf8"));
    assert.ok(status);
    assert.equal(status.updates.pending, 2, "curl waits for its phase and is left out");
    assert.equal(status.updates.packages.includes("curl"), false);
    assert.deepEqual(status.updates.securityPackages, ["openssl", "linux-image-generic"], "a security update always counts");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
