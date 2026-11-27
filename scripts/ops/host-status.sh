#!/usr/bin/env bash
# Serveruppdateringar (2026-10-25: "Jag har inget bra sätt att se och uppdatera om det kommer nya patchar för
# servrarna."): writes a small JSON file about this server's updates that Produktadministration → Drift och säkerhet
# reads. Run by root's cron on each server (app-server: ops/cron/workflow, db-server: ops/db-server/hintek-host-status.cron).
# The app never runs anything on the servers and never has root: it only reads the file, read-only.
#
# What it writes (schema 1): pending packages and which of them come from a security suite, whether a restart is needed
# (/var/run/reboot-required and its packages, or a newer installed kernel than the running one), the running kernel,
# uptime, whether the automatic security updates are EFFECTIVELY on (apt-config's merged values – a provider file such as
# 99-hostup-disable-automatic-apt can switch them off), the files that set them to 0, and apt's own stamps in
# /var/lib/apt/periodic. Never secrets, never addresses: only the HOST_LABEL, package names, versions and times.
#
# By default it changes nothing on the server: it reads the package lists apt already has (APT_UPDATE=1 refreshes them
# first with apt-get update). It remembers in STATE_DIR since when security updates have waited and since when the
# automatic updates have been off, so the app can tell "more than three days" without a database of its own.
#
# Environment:
#   HOST_LABEL  the server's name on the page (app-server, db-server); [a-z0-9-], required
#   OUT_DIR     where <HOST_LABEL>.json is written (app-server: /opt/workflow/production/host-status,
#               db-server: /srv/workflow-storage/.host-status); required
#   STATE_DIR   (/var/lib/hintek-host-status) · APT_UPDATE (0)
# For the tests only (scripts are run against made-up files, tests/host-status-script.test.ts):
#   HS_ROOT (a fake root for /var, /etc, /boot, /proc, /usr) · HS_APT_LIST_FILE · HS_APT_CONFIG_FILE · HS_KERNEL
#   HS_TIMER (enabled|disabled|unknown)
set -Euo pipefail
umask 022

readonly HOST_LABEL="${HOST_LABEL:-}"
readonly OUT_DIR="${OUT_DIR:-}"
readonly STATE_DIR="${STATE_DIR:-/var/lib/hintek-host-status}"
readonly APT_UPDATE="${APT_UPDATE:-0}"
readonly R="${HS_ROOT:-}"

if [[ ! "$HOST_LABEL" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]]; then echo "host-status: HOST_LABEL must be [a-z0-9-] (e.g. db-server)" >&2; exit 64; fi
if [[ -z "$OUT_DIR" ]]; then echo "host-status: OUT_DIR is required" >&2; exit 64; fi

now_epoch="$(date -u +%s)"
iso() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
# The modification time of a file as ISO, or nothing.
mtime_iso() { local seconds; seconds="$(stat -c %Y "$1" 2>/dev/null)" || return 0; iso "$seconds"; }
# JSON: a string with only printable characters, quotes and backslashes escaped; null when empty.
jstr() {
  local value
  value="$(printf '%s' "$1" | tr -d '\000-\037\177' | sed 's/\\/\\\\/g; s/"/\\"/g')"
  if [[ -z "$value" ]]; then printf 'null'; else printf '"%s"' "$value"; fi
}
# A JSON array of names (package names and file names only: anything else in them is dropped), at most $1 items.
jnames() {
  local max="$1" first=1 count=0 name
  shift
  printf '['
  for name in "$@"; do
    name="$(printf '%s' "$name" | tr -cd 'A-Za-z0-9.+:~_-')"
    [[ -n "$name" ]] || continue
    (( count < max )) || break
    (( first )) || printf ','
    printf '"%s"' "$name"
    first=0
    count=$((count + 1))
  done
  printf ']'
}
# Since when a condition holds: the first run that saw it, forgotten as soon as it no longer holds.
since() { # $1 key, $2 1|0, $3 optional first time (ISO) when it is first seen
  local file="$STATE_DIR/since.$1"
  if [[ "$2" == 1 ]]; then
    [[ -s "$file" ]] || { if [[ -n "${3:-}" ]]; then printf '%s\n' "$3"; else iso "$now_epoch"; fi; } > "$file"
    cat "$file"
  else
    rm -f "$file"
  fi
}
mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"

# --- Package lists ---
lists_refresh=null
if [[ "$APT_UPDATE" == 1 && -z "${HS_APT_LIST_FILE:-}" ]]; then
  if timeout 900 apt-get update -qq >/dev/null 2>&1; then lists_refresh='"ok"'; else lists_refresh='"failed"'; fi
