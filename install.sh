#!/bin/sh
set -e

APP_DIR="/mnt/data/wb-rosdomofon"
CFG_FILE="/mnt/data/wb-rosdomofon/wb-rosdomofon.cfg"
CFG_EXAMPLE="./examples/wb-rosdomofon.cfg.example"
SCHEMA_DIR="/usr/share/wb-mqtt-confed/schemas"
SERVICE_FILE="/etc/systemd/system/wb-rosdomofon.service"

echo "[wb-rosdomofon] Installing..."

# 1. Код
APP_DIR="/mnt/data/wb-rosdomofon"

# 2. Schema
mkdir -p "$SCHEMA_DIR"
cp ./schema/wb-rosdomofon.schema.json "$SCHEMA_DIR/"

# 3. Config (ТОЛЬКО если нет)
if [ ! -f "$CFG_FILE" ]; then
  echo "[wb-rosdomofon] Config not found, creating from example"
  cp "$CFG_EXAMPLE" "$CFG_FILE"
else
  echo "[wb-rosdomofon] Config already exists, keeping it"
fi

# 4. Dependencies
cd "$APP_DIR"
npm install --production

# 5. systemd
cp ./systemd/wb-rosdomofon.service "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable wb-rosdomofon.service
systemctl restart wb-rosdomofon.service

echo "[wb-rosdomofon] Installation completed"
