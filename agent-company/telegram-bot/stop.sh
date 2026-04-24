#!/usr/bin/env bash
cd "$(dirname "$0")"

PID_FILE="./bot.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "No PID file — bot not running?"
    exit 0
fi

PID=$(cat "$PID_FILE")
if kill -0 "$PID" 2>/dev/null; then
    kill -SIGTERM "$PID"
    echo "Sent SIGTERM to PID $PID"
    # Wait up to 10s for graceful shutdown
    for i in $(seq 1 10); do
        if ! kill -0 "$PID" 2>/dev/null; then
            rm "$PID_FILE"
            echo "Bot stopped"
            exit 0
        fi
        sleep 1
    done
    # Force kill
    kill -SIGKILL "$PID" 2>/dev/null || true
    rm "$PID_FILE"
    echo "Bot force-killed"
else
    echo "Process not running, removing stale PID"
    rm "$PID_FILE"
fi