fi
apt_list_ok=true
if [[ -n "${HS_APT_LIST_FILE:-}" ]]; then list="$(cat "$HS_APT_LIST_FILE")" || { list=""; apt_list_ok=false; }
else list="$(LC_ALL=C apt list --upgradable 2>/dev/null)" || { list=""; apt_list_ok=false; }
fi
# Ubuntu's phased updates (2026-11-14): a package Ubuntu rolls out to a share of the servers at a time is listed as upgradable,
# but apt itself holds it back ("deferred due to phasing") until this server's turn – nothing to do, so it is not pending.
# apt-get -s only simulates (changes nothing). HS_APT_PHASED_FILE gives the simulation's output in the tests.
if [[ -n "${HS_APT_PHASED_FILE:-}" ]]; then simulation="$(cat "$HS_APT_PHASED_FILE" 2>/dev/null || true)"
elif [[ -n "${HS_APT_LIST_FILE:-}" ]]; then simulation=""
else simulation="$(LC_ALL=C apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null || true)"
fi
phased=" "
in_phased=false
while IFS= read -r line; do
  if [[ "$line" == "The following upgrades have been deferred due to phasing:"* ]]; then in_phased=true; continue; fi
  if $in_phased; then
    if [[ "$line" =~ ^[[:space:]]+[a-z0-9] ]]; then for word in $line; do phased+="$word "; done; else in_phased=false; fi
  fi
done <<< "$simulation"
phased_count=0
pending=()
security=()
while IFS= read -r line; do
  [[ "$line" =~ ^[a-z0-9][a-z0-9.+-]*/[^[:space:]]+[[:space:]] ]] || continue
  name="${line%%/*}"
  rest="${line#*/}"
  suites="${rest%%[[:space:]]*}"
  if [[ "$phased" == *" $name "* && "$suites" != *-security* ]]; then phased_count=$((phased_count + 1)); continue; fi
  pending+=("$name")
  if [[ "$suites" == *-security* ]]; then security+=("$name"); fi
done <<< "$list"
lists_at="$(find "$R/var/lib/apt/lists" -maxdepth 1 -type f -name '*Packages*' -printf '%T@\n' 2>/dev/null | sort -n | tail -n 1 | cut -d. -f1)"

# --- Kernel, uptime, restart ---
kernel="${HS_KERNEL:-$(uname -r)}"
newest_kernel="$(find "$R/boot" -maxdepth 1 -name 'vmlinuz-*' -printf '%f\n' 2>/dev/null | sed 's/^vmlinuz-//' | sort -V | tail -n 1)"
uptime_seconds="$(cut -d. -f1 "$R/proc/uptime" 2>/dev/null || echo "")"
[[ "$uptime_seconds" =~ ^[0-9]+$ ]] || uptime_seconds=null
reboot_flag="$R/var/run/reboot-required"
reboot_required=false
reboot_pkgs=()
if [[ -e "$reboot_flag" ]]; then
  reboot_required=true
  if [[ -r "$reboot_flag.pkgs" ]]; then mapfile -t reboot_pkgs < <(sort -u "$reboot_flag.pkgs"); fi
fi
kernel_newer=false
if [[ -n "$newest_kernel" && "$newest_kernel" != "$kernel" ]]; then
  if [[ "$(printf '%s\n%s\n' "$kernel" "$newest_kernel" | sort -V | tail -n 1)" == "$newest_kernel" ]]; then kernel_newer=true; fi
fi

