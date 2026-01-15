#!/bin/sh
set -e

APP_DIR="/mnt/data/wb-rosdomofon"

echo "[wb-rosdomofon] Downloading..."

cd /mnt/data
rm -rf "$APP_DIR"

git clone https://github.com/VolchkovVlad/wb-rosdomofon.git
cd wb-rosdomofon

chmod +x install.sh
./install.sh