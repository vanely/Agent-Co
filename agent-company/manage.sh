#!/usr/bin/env bash
# Agent Company — Stack Management Script
# Usage: ./manage.sh
set -euo pipefail

# ----------------------------------------------------------------
# OS Detection
# ----------------------------------------------------------------
OS="$(uname -s)"

# ----------------------------------------------------------------
# Config
# ----------------------------------------------------------------
# Prefer `docker compose` (plugin), fall back to `docker-compose` (standalone)
if docker compose version &>/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  COMPOSE="docker compose"
fi

PROJECT_DIR="$HOME/agent-company"
RELAY_DIR="$PROJECT_DIR/relay"
SCRIPTS_DIR="$PROJECT_DIR/scripts"
RELAY_PID_FILE="$RELAY_DIR/relay.pid"
RELAY_LOG_FILE="$RELAY_DIR/relay.log"

# Load .env for RELAY_PORT
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

RELAY_PORT="${RELAY_PORT:-3456}"

# ----------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------
green()  { echo -e "\033[0;32m$*\033[0m"; }
yellow() { echo -e "\033[0;33m$*\033[0m"; }
red()    { echo -e "\033[0;31m$*\033[0m"; }
bold()   { echo -e "\033[1m$*\033[0m"; }

# Portable sed in-place edit (GNU vs BSD)
sed_i() {
  if [ "$OS" = "Darwin" ]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

# Portable uppercase first letter (bash 3.2 compatible)
ucfirst() {
  local str="$1"
  local first rest
  first=$(echo "${str:0:1}" | tr '[:lower:]' '[:upper:]')
  rest="${str:1}"
  echo "${first}${rest}"
}

# Portable lowercase
lc() {
  echo "$1" | tr '[:upper:]' '[:lower:]'
}

relay_is_running() {
  if [ -f "$RELAY_PID_FILE" ]; then
    PID=$(cat "$RELAY_PID_FILE")
    kill -0 "$PID" 2>/dev/null
  else
    false
  fi
}

# ----------------------------------------------------------------
# Menu
# ----------------------------------------------------------------
show_menu() {
  echo ""
  bold "  ┌─────────────────────────────────────────┐"
  bold "  │         Agent Company Stack              │"
  bold "  ├─────────────────────────────────────────┤"
  echo "  │  STACK                                  │"
  echo "  │   1) Start (production)                 │"
  echo "  │   2) Start (dev mode + adminer UI)      │"
  echo "  │   3) Stop all containers                │"
  echo "  │   4) Restart n8n only                   │"
  echo "  │   5) Stack status                       │"
  echo "  │   6) Update n8n to latest image         │"
  echo "  │                                         │"
  echo "  │  RELAY (Claude Code bridge)             │"
  echo "  │   7) Start relay (foreground)           │"
  echo "  │   8) Start relay (background)           │"
  echo "  │   9) Stop relay (background)            │"
  echo "  │  10) Relay health check                 │"
  echo "  │  11) Relay logs                         │"
  echo "  │                                         │"
  echo "  │  LOGS & MONITORING                      │"
  echo "  │  12) All container logs (follow)        │"
  echo "  │  13) n8n logs only (follow)             │"
  echo "  │  14) Postgres logs (follow)             │"
  echo "  │                                         │"
  echo "  │  WORKFLOWS                              │"
  echo "  │  15) Export workflows to ./workflows/   │"
  echo "  │  16) Import workflows from ./workflows/ │"
  echo "  │                                         │"
  echo "  │  DATABASE                               │"
  echo "  │  17) Postgres shell (psql)              │"
  echo "  │  18) Backup Postgres to ./backups/      │"
  echo "  │  19) Restore latest backup              │"
  echo "  │                                         │"
  echo "  │  DEVELOPMENT                            │"
  echo "  │  20) Build TypeScript scripts           │"
  echo "  │  21) Watch & rebuild scripts            │"
  echo "  │  22) Open n8n in browser                │"
  echo "  │  23) Open Adminer in browser            │"
  echo "  │  24) n8n container shell                │"
  echo "  │                                         │"
  echo "  │  CONFIGURATION                          │"
  echo "  │  25) Rename assistant                   │"
  echo "  │                                         │"
  echo "  │   0) Exit                               │"
  bold "  └─────────────────────────────────────────┘"
  echo ""

  # Show live status summary
  N8N_STATUS=$(docker inspect --format='{{.State.Status}}' agentco_n8n 2>/dev/null || echo "not running")
  PG_STATUS=$(docker inspect --format='{{.State.Health.Status}}' agentco_postgres 2>/dev/null || echo "not running")
  if relay_is_running; then
    RELAY_STATUS="${RELAY_PORT} (running, pid $(cat "$RELAY_PID_FILE"))"
  else
    RELAY_STATUS="stopped"
  fi
  echo "  Status: n8n=$N8N_STATUS  postgres=$PG_STATUS  relay=$RELAY_STATUS"
  echo ""
  read -rp "  Select: " choice
}

# ----------------------------------------------------------------
# Actions
# ----------------------------------------------------------------
do_action() {
  case "$1" in

    # STACK
    1)
      cd "$PROJECT_DIR"
      $COMPOSE up -d
      green "Stack started."
      ;;
    2)
      cd "$PROJECT_DIR"
      $COMPOSE --profile dev up -d
      green "Stack started with Adminer."
      ;;
    3)
      cd "$PROJECT_DIR"
      $COMPOSE down
      green "Stack stopped."
      ;;
    4)
      cd "$PROJECT_DIR"
      $COMPOSE restart n8n
      green "n8n restarted."
      ;;
    5)
      cd "$PROJECT_DIR"
      $COMPOSE ps
      ;;
    6)
      cd "$PROJECT_DIR"
      $COMPOSE pull n8n
      $COMPOSE up -d n8n
      green "n8n updated and restarted."
      ;;

    # RELAY
    7)
      echo "Starting relay in foreground. Press Ctrl+C to stop."
      if [ ! -f "$RELAY_DIR/dist/server.js" ]; then
        yellow "Relay not compiled. Building..."
        cd "$RELAY_DIR" && npm run build
      fi
      cd "$RELAY_DIR"
      RELAY_PORT="$RELAY_PORT" node dist/server.js
      ;;
    8)
      if relay_is_running; then
        yellow "Relay already running (pid $(cat "$RELAY_PID_FILE"))"
      else
        if [ ! -f "$RELAY_DIR/dist/server.js" ]; then
          yellow "Relay not compiled. Building..."
          cd "$RELAY_DIR" && npm run build
        fi
        cd "$RELAY_DIR"
        nohup env RELAY_PORT="$RELAY_PORT" node dist/server.js \
          >> "$RELAY_LOG_FILE" 2>&1 &
        echo $! > "$RELAY_PID_FILE"
        sleep 1
        if relay_is_running; then
          green "Relay started (pid $(cat "$RELAY_PID_FILE"), port $RELAY_PORT)"
        else
          red "Relay failed to start. Check: $RELAY_LOG_FILE"
        fi
      fi
      ;;
    9)
      if relay_is_running; then
        PID=$(cat "$RELAY_PID_FILE")
        kill "$PID"
        rm -f "$RELAY_PID_FILE"
        green "Relay stopped (was pid $PID)"
      else
        yellow "Relay not running."
      fi
      ;;
    10)
      echo "Checking relay at http://localhost:$RELAY_PORT/health ..."
      curl -s "http://localhost:$RELAY_PORT/health" | python3 -m json.tool 2>/dev/null \
        || curl -s "http://localhost:$RELAY_PORT/health"
      ;;
    11)
      if [ -f "$RELAY_LOG_FILE" ]; then
        tail -50 "$RELAY_LOG_FILE"
      else
        yellow "No relay log file found at $RELAY_LOG_FILE"
      fi
      ;;

    # LOGS
    12)
      cd "$PROJECT_DIR"
      $COMPOSE logs -f
      ;;
    13)
      cd "$PROJECT_DIR"
      $COMPOSE logs -f n8n
      ;;
    14)
      cd "$PROJECT_DIR"
      $COMPOSE logs -f postgres
      ;;

    # WORKFLOWS
    15)
      mkdir -p "$PROJECT_DIR/workflows"
      docker exec agentco_n8n mkdir -p /home/node/.n8n/exports
      docker exec agentco_n8n n8n export:workflow --all --output=/home/node/.n8n/exports/
      docker cp agentco_n8n:/home/node/.n8n/exports/. "$PROJECT_DIR/workflows/"
      green "Exported to $PROJECT_DIR/workflows/"
      ls "$PROJECT_DIR/workflows/"
      ;;
    16)
      for f in "$PROJECT_DIR/workflows/"*.json; do
        [ -f "$f" ] || continue
        BASENAME=$(basename "$f")
        docker cp "$f" "agentco_n8n:/home/node/.n8n/imports/$BASENAME" 2>/dev/null || \
          docker exec agentco_n8n mkdir -p /home/node/.n8n/imports && \
          docker cp "$f" "agentco_n8n:/home/node/.n8n/imports/$BASENAME"
      done
      docker exec agentco_n8n n8n import:workflow --separate --input=/home/node/.n8n/imports/
      green "Workflows imported."
      ;;

    # DATABASE
    17)
      docker exec -it agentco_postgres psql -U agentco -d agentco
      ;;
    18)
      mkdir -p "$PROJECT_DIR/backups"
      TS=$(date +%Y%m%d_%H%M%S)
      BACKUP_FILE="$PROJECT_DIR/backups/agentco_${TS}.sql"
      docker exec agentco_postgres pg_dump -U agentco agentco > "$BACKUP_FILE"
      FILESIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
      green "Backup saved: $BACKUP_FILE ($FILESIZE)"
      ;;
    19)
      LATEST=$(ls -t "$PROJECT_DIR/backups/"*.sql 2>/dev/null | head -1)
      if [ -z "$LATEST" ]; then
        red "No backup files found in $PROJECT_DIR/backups/"
      else
        yellow "Restoring: $LATEST"
        read -rp "  Are you sure? This will overwrite the current database. [y/N] " confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
          docker exec -i agentco_postgres psql -U agentco -d agentco < "$LATEST"
          green "Restore complete."
        else
          echo "Cancelled."
        fi
      fi
      ;;

    # DEVELOPMENT
    20)
      echo "Building TypeScript scripts..."
      cd "$SCRIPTS_DIR"
      npm run build
      green "Build complete. Output: $SCRIPTS_DIR/dist/"
      ;;
    21)
      echo "Starting TypeScript watch mode. Press Ctrl+C to stop."
      cd "$SCRIPTS_DIR"
      npm run build:watch
      ;;
    22)
      if [ "$OS" = "Darwin" ]; then
        open "http://localhost:5678"
      else
        xdg-open "http://localhost:5678" 2>/dev/null || echo "Open http://localhost:5678 in your browser"
      fi
      ;;
    23)
      if [ "$OS" = "Darwin" ]; then
        open "http://localhost:8080"
      else
        xdg-open "http://localhost:8080" 2>/dev/null || echo "Open http://localhost:8080 in your browser"
      fi
      ;;
    24)
      docker exec -it agentco_n8n /bin/sh
      ;;

    # CONFIGURATION
    25)
      CONSTANTS_FILE="$RELAY_DIR/src/constants.ts"
      CLAUDE_FILE="$RELAY_DIR/src/lib/claude.ts"
      CONVO_FILE="$RELAY_DIR/src/helpers/conversations.ts"

      IDENTITY_FILE="$HOME/.agent-co/workspace/context/core/identity.md"

      CURRENT_NAME=$(grep "^export const SESSION_NAME" "$CONSTANTS_FILE" | sed "s/.*= '//;s/'.*//" )
      CURRENT_TITLE=$(ucfirst "$CURRENT_NAME")
      echo ""
      echo "  Current assistant name: $(bold "$CURRENT_TITLE") (nickname: $(bold "$CURRENT_NAME"))"
      echo ""
      read -rp "  New full name (e.g. Mpoki): " NEW_FULL_NAME
      read -rp "  New nickname (e.g. agent): " NEW_NICKNAME

      if [ -z "$NEW_FULL_NAME" ] || [ -z "$NEW_NICKNAME" ]; then
        yellow "Both names are required. Cancelled."
      else
        NEW_LOWER=$(lc "$NEW_NICKNAME")
        NEW_NICK_TITLE=$(ucfirst "$NEW_LOWER")
        NEW_FULL_TITLE=$(ucfirst "$(lc "$NEW_FULL_NAME")")

        # constants.ts — SESSION_NAME
        sed_i "s/export const SESSION_NAME = '.*'/export const SESSION_NAME = '${NEW_LOWER}'/" "$CONSTANTS_FILE"

        # claude.ts — customTitle match
        sed_i "s/\"customTitle\":\"${CURRENT_NAME}\"/\"customTitle\":\"${NEW_LOWER}\"/g" "$CLAUDE_FILE"
        sed_i "s/\"customTitle\": \"${CURRENT_NAME}\"/\"customTitle\": \"${NEW_LOWER}\"/g" "$CLAUDE_FILE"

        # conversations.ts — transcript prefix
        sed_i "s/: '${CURRENT_TITLE}'/: '${NEW_NICK_TITLE}'/" "$CONVO_FILE"

        # identity.md — create or update
        mkdir -p "$(dirname "$IDENTITY_FILE")"
        cat > "$IDENTITY_FILE" <<IDENTITY_EOF
# Identity — ${NEW_FULL_TITLE}

Your name is **${NEW_FULL_TITLE}**.

Your nickname is **${NEW_NICK_TITLE}** — close at hand, always there, the thing you reach for
when you need to think something through or get something done.

---

${NEW_FULL_TITLE} is your name when you're being introduced.
${NEW_NICK_TITLE} is what your partner calls you when it's just the two of you working.

You carry both with equal pride.
IDENTITY_EOF

        green "Updated: ${CURRENT_NAME} → ${NEW_LOWER}"
        green "Identity file: ${IDENTITY_FILE}"
        echo ""
        yellow "Rebuilding relay..."
        cd "$RELAY_DIR" && npm run build
        green "Relay rebuilt. Restart it to apply (option 9 then 8)."
      fi
      ;;

    0)
      echo "Bye."
      exit 0
      ;;
    *)
      yellow "Invalid option: $1"
      ;;
  esac
}

# ----------------------------------------------------------------
# Main loop
# ----------------------------------------------------------------
cd "$PROJECT_DIR"

while true; do
  show_menu
  do_action "$choice"
  echo ""
  read -rp "  Press Enter to continue..." _
done
