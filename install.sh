#!/bin/sh
set -e

echo "[wb-rosdomofon] Installing..."

APP_DIR="/mnt/data/wb-rosdomofon"
SCHEMA_DIR="/usr/share/wb-mqtt-confed/schemas"
SERVICE_FILE="/etc/systemd/system/wb-rosdomofon.service"

echo "[1/5] Copy application files"
mkdir -p "$APP_DIR"
cp -r ./src "$APP_DIR/"
cp package*.json "$APP_DIR/"
cp README.md "$APP_DIR/"

echo "[2/5] Install schema"
mkdir -p "$SCHEMA_DIR"
cp ./schema/wb-rosdomofon.schema.json "$SCHEMA_DIR/"

echo "[3/5] Install node dependencies"
cd "$APP_DIR"
npm install --production

echo "[4/5] Install systemd service"
cp ./systemd/wb-rosdomofon.service "$SERVICE_FILE"
systemctl daemon-reload

echo "[5/5] Enable and start service"
systemctl enable wb-rosdomofon.service
systemctl restart wb-rosdomofon.service

echo "[wb-rosdomofon] Installation completed"