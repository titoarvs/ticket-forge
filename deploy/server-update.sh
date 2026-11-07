#!/usr/bin/env bash
# Installs uploaded TicketForge code, builds it and restarts the service.
# deploy.sh runs this for you:  sudo bash server-update.sh <uploaded-folder>
set -euo pipefail

SRC="${1:?Usage: sudo bash server-update.sh <uploaded-folder>}"
APP_USER=ticketforge
BASE=/opt/ticketforge
APP_DIR=$BASE/app
PORT=3000

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this with sudo." >&2; exit 1; }
[ -f /etc/systemd/system/ticketforge.service ] || { echo "Run server-setup.sh first." >&2; exit 1; }
[ -f "$SRC/package.json" ] || { echo "No TicketForge code in $SRC." >&2; exit 1; }
as_app() { sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && $*"; }

log "Copying the code into $APP_DIR"
rsync -a --delete \
  --exclude .env --exclude node_modules --exclude .next --exclude data --exclude .git \
  "$SRC/" "$APP_DIR/"
if [ -f "$SRC/.env" ]; then
  echo "Installing the uploaded .env"
  install -m 600 -o "$APP_USER" -g "$APP_USER" "$SRC/.env" "$APP_DIR/.env"
  rm -f "$SRC/.env"
fi
[ -f "$APP_DIR/.env" ] || echo "Warning: no .env on the server yet; TicketForge will use its built-in local database."
chown -R "$APP_USER:$APP_USER" "$BASE"

log "Installing packages"
as_app "npm ci --no-audit --no-fund"

log "Making sure the test browser is installed"
as_app "npx playwright install chromium"

log "Building"
as_app "npm run build"

log "Restarting TicketForge"
systemctl restart ticketforge
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login"; then
    log "TicketForge is running at $(cat "$BASE/app-url" 2>/dev/null || echo "http://<server>")"
    exit 0
  fi
  sleep 2
done
echo "TicketForge didn't answer after a minute. Its log:" >&2
journalctl -u ticketforge -n 60 --no-pager >&2
exit 1
