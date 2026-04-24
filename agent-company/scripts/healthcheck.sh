#!/bin/bash
# Agent Company — Health Check Script
# Runs every 5 minutes via systemd timer or cron
# Checks relay, bot, and Docker containers; restarts if down

# Derive paths from script location — no hardcoded paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG="$SCRIPT_DIR/healthcheck.log"
TS=$(date '+%Y-%m-%d %H:%M:%S')

# Read relay port from .env if available
RELAY_PORT=3456
if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env" 2>/dev/null
    RELAY_PORT="${RELAY_PORT:-3456}"
fi

# --- Docker containers ---
if ! docker ps --format '{{.Names}}' | grep -q agentco_postgres; then
    echo "[$TS] WARN: Postgres container down, starting stack..." >> "$LOG"
    cd "$PROJECT_DIR" && docker compose up -d >> "$LOG" 2>&1
fi

if ! docker ps --format '{{.Names}}' | grep -q agentco_n8n; then
    echo "[$TS] WARN: n8n container down, starting stack..." >> "$LOG"
    cd "$PROJECT_DIR" && docker compose up -d >> "$LOG" 2>&1
fi

# --- Relay ---
RELAY_OK=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$RELAY_PORT/health" 2>/dev/null)
if [ "$RELAY_OK" != "200" ]; then
    echo "[$TS] WARN: Relay not responding (HTTP $RELAY_OK), restarting..." >> "$LOG"
    systemctl --user restart agentco-relay.service 2>/dev/null || true
    echo "[$TS] Relay restarted" >> "$LOG"
else
    echo "[$TS] OK: All services healthy" >> "$LOG"
fi

# --- Bot (check if process is alive via systemd) ---
if systemctl --user is-active --quiet agentco-bot.service 2>/dev/null; then
    : # bot is running
else
    echo "[$TS] WARN: Bot not active, restarting..." >> "$LOG"
    systemctl --user restart agentco-bot.service 2>/dev/null || true
    echo "[$TS] Bot restarted" >> "$LOG"
fi

# --- Trim log to last 500 lines ---
if [ -f "$LOG" ] && [ $(wc -l < "$LOG") -gt 500 ]; then
    tail -500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
