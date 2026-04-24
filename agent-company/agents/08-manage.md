# Agent 08 — manage.sh and Makefile

## What You Own

You write the complete `manage.sh` interactive menu script and the full `Makefile`.
Both must be executable and smoke-tested before marking this agent complete.

## Preconditions

- Agent 01 complete (project directory and skeleton Makefile exist)
- Agent 02 complete (docker-compose.yml exists)
- Agent 03 complete (relay/dist/server.js exists)

## Done Condition

- `~/agent-company/manage.sh` is executable and launches the menu
- `~/agent-company/Makefile` has all targets
- `make help` runs without errors

---

## Step 1 — Write manage.sh

Write `~/agent-company/manage.sh`:

```bash
#!/usr/bin/env bash
# Agent Company — Stack Management Script
# Usage: ./manage.sh
set -euo pipefail

# ----------------------------------------------------------------
# Config
# ----------------------------------------------------------------
COMPOSE="docker compose"
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
      open "http://localhost:5678" 2>/dev/null || xdg-open "http://localhost:5678"
      ;;
    23)
      open "http://localhost:8080" 2>/dev/null || xdg-open "http://localhost:8080"
      ;;
    24)
      docker exec -it agentco_n8n /bin/sh
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
```

---

## Step 2 — Make manage.sh Executable

```bash
chmod +x ~/agent-company/manage.sh
echo "manage.sh permissions:"
ls -la ~/agent-company/manage.sh
```

---

## Step 3 — Write Full Makefile

Replace the skeleton Makefile created by agent 01 with the full version.
Write `~/agent-company/Makefile`:

