#!/usr/bin/env bash
# Push repo agent-games-steal-the-vfy ke GitHub (JM-03).
# Token diambil HANYA dari environment variable GITHUB_TOKEN.
# Token TIDAK PERNAH ditulis di file ini.
# Cara pakai (lihat PUSH_GUIDE.md):
#   export GITHUB_TOKEN="isi-token-di-sini"
#   ./push.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "GITHUB_TOKEN belum diisi." >&2
  echo "Buat token dulu (lihat PUSH_GUIDE.md), lalu jalankan:" >&2
  echo "  export GITHUB_TOKEN=\"<token-kamu>\"" >&2
  echo "  ./push.sh" >&2
  exit 1
fi

git push -u "https://x-access-token:${GITHUB_TOKEN}@github.com/JM-03/agent-games-steal-the-vfy.git" main
echo "Selesai. Cek di https://github.com/JM-03/agent-games-steal-the-vfy"
