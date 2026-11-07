#!/usr/bin/env bash
# One-time setup of an Ubuntu server (22.04 / 24.04) for TicketForge. Safe to run again.
# deploy.sh runs this for you. By hand, on the server:  sudo bash server-setup.sh [your-domain]
#
# Without a domain the app gets a free HTTPS address: <ip-with-dashes>.sslip.io
set -euo pipefail

DOMAIN="${1:-}"
APP_USER=ticketforge
BASE=/opt/ticketforge
APP_DIR=$BASE/app
DATA_DIR=$BASE/data
PORT=3000
PLAYWRIGHT_VERSION=1.65

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this with sudo." >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "Note: written for Ubuntu; continuing on ${PRETTY_NAME:-this system}."
export DEBIAN_FRONTEND=noninteractive

log "Installing base packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg rsync build-essential debian-keyring debian-archive-keyring apt-transport-https

if ! swapon --show --noheadings | grep -q .; then
  log "Adding 2 GB of swap so the build fits on small (1 GB) machines"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

node_major() { if command -v node >/dev/null; then node -p 'process.versions.node.split(".")[0]'; else echo 0; fi; }
if [ "$(node_major)" -lt 22 ]; then
  log "Installing Node.js (current LTS)"
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
  apt-get install -y nodejs
fi
echo "Node $(node -v), npm $(npm -v)"

log "Creating the '$APP_USER' user and $BASE"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"
chown -R "$APP_USER:$APP_USER" "$BASE"
chmod 750 "$BASE"

log "Installing the system libraries Chromium needs (test automation)"
npx -y "playwright@$PLAYWRIGHT_VERSION" install-deps chromium

log "Installing Claude Code for '$APP_USER'"
if sudo -u "$APP_USER" -H bash -c 'test -x "$HOME/.local/bin/claude"'; then
  echo "Already installed."
else
  sudo -u "$APP_USER" -H bash -c 'curl -fsSL https://claude.ai/install.sh | bash' \
    || echo "Claude Code didn't install; you can install it later in TicketForge under Administration → Claude."
fi

PUBLIC_IP=$(curl -fsS4 --max-time 10 https://api.ipify.org || curl -fsS4 --max-time 10 https://ifconfig.me || hostname -I | awk '{print $1}')
[ -n "$DOMAIN" ] || DOMAIN="$(echo "$PUBLIC_IP" | tr . -).sslip.io"
APP_URL="https://$DOMAIN"
echo "$APP_URL" > "$BASE/app-url"

log "Installing the TicketForge service"
cat > /etc/systemd/system/ticketforge.service <<EOF
[Unit]
Description=TicketForge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=HOME=/home/$APP_USER
Environment=PATH=/home/$APP_USER/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=TICKETFORGE_DATA=$DATA_DIR
Environment=APP_URL=$APP_URL
ExecStart=/usr/bin/env node node_modules/next/dist/bin/next start -p $PORT -H 127.0.0.1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable ticketforge >/dev/null 2>&1

log "Installing Caddy (web server with automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	reverse_proxy 127.0.0.1:$PORT {
		# Stream generation progress and test results as they happen.
		flush_interval -1
	}
}
EOF
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy

log "Opening ports 80 and 443 in the server's firewall"
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi
# Oracle Cloud's Ubuntu images reject everything except SSH with iptables.
if iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
  for p in 80 443; do
    iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -p tcp -m state --state NEW --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi
fi

log "Server ready"
echo "TicketForge will be at: $APP_URL"
echo "Also open ports 80 and 443 in your cloud provider's firewall (see deploy/README.md)."