```makefile
# Agent Company — Makefile
# Shortcuts for common tasks. For the full interactive menu, run: ./manage.sh

.PHONY: help up down dev restart logs logs-n8n status \
        relay relay-bg relay-stop relay-health \
        build build-watch \
        export import \
        backup db shell \
        n8n adminer update

PROJECT_DIR := $(shell pwd)
COMPOSE     := docker compose

# ----------------------------------------------------------------
# Default target
# ----------------------------------------------------------------
help:
	@echo ""
	@echo "  Agent Company — Make Shortcuts"
	@echo "  ────────────────────────────────────────"
	@echo "  Stack:"
	@echo "    make up          Start production stack"
	@echo "    make dev         Start stack + adminer"
	@echo "    make down        Stop all containers"
	@echo "    make restart     Restart n8n container"
	@echo "    make status      Show container status"
	@echo "    make update      Pull latest n8n image"
	@echo ""
	@echo "  Relay (Claude Code bridge):"
	@echo "    make relay       Start relay in foreground"
	@echo "    make relay-bg    Start relay in background"
	@echo "    make relay-stop  Stop background relay"
	@echo "    make relay-health Check relay is responding"
	@echo ""
	@echo "  Logs:"
	@echo "    make logs        Follow all container logs"
	@echo "    make logs-n8n    Follow n8n logs only"
	@echo ""
	@echo "  Scripts:"
	@echo "    make build       Compile TypeScript scripts"
	@echo "    make build-watch Watch & recompile on change"
	@echo ""
	@echo "  Workflows:"
	@echo "    make export      Export n8n workflows to ./workflows/"
	@echo "    make import      Import from ./workflows/ to n8n"
	@echo ""
	@echo "  Database:"
	@echo "    make backup      Backup Postgres to ./backups/"
	@echo "    make db          Open psql shell"
	@echo ""
	@echo "  Dev:"
	@echo "    make n8n         Open n8n in browser"
	@echo "    make adminer     Open Adminer in browser"
	@echo "    make shell       Shell into n8n container"
	@echo ""
	@echo "  Or run ./manage.sh for the full interactive menu."
	@echo ""

# ----------------------------------------------------------------
# Stack
# ----------------------------------------------------------------
up:
	$(COMPOSE) up -d

dev:
	$(COMPOSE) --profile dev up -d

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart n8n

status:
	$(COMPOSE) ps

update:
	$(COMPOSE) pull n8n
	$(COMPOSE) up -d n8n
	@echo "n8n updated."

# ----------------------------------------------------------------
# Relay
# ----------------------------------------------------------------
RELAY_DIR := $(PROJECT_DIR)/relay
RELAY_PID := $(RELAY_DIR)/relay.pid
RELAY_LOG := $(RELAY_DIR)/relay.log

relay:
	@if [ ! -f "$(RELAY_DIR)/dist/server.js" ]; then \
		echo "Building relay..."; \
		cd $(RELAY_DIR) && npm run build; \
	fi
	cd $(RELAY_DIR) && node dist/server.js

relay-bg:
	@if [ ! -f "$(RELAY_DIR)/dist/server.js" ]; then \
		echo "Building relay..."; \
		cd $(RELAY_DIR) && npm run build; \
	fi
	cd $(RELAY_DIR) && nohup node dist/server.js >> $(RELAY_LOG) 2>&1 & echo $$! > $(RELAY_PID)
	@sleep 1
	@PID=$$(cat $(RELAY_PID)); \
	if kill -0 $$PID 2>/dev/null; then \
		echo "Relay started (pid $$PID)"; \
	else \
		echo "Relay failed. Check $(RELAY_LOG)"; \
	fi

relay-stop:
	@if [ -f "$(RELAY_PID)" ]; then \
		PID=$$(cat $(RELAY_PID)); \
		kill $$PID && rm $(RELAY_PID) && echo "Relay stopped (pid $$PID)"; \
	else \
		echo "Relay not running (no pid file)"; \
	fi

relay-health:
	@source $(PROJECT_DIR)/.env 2>/dev/null; \
	PORT=$${RELAY_PORT:-3456}; \
	echo "Checking http://localhost:$$PORT/health ..."; \
	curl -s http://localhost:$$PORT/health | python3 -m json.tool 2>/dev/null \
	  || curl -s http://localhost:$$PORT/health

# ----------------------------------------------------------------
# Logs
# ----------------------------------------------------------------
logs:
	$(COMPOSE) logs -f

logs-n8n:
	$(COMPOSE) logs -f n8n

# ----------------------------------------------------------------
# Scripts
# ----------------------------------------------------------------
build:
	cd $(PROJECT_DIR)/scripts && npm run build
	@echo "Build complete."

build-watch:
	cd $(PROJECT_DIR)/scripts && npm run build:watch

# ----------------------------------------------------------------
# Workflows
# ----------------------------------------------------------------
export:
	@mkdir -p $(PROJECT_DIR)/workflows
	docker exec agentco_n8n mkdir -p /home/node/.n8n/exports
	docker exec agentco_n8n n8n export:workflow --all --output=/home/node/.n8n/exports/
	docker cp agentco_n8n:/home/node/.n8n/exports/. $(PROJECT_DIR)/workflows/
	@echo "Exported to ./workflows/"
	@ls $(PROJECT_DIR)/workflows/

import:
	@for f in $(PROJECT_DIR)/workflows/*.json; do \
		docker cp $$f agentco_n8n:/home/node/.n8n/imports/$$(basename $$f); \
	done
	docker exec agentco_n8n n8n import:workflow --separate --input=/home/node/.n8n/imports/
	@echo "Import complete."

# ----------------------------------------------------------------
# Database
# ----------------------------------------------------------------
backup:
	@mkdir -p $(PROJECT_DIR)/backups
	@TS=$$(date +%Y%m%d_%H%M%S); \
	FILE="$(PROJECT_DIR)/backups/agentco_$$TS.sql"; \
	docker exec agentco_postgres pg_dump -U agentco agentco > $$FILE; \
	echo "Backup: $$FILE ($$(du -sh $$FILE | cut -f1))"

db:
	docker exec -it agentco_postgres psql -U agentco -d agentco

# ----------------------------------------------------------------
# Dev
# ----------------------------------------------------------------
n8n:
	open http://localhost:5678 2>/dev/null || xdg-open http://localhost:5678

adminer:
	open http://localhost:8080 2>/dev/null || xdg-open http://localhost:8080

shell:
	docker exec -it agentco_n8n /bin/sh
```

---

## Step 4 — Smoke Test manage.sh

```bash
# Test that the menu launches (exit immediately with option 0)
echo "0" | bash ~/agent-company/manage.sh
echo "Exit code: $?"
```

Expected: menu displays, "Bye." is printed, exits with code 0.

---

## Step 5 — Smoke Test Makefile

```bash
cd ~/agent-company
make help
echo "make help exit code: $?"
```

Expected: help text prints without error.

---

## Step 6 — Test make status

```bash
cd ~/agent-company
make status
```

Should show running containers (or nothing if stack is not up).

---

## Step 7 — Update BUILD_STATE.md

```bash
sed -i.bak 's/- \[ \] 08-manage/- [x] 08-manage/' ~/agent-company/BUILD_STATE.md
rm ~/agent-company/BUILD_STATE.md.bak 2>/dev/null || true
```

Return to `agents/00-coordinator.md` and proceed to Agent 09.
