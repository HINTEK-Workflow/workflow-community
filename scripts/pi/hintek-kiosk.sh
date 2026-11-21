#!/usr/bin/env bash
# Tavlor och skärmar (2026-11-18, docs/drift/SKARMAR.md): a Raspberry Pi 4/5 with Raspberry Pi OS Desktop (labwc) as a fixed screen.
# Starts Chromium in kiosk mode on Workflow's /skarm at every boot, keeps the screen from blanking and starts the browser again if
# it closes. No network settings are changed and nothing is downloaded.
#
#   sudo bash hintek-kiosk.sh https://app.hintekwork.com/skarm     install (for the desktop user)
#   sudo bash hintek-kiosk.sh --remove                              remove what it installed
set -euo pipefail

user="${SUDO_USER:-$(logname 2>/dev/null || echo pi)}"
home="$(getent passwd "$user" | cut -d: -f6)"
autostart="$home/.config/labwc/autostart"
runner="/usr/local/bin/hintek-kiosk"
marker="# hintek-kiosk"

if [[ "${1:-}" == "--remove" ]]; then
  [[ -f "$autostart" ]] && sed -i "/$marker/d" "$autostart"
  rm -f "$runner"
  echo "Borttaget. Starta om för att lämna kioskläget."
  exit 0
fi

url="${1:-}"
if [[ ! "$url" =~ ^https?://[^[:space:]]+/skarm/?$ ]]; then
  echo "Ange Workflows skärmadress, till exempel: sudo bash $0 https://app.hintekwork.com/skarm" >&2
  exit 1
fi
browser="$(command -v chromium-browser || command -v chromium || true)"
if [[ -z "$browser" ]]; then
  echo "Chromium saknas. Installera Raspberry Pi OS med skrivbord (Chromium följer med)." >&2
  exit 1
fi

cat > "$runner" <<RUNNER
#!/usr/bin/env bash
# Started by labwc's autostart: the screen never blanks, and the browser comes back if it closes.
xset s off -dpms 2>/dev/null || true
while true; do
  "$browser" --kiosk --noerrdialogs --disable-infobars --no-first-run --disable-session-crashed-bubble --check-for-update-interval=31536000 "$url"
  sleep 5
done
RUNNER
chmod 755 "$runner"

mkdir -p "$(dirname "$autostart")"
touch "$autostart"
sed -i "/$marker/d" "$autostart"
echo "$runner & $marker" >> "$autostart"
chown -R "$user":"$user" "$home/.config/labwc"
echo "Klart. Starta om: skärmen öppnar $url och visar en kod att koppla i Workflow."
