#!/usr/bin/env bash
# Start Agent Co Telegram Bot in background, write PID and log
set -e
cd "$(dirname "$0")"

PID_FILE="./bot.pid"
LOG_FILE="./bot.log"

# Check if already running
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Bot already running (PID $PID)"
        exit 0
    else
        echo "Stale PID file, removing"
        rm "$PID_FILE"
    fi
fi

nohup npm start > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
sleep 2
if kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
    echo "Bot started (PID $(cat $PID_FILE))"
    echo "Log: $LOG_FILE"
else
    echo "Bot failed to start — check $LOG_FILE"
    exit 1
fi
