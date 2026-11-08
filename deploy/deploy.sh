#!/usr/bin/env bash
# Deploys TicketForge from this computer to your server (Ubuntu or Amazon Linux 2023), over SSH.
#
#   bash deploy/deploy.sh ubuntu@203.0.113.10                      first run sets the server up, then deploys
#   bash deploy/deploy.sh ubuntu@203.0.113.10 tickets.example.com  use your own domain for HTTPS
#   bash deploy/deploy.sh ubuntu@203.0.113.10 --env                also replace the server's .env with this one
#   SSH_KEY=~/Downloads/ticketforge.pem bash deploy/deploy.sh ec2-user@203.0.113.10   use a specific SSH key (Amazon Linux user)
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

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ConnectTimeout=20)
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
sshr 'sudo -n true' 2>/dev/null || { echo "Can't run sudo without a password on $TARGET. Use the server's default admin user: ubuntu on Ubuntu, ec2-user on Amazon Linux." >&2; exit 1; }
SET_UP=$(sshr 'test -f /opt/ticketforge/.setup-complete && echo yes || echo no')
HAS_ENV=$(sshr 'sudo test -f /opt/ticketforge/app/.env && echo yes || echo no')

log "Uploading the code"
rsync -az --delete -e "$(rsh)" \
  --exclude node_modules --exclude .next --exclude data --exclude .git --exclude .claude \
  --exclude .env --exclude .env.local --exclude '.env.*.local' --exclude tsconfig.tsbuildinfo --exclude .DS_Store \
  ./ "$TARGET:$REMOTE_SRC/"

if [ "$SEND_ENV" = 1 ] || [ "$HAS_ENV" = no ]; then
  if [ -f .env ]; then
    log "Uploading .env (database, email and other settings)"
    # Readable only by the SSH user (macOS's rsync has no --chmod).
    sshr "umask 077 && cat > $REMOTE_SRC/.env" < .env
  else
    echo "No .env here to upload; the server will use the built-in local database." >&2
  fi
fi

# The long part runs on the server in the background, so a dropped connection (Wi-Fi or network
# switching) doesn't stop it. This script follows its log and reconnects as needed.
SETUP=0
if [ "$SET_UP" = no ] || [ -n "$DOMAIN" ]; then SETUP=1; fi
if sshr 'systemctl is-active --quiet ticketforge-deploy'; then
  log "A deploy is already running on the server; following it"
else
  if [ "$SETUP" = 1 ]; then log "Setting up the server and deploying (first time takes 10-15 minutes)"; else log "Installing, building and restarting on the server"; fi
  sshr "sudo systemd-run --unit=ticketforge-deploy --collect --quiet bash \"\$HOME/$REMOTE_SRC/deploy/server-run.sh\" $SETUP $(printf '%q' "$DOMAIN") \"\$HOME/$REMOTE_SRC\""
fi

seen=0; fails=0
while :; do
  if out=$(sshr "sudo bash \"\$HOME/$REMOTE_SRC/deploy/server-log.sh\" $seen" 2>/dev/null); then
    [ "$fails" -gt 0 ] && echo "(reconnected)"
    fails=0
    printf '%s\n' "$out" | grep -v '^@@TOTAL ' || true
    total=$(printf '%s\n' "$out" | sed -n 's/^@@TOTAL //p' | tail -1)
    [ -n "$total" ] && seen=$total
    code=$(printf '%s\n' "$out" | sed -n 's/^TICKETFORGE_DEPLOY_EXIT=//p' | tail -1)
    if [ -n "$code" ]; then
      [ "$code" = 0 ] && exit 0
      echo "The deploy failed on the server (exit code $code); see the lines above." >&2
      exit "$code"
    fi
  else
    fails=$((fails + 1))
    [ "$fails" = 1 ] && echo "(connection to the server lost; the deploy keeps running there, reconnecting...)" >&2
    if [ "$fails" -ge 120 ]; then
      echo "Couldn't reach the server for 10 minutes. The deploy may still finish; run this command again to follow it." >&2
      exit 1
    fi
  fi
  sleep 5
done
