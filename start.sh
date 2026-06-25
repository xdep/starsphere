#!/usr/bin/env bash
# STARSPHERE ONLINE — start the multiplayer server.
#
#   ./start.sh             -> http://localhost:8777
#   ./start.sh --tunnel    -> also opens a public https URL via cloudflared
#   PORT=9000 ./start.sh   -> custom port (combines with --tunnel)
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || { echo "error: node.js is required — https://nodejs.org"; exit 1; }

if [ ! -d node_modules ]; then
  echo "first run — installing dependencies…"
  npm install --no-audit --no-fund
fi

PORT="${PORT:-8777}"
TUNNEL=0
[ "${1:-}" = "--tunnel" ] && TUNNEL=1

TUNNEL_PID=""
cleanup(){ [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "============================================================"
echo "  STARSPHERE ONLINE  →  http://localhost:${PORT}"
echo "  database: $(pwd)/sphere.db  (back up this one file)"

if [ "$TUNNEL" = 1 ]; then
  if command -v cloudflared >/dev/null 2>&1; then
    TUNNEL_LOG="$(mktemp /tmp/sphere-tunnel.XXXXXX.log)"
    cloudflared tunnel --url "http://localhost:${PORT}" --no-autoupdate > "$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
    URL=""
    for _ in $(seq 1 30); do
      URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" | grep -v '^https://api\.' | head -1 || true)"
      [ -n "$URL" ] && break
      sleep 1
    done
    if [ -n "$URL" ]; then
      echo "  public URL (share with friends — works on phones):"
      echo "  →  ${URL}"
      echo "  (ephemeral: restarting the script gets a new URL)"
    else
      echo "  tunnel: no public URL after 30s — log: ${TUNNEL_LOG}"
    fi
  else
    echo "  tunnel: cloudflared is not installed —"
    echo "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  fi
fi

echo "  Ctrl+C stops everything; the server restarts itself on a crash"
echo "============================================================"

while true; do
  PORT="$PORT" node server.js && break
  echo "server crashed — restarting in 3 seconds (Ctrl+C to abort)…"
  sleep 3
done