# --- Automatic security updates: the effective values after every file in apt.conf.d ---
if [[ -n "${HS_APT_CONFIG_FILE:-}" ]]; then config="$(cat "$HS_APT_CONFIG_FILE" 2>/dev/null || true)"; else config="$(apt-config dump 2>/dev/null || true)"; fi
periodic() { printf '%s\n' "$config" | sed -n "s/^APT::Periodic::$1 \"\(.*\)\";\$/\1/p" | tail -n 1; }
p_enable="$(periodic Enable)"
p_lists="$(periodic Update-Package-Lists)"
p_upgrade="$(periodic Unattended-Upgrade)"
on() { [[ -n "$1" && "$1" != 0 && "$1" != false ]]; }
unattended_installed=false
if [[ -x "$R/usr/bin/unattended-upgrade" ]]; then unattended_installed=true; fi
if [[ -n "${HS_TIMER:-}" ]]; then timer="$HS_TIMER"
elif command -v systemctl >/dev/null 2>&1; then timer="$(systemctl is-enabled apt-daily-upgrade.timer 2>/dev/null || true)"; timer="${timer:-unknown}"
else timer=unknown
fi
[[ "$timer" =~ ^[a-z-]{1,20}$ ]] || timer=unknown
effective=false
if { [[ -z "$p_enable" ]] || on "$p_enable"; } && on "$p_lists" && on "$p_upgrade" && [[ "$unattended_installed" == true ]] && [[ "$timer" != disabled && "$timer" != masked ]]; then effective=true; fi
zero_files=()
for file in "$R"/etc/apt/apt.conf.d/*; do
  [[ -f "$file" ]] || continue
  if grep -Eq 'APT::Periodic::(Enable|Update-Package-Lists|Unattended-Upgrade)[[:space:]]+"(0|false)"' "$file" 2>/dev/null; then zero_files+=("$(basename "$file")"); fi
done
stamps="$R/var/lib/apt/periodic"

# Each package that needs a restart touches the flag again, so its time is only the start the first time it is seen.
reboot_since="$(since reboot "$([[ "$reboot_required" == true || "$kernel_newer" == true ]] && echo 1 || echo 0)" "$([[ "$reboot_required" == true ]] && mtime_iso "$reboot_flag")")"
security_since="$(since security "$([[ ${#security[@]} -gt 0 ]] && echo 1 || echo 0)")"
off_since="$(since automatic-off "$([[ "$effective" == false ]] && echo 1 || echo 0)")"
os_name="$(sed -n 's/^PRETTY_NAME=//p' "$R/etc/os-release" 2>/dev/null | head -n 1 | tr -d '"')"

json="$(
  printf '{\n'
  printf '  "schema": 1,\n'
  printf '  "host": "%s",\n' "$HOST_LABEL"
  printf '  "generatedAt": "%s",\n' "$(iso "$now_epoch")"
  printf '  "os": %s,\n' "$(jstr "$os_name")"
  printf '  "kernel": { "running": %s, "newestInstalled": %s, "newerInstalled": %s },\n' "$(jstr "$kernel")" "$(jstr "$newest_kernel")" "$kernel_newer"
  printf '  "uptimeSeconds": %s,\n' "$uptime_seconds"
  printf '  "updates": { "listOk": %s, "pending": %s, "security": %s, "securityPackages": %s, "packages": %s, "securitySince": %s, "listsUpdatedAt": %s, "listsRefresh": %s },\n' \
    "$apt_list_ok" "${#pending[@]}" "${#security[@]}" "$(jnames 100 "${security[@]}")" "$(jnames 200 "${pending[@]}")" "$(jstr "$security_since")" \
    "$(jstr "$([[ -n "$lists_at" ]] && iso "$lists_at")")" "$lists_refresh"
  printf '  "reboot": { "required": %s, "since": %s, "packages": %s },\n' "$reboot_required" "$(jstr "$reboot_since")" "$(jnames 50 "${reboot_pkgs[@]}")"
  printf '  "automatic": { "effective": %s, "enable": %s, "updatePackageLists": %s, "unattendedUpgrade": %s, "unattendedInstalled": %s, "timer": "%s", "zeroFiles": %s, "offSince": %s },\n' \
    "$effective" "$(jstr "$p_enable")" "$(jstr "$p_lists")" "$(jstr "$p_upgrade")" "$unattended_installed" "$timer" "$(jnames 20 "${zero_files[@]}")" "$(jstr "$off_since")"
  printf '  "apt": { "updateSuccess": %s, "update": %s, "downloadUpgradeable": %s, "upgrade": %s, "unattendedUpgrades": %s }\n' \
    "$(jstr "$(mtime_iso "$stamps/update-success-stamp")")" "$(jstr "$(mtime_iso "$stamps/update-stamp")")" "$(jstr "$(mtime_iso "$stamps/download-upgradeable-stamp")")" \
    "$(jstr "$(mtime_iso "$stamps/upgrade-stamp")")" "$(jstr "$(mtime_iso "$stamps/unattended-upgrades-stamp")")"
  printf '}\n'
)"

# Written beside the old file and moved over it, readable by everyone (the app reads it as its own user), owned by root.
mkdir -p "$OUT_DIR"
chmod 755 "$OUT_DIR"
tmp="$(mktemp "$OUT_DIR/.host-status.XXXXXX")"
printf '%s' "$json" > "$tmp"
chmod 644 "$tmp"
mv -f "$tmp" "$OUT_DIR/$HOST_LABEL.json"
echo "host-status: $HOST_LABEL $(iso "$now_epoch") – ${#pending[@]} väntande (${phased_count} stegvis utrullade räknas inte), ${#security[@]} säkerhet, omstart $reboot_required, automatik $effective"
