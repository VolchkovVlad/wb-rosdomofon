#!/bin/sh
set -e

SERVICE="wb-rosdomofon"
APP_DIR="/mnt/data/wb-rosdomofon"
CFG_FILE="/mnt/data/wb-rosdomofon.cfg"
SCHEMA="/usr/share/wb-mqtt-confed/schemas/wb-rosdomofon.schema.json"
UNIT="/etc/systemd/system/wb-rosdomofon.service"

echo "[wb-rosdomofon] Uninstalling..."

systemctl stop "$SERVICE" || true
systemctl disable "$SERVICE" || true

rm -f "$UNIT"
systemctl daemon-reload

rm -rf "$APP_DIR"
rm -f "$SCHEMA"

echo "[wb-rosdomofon] Uninstalled."

echo
echo "⚠ Config file was NOT removed:"
echo "  $CFG_FILE"
echo "Remove it manually if needed."
