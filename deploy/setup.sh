#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
DUCK_TOKEN="${2:-}"
USER_HOME="${3:-$HOME}"
APP_DIR="$USER_HOME/sismoalert"
PUBLIC_IP="$(curl -fsSL --max-time 10 https://ifconfig.me || echo '')"

echo "=================================================="
echo "  SismoAlert - instalacion en Oracle Cloud Free"
echo "  Dominio: $DOMAIN | IP: $PUBLIC_IP"
echo "=================================================="

if [ -z "$DOMAIN" ] || [ -z "$DUCK_TOKEN" ]; then
  echo "USO: bash setup.sh <subdominio.duckdns.org> <token-duckdns>"
  echo "Ejemplo: bash setup.sh sismoalert.duckdns.org abc123token"
  exit 1
fi

if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  NODE_VER="v24.15.0"
  sudo apt-get update -y
  sudo apt-get install -y curl ca-certificates xz-utils unzip cron
elif command -v dnf >/dev/null; then
  NODE_VER="v22.19.0"
  sudo dnf install -y curl tar xz unzip cronie
  sudo systemctl enable --now crond || true
else
  echo "ERROR: no se reconoce el gestor de paquetes (apt/dnf)"
  exit 1
fi

echo "==> [1/6] Node.js $NODE_VER"
if ! command -v node || [ "$(node -v 2>/dev/null || echo '')" != "$NODE_VER" ]; then
  curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz"
  sudo mkdir -p "/usr/local/node-$NODE_VER-linux-x64"
  sudo tar -xJf /tmp/node.tar.xz -C /usr/local
  sudo ln -sf "/usr/local/node-$NODE_VER-linux-x64/bin/node" /usr/local/bin/node
  sudo ln -sf "/usr/local/node-$NODE_VER-linux-x64/bin/npm" /usr/local/bin/npm
  sudo ln -sf "/usr/local/node-$NODE_VER-linux-x64/bin/npx" /usr/local/bin/npx
  rm -f /tmp/node.tar.xz
fi
node --version

echo "==> [2/6] Caddy (HTTPS automatico)"
if ! command -v caddy; then
  curl -fsSL -o /tmp/caddy.tar.gz "https://caddyserver.com/api/download?os=linux&arch=amd64"
  sudo tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy
  rm -f /tmp/caddy.tar.gz
fi
caddy version

echo "==> [3/6] Codigo de la app"
mkdir -p "$APP_DIR"
if [ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
  if [ -f "$USER_HOME/sismoalert.zip" ]; then
    unzip -q -o "$USER_HOME/sismoalert.zip" -d "$APP_DIR"
  else
    echo "ERROR: no encuentro sismoalert.zip en $USER_HOME"
    exit 1
  fi
fi
cd "$APP_DIR"
sudo chown -R "$(whoami)" "$APP_DIR"
npm install --omit=dev

echo "==> [4/6] DuckDNS (dominio gratuito)"
curl -fsSL "https://www.duckdns.org/update?domains=${DOMAIN%.duckdns.org}&token=$DUCK_TOKEN&ip=" || \
  curl -fsSL "https://www.duckdns.org/update?domains=$DOMAIN&token=$DUCK_TOKEN&ip=" || true
CRON_CMD="*/5 * * * * curl -fsSL 'https://www.duckdns.org/update?domains=${DOMAIN%.duckdns.org}&token=$DUCK_TOKEN&ip=' >/dev/null 2>&1"
( crontab -l 2>/dev/null | grep -v duckdns || true; echo "$CRON_CMD" ) | crontab -
echo "DuckDNS actualizado ($DOMAIN -> $PUBLIC_IP)"

echo "==> [5/6] Servicios systemd"
sudo mkdir -p /etc/caddy
sudo tee /etc/systemd/system/sismoalert.service >/dev/null <<EOF
[Unit]
Description=SismoAlert - aviso sismico PWA
After=network-online.target

[Service]
Type=simple
ExecStart=$(which node) src/server.js
WorkingDirectory=$APP_DIR
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
EOF

sudo systemctl daemon-reload
sudo systemctl enable sismoalert
sudo systemctl restart sismoalert

if command -v systemctl >/dev/null && systemctl list-unit-files | grep -q '^caddy'; then
  sudo systemctl enable caddy
  sudo systemctl restart caddy
else
  sudo tee /etc/systemd/system/caddy.service >/dev/null <<'EOF2'
[Unit]
Description=Caddy web server
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF2
  sudo systemctl daemon-reload
  sudo systemctl enable caddy
  sudo systemctl start caddy
fi

echo "==> [6/6] Verificacion"
sleep 5
echo "--- Estado sismoalert ---"
systemctl is-active sismoalert || true
echo "--- Estado caddy ---"
systemctl is-active caddy || true
echo "--- Health local ---"
curl -fsS http://127.0.0.1:3000/api/health || echo "health fallo (aun arrancando?)"
echo
echo "=================================================="
echo "  LISTO. Abre: https://$DOMAIN"
echo "  Logs: journalctl -u sismoalert -f"
echo "=================================================="