#!/bin/bash
# ================================================================
# Agent Company — Dashboard Tunnel via Cloudflare
# Exposes the dashboard (port 3001) to the internet via a
# temporary Cloudflare quick tunnel.
#
# Usage:
#   ./scripts/dashboard-tunnel.sh start   # start tunnel, log URL
#   ./scripts/dashboard-tunnel.sh stop    # stop tunnel
#   ./scripts/dashboard-tunnel.sh status  # show current URL
#   ./scripts/dashboard-tunnel.sh url     # print just the URL
#
# The tunnel URL changes on each restart. agent can read it
# via: curl localhost:3456/tunnel-status
# ================================================================

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TUNNEL_PID_FILE="$PROJECT_DIR/scripts/tunnel.pid"
TUNNEL_LOG="$PROJECT_DIR/scripts/tunnel.log"
TUNNEL_URL_FILE="$PROJECT_DIR/scripts/tunnel-url.txt"
PORT=3001

start_tunnel() {
    # Stop existing tunnel if running
    stop_tunnel 2>/dev/null || true

    echo "Starting Cloudflare tunnel for localhost:$PORT..."

    # Start cloudflared in background, capture output to extract URL
    nohup cloudflared tunnel --url "http://localhost:$PORT" > "$TUNNEL_LOG" 2>&1 &
    echo $! > "$TUNNEL_PID_FILE"

    # Wait for the URL to appear in the logs (up to 15 seconds)
    local attempts=0
    while [ $attempts -lt 30 ]; do
        URL=$(grep -oP 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
        if [ -n "$URL" ]; then
            echo "$URL" > "$TUNNEL_URL_FILE"

            # Shorten URL via ulvis.net
            local SHORT_URL
            SHORT_URL=$(curl -s "https://ulvis.net/api.php?url=${URL}" 2>/dev/null)
            if [ -z "$SHORT_URL" ] || [[ "$SHORT_URL" != https://* ]]; then
              SHORT_URL="$URL"
            fi

            echo ""
            echo "Dashboard tunnel active:"
            echo "  URL:   $URL"
            echo "  Share: $SHORT_URL"
            echo "  PID:   $(cat "$TUNNEL_PID_FILE")"
            echo ""
            echo "Login with your dashboard credentials."
            return 0
        fi
        sleep 0.5
        attempts=$((attempts + 1))
    done

    echo "Error: Could not extract tunnel URL after 15 seconds."
    echo "Check $TUNNEL_LOG for details."
    return 1
}

stop_tunnel() {
    if [ -f "$TUNNEL_PID_FILE" ]; then
        PID=$(cat "$TUNNEL_PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID"
            echo "Tunnel stopped (PID $PID)"
        else
            echo "Tunnel process not running (stale PID)"
        fi
        rm -f "$TUNNEL_PID_FILE" "$TUNNEL_URL_FILE"
    else
        echo "No tunnel running"
    fi
}

show_status() {
    if [ -f "$TUNNEL_PID_FILE" ] && kill -0 "$(cat "$TUNNEL_PID_FILE")" 2>/dev/null; then
        echo "Tunnel: ACTIVE"
        echo "  PID: $(cat "$TUNNEL_PID_FILE")"
        echo "  URL: $(cat "$TUNNEL_URL_FILE" 2>/dev/null || echo 'unknown')"
    else
        echo "Tunnel: NOT RUNNING"
    fi
}

show_url() {
    if [ -f "$TUNNEL_URL_FILE" ]; then
        cat "$TUNNEL_URL_FILE"
    else
        echo "No tunnel URL available. Start with: $0 start"
        exit 1
    fi
}

case "${1:-}" in
    start)  start_tunnel ;;
    stop)   stop_tunnel ;;
    status) show_status ;;
    url)    show_url ;;
    *)
        echo "Usage: $0 {start|stop|status|url}"
        exit 1
        ;;
esac
