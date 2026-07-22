#!/bin/sh
set -e

APP_DIR="/mnt/data/wb-rosdomofon"
REPO_URL="https://github.com/VolchkovVlad/wb-rosdomofon.git"

CFG_FILE="/mnt/data/wb-rosdomofon.cfg"
CFG_EXAMPLE="./examples/wb-rosdomofon.cfg.example"

SCHEMA_DIR="/usr/share/wb-mqtt-confed/schemas"
SCHEMA_FILE="$SCHEMA_DIR/wb-rosdomofon.schema.json"

MENU_DIR="/usr/share/wb-mqtt-homeui/custom-menu"
MENU_FILE="$MENU_DIR/wb-rosdomofon.json"

SERVICE_FILE="/etc/systemd/system/wb-rosdomofon.service"

echo "[wb-rosdomofon] Installer started"

# =========================
# REMOTE MODE (curl | sh)
# =========================
if [ ! -f "package.json" ]; then
  echo "[wb-rosdomofon] Remote install mode detected"

  if ! command -v git >/dev/null 2>&1; then
    echo "[wb-rosdomofon] git not found, installing..."
    apt update
    apt install -y git
  fi

  echo "[wb-rosdomofon] Downloading repository..."
  cd /mnt/data
  rm -rf "$APP_DIR"
  git clone "$REPO_URL"
  cd "$APP_DIR"

  chmod +x install.sh
  exec ./install.sh
fi

# =========================
# LOCAL MODE
# =========================
echo "[wb-rosdomofon] Local install mode"

# 1. Schema
echo "[wb-rosdomofon] Installing wb-mqtt-confed schema"
mkdir -p "$SCHEMA_DIR"
cp ./schema/wb-rosdomofon.schema.json "$SCHEMA_FILE"
chmod 644 "$SCHEMA_FILE"

# 2. HomeUI custom menu
echo "[wb-rosdomofon] Installing HomeUI menu"
mkdir -p "$MENU_DIR"
cp ./wb-rosdomofon.json "$MENU_FILE"
chmod 644 "$MENU_FILE"

# 3. Config (только если нет)
if [ ! -f "$CFG_FILE" ]; then
  echo "[wb-rosdomofon] Config not found, creating from example"
  cp "$CFG_EXAMPLE" "$CFG_FILE"
else
  echo "[wb-rosdomofon] Config already exists, keeping it"
fi

# 4. Dependencies
echo "[wb-rosdomofon] Installing Node.js dependencies"
cd "$APP_DIR"
npm install --production

# 5. systemd
echo "[wb-rosdomofon] Installing systemd service"
cp ./systemd/wb-rosdomofon.service "$SERVICE_FILE"

systemctl daemon-reload
systemctl enable wb-rosdomofon.service
systemctl restart wb-rosdomofon.service

echo "[wb-rosdomofon] Installation completed successfully"