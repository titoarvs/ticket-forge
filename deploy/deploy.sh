#!/usr/bin/env bash
# Deploys TicketForge from this computer to your server (Ubuntu), over SSH.
#
#   bash deploy/deploy.sh ubuntu@203.0.113.10                      first run sets the server up, then deploys
#   bash deploy/deploy.sh ubuntu@203.0.113.10 tickets.example.com  use your own domain for HTTPS
#   bash deploy/deploy.sh ubuntu@203.0.113.10 --env                also replace the server's .env with this one
#   SSH_KEY=~/Downloads/ssh-key.key bash deploy/deploy.sh ubuntu@203.0.113.10   use a specific SSH key
#
# Run the same command again to ship updates.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { echo "Usage: bash deploy/deploy.sh user@server-ip [domain] [--env]" >&2; exit 1; }
TARGET="${1:-}"; [ -n "$TARGET" ] || usage; shift
DOMAIN=""; SEND_ENV=0
for a in "$@"; do
  case "$a" in
    --env) SEND_ENV=1 ;;
    -*) echo "Unknown option: $a" >&2; usage ;;
    *) DOMAIN="$a" ;;
  esac
done

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
if [ -n "${SSH_KEY:-}" ]; then
  KEY="${SSH_KEY/#\~/$HOME}"
  [ -f "$KEY" ] || { echo "SSH key not found: $KEY" >&2; exit 1; }
  chmod 600 "$KEY" 2>/dev/null || true
  SSH_OPTS+=(-i "$KEY")
fi
REMOTE_SRC=ticketforge-src   # in the SSH user's home folder
sshr() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }
rsh() { printf 'ssh'; printf ' %q' "${SSH_OPTS[@]}"; }

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

log "Connecting to $TARGET"
sshr 'sudo -n true' 2>/dev/null || { echo "Can't run sudo without a password on $TARGET. Use the server's default admin user (e.g. ubuntu)." >&2; exit 1; }
SET_UP=$(sshr 'test -f /etc/systemd/system/ticketforge.service && echo yes || echo no')
HAS_ENV=$(sshr 'sudo test -f /opt/ticketforge/app/.env && echo yes || echo no')

log "Uploading the code"
rsync -az --delete -e "$(rsh)" \
  --exclude node_modules --exclude .next --exclude data --exclude .git --exclude .claude \
  --exclude .env --exclude .env.local --exclude '.env.*.local' --exclude tsconfig.tsbuildinfo --exclude .DS_Store \
  ./ "$TARGET:$REMOTE_SRC/"

if [ "$SEND_ENV" = 1 ] || [ "$HAS_ENV" = no ]; then
  if [ -f .env ]; then
    log "Uploading .env (database, email and other settings)"
    rsync -az -e "$(rsh)" --chmod=F600 .env "$TARGET:$REMOTE_SRC/.env"
  else
    echo "No .env here to upload; the server will use the built-in local database." >&2
  fi
fi

if [ "$SET_UP" = no ] || [ -n "$DOMAIN" ]; then
  log "Setting up the server (first time takes a few minutes)"
  sshr -t "sudo bash $REMOTE_SRC/deploy/server-setup.sh $(printf '%q' "$DOMAIN")"
fi

log "Installing, building and restarting on the server"
sshr -t "sudo bash $REMOTE_SRC/deploy/server-update.sh \"\$HOME/$REMOTE_SRC\""
