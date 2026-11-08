#!/usr/bin/env bash
# Runs a deploy on the server in the background: setup (optional), then update, logging to
# /var/log/ticketforge-deploy.log. deploy.sh starts this with systemd-run and follows the log, so a dropped
# SSH connection (Wi-Fi or network switching) doesn't stop the deploy.
#   sudo systemd-run --unit=ticketforge-deploy bash server-run.sh <setup 0|1> <domain or ''> <uploaded-folder>
set -uo pipefail
SETUP="${1:?}"
DOMAIN="${2:-}"
SRC="${3:?}"
LOG=/var/log/ticketforge-deploy.log
DIR="$(cd "$(dirname "$0")" && pwd)"
export HOME=/root
: > "$LOG"
chmod 600 "$LOG"
{
  code=0
  if [ "$SETUP" = 1 ]; then bash "$DIR/server-setup.sh" "$DOMAIN" || code=$?; fi
  if [ "$code" = 0 ]; then bash "$DIR/server-update.sh" "$SRC" || code=$?; fi
  echo "TICKETFORGE_DEPLOY_EXIT=$code"
} >> "$LOG" 2>&1
