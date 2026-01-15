#!/bin/sh
set -e

APP_DIR="/mnt/data/wb-rosdomofon"

echo "[wb-rosdomofon] Starting remote installation..."

# Проверка git
if ! command -v git >/dev/null 2>&1; then
  echo "[wb-rosdomofon] git not found, installing..."
  apt update
  apt install -y git
else
  echo "[wb-rosdomofon] git already installed"
fi

echo "[wb-rosdomofon] Downloading repository..."

cd /mnt/data
rm -rf "$APP_DIR"

git clone https://github.com/VolchkovVlad/wb-rosdomofon.git
cd wb-rosdomofon

chmod +x install.sh
./install.sh
