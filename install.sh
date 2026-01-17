#!/bin/sh
set -e

APP_DIR="/mnt/data/wb-rosdomofon"
REPO_URL="https://github.com/VolchkovVlad/wb-rosdomofon.git"

CFG_FILE="/mnt/data/wb-rosdomofon.cfg"
CFG_EXAMPLE="./examples/wb-rosdomofon.cfg.example"
SCHEMA_DIR="/usr/share/wb-mqtt-confed/schemas"
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
  cd wb-rosdomofon

  chmod +x install.sh
  exec ./install.sh
fi

# =========================
# LOCAL MODE
# =========================
echo "[wb-rosdomofon] Local install mode"

# 1. Schema
mkdir -p "$SCHEMA_DIR"
cp ./schema/wb-rosdomofon.schema.json "$SCHEMA_DIR/"

# 2. Config (только если нет)
if [ ! -f "$CFG_FILE" ]; then
  echo "[wb-rosdomofon] Config not found, creating from example"
  cp "$CFG_EXAMPLE" "$CFG_FILE"
else
  echo "[wb-rosdomofon] Config already exists, keeping it"
fi

# 3. Dependencies
cd "$APP_DIR"
npm install --production

# 4. systemd
cp ./systemd/wb-rosdomofon.service "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable wb-rosdomofon.service
systemctl restart wb-rosdomofon.service

echo "[wb-rosdomofon] Installation completed successfully"
