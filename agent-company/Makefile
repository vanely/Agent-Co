# Agent Company — Makefile
# Shortcuts for common tasks. For the full interactive menu, run: ./manage.sh

.PHONY: help setup provision-credentials up down dev restart logs logs-n8n status \
        relay relay-bg relay-stop relay-health \
        bot bot-bg bot-stop bot-build \
        build build-watch \
        export import publish-all \
        n8n-owner-setup provision-credentials \
        backup db shell \
        n8n adminer update

PROJECT_DIR := $(shell pwd)
COMPOSE     := docker compose -f docker-compose.yml

# ----------------------------------------------------------------
# Default target
# ----------------------------------------------------------------
help:
	@echo ""
	@echo "  Agent Company — Make Shortcuts"
	@echo "  ────────────────────────────────────────"
	@echo "  First run:"
	@echo "    make setup       Full first-run: workspace + stack + import workflows"
	@echo ""
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
	@echo "  Discord Bot:"
	@echo "    make bot         Start bot in foreground"
	@echo "    make bot-bg      Start bot in background"
	@echo "    make bot-stop    Stop background bot"
	@echo "    make bot-build   Install deps + compile bot"
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
# First-run setup
# ----------------------------------------------------------------
setup:
	@echo "→ Creating workspace directories..."
	@mkdir -p $(HOME)/.agent-co/workspace/context/core
	@mkdir -p $(HOME)/.agent-co/workspace/context/business-guides
	@mkdir -p $(HOME)/.agent-co/workspace/context/technical-guides
	@mkdir -p $(HOME)/.agent-co/workspace/context/technical-research
	@mkdir -p $(HOME)/.agent-co/workspace/context/design
	@mkdir -p $(HOME)/.agent-co/workspace/context/outreach
	@mkdir -p $(HOME)/.agent-co/workspace/memory
	@mkdir -p $(HOME)/.agent-co/workspace/projects
	@mkdir -p $(HOME)/.agent-co/workspace/research
	@echo "→ Starting stack..."
	$(COMPOSE) up -d
	@echo "→ Waiting for n8n to be ready..."
	@until curl -s http://localhost:5678/healthz | grep -q ok 2>/dev/null; do sleep 2; done
	@echo "→ Creating n8n owner account..."
	$(MAKE) n8n-owner-setup
	@echo "→ Provisioning credentials..."
	$(MAKE) provision-credentials
	@echo "→ Importing workflows..."
	$(MAKE) import
	@echo "→ Publishing all workflows..."
	$(MAKE) publish-all
	@echo ""
	@echo "✓ Setup complete."
	@echo ""
	@echo "  Next steps:"
	@echo "  1. Run: make relay-bg && make bot-bg"
	@echo "  2. Open localhost:5678 to verify workflows are active"
	@echo ""

n8n-owner-setup:
	@. $(PROJECT_DIR)/.env && \
	STATUS=$$(curl -s http://localhost:5678/rest/settings | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('userManagement',{}).get('showSetupOnFirstLoad','false'))" 2>/dev/null) && \
	if [ "$$STATUS" = "True" ] || [ "$$STATUS" = "true" ]; then \
		echo "  First run — creating owner account..." && \
		curl -s -c /tmp/n8n-setup-cookies.txt -X POST http://localhost:5678/rest/owner/setup \
			-H "Content-Type: application/json" \
			-d "{\"email\":\"$${N8N_OWNER_EMAIL:-admin@agentco.local}\",\"firstName\":\"Admin\",\"lastName\":\"AgentCo\",\"password\":\"$${N8N_OWNER_PASSWORD:-N8n_ui_password1}\"}" > /dev/null && \
		echo "  Owner account created."; \
	else \
		echo "  Owner already set up, skipping."; \
	fi

provision-credentials:
	@. $(PROJECT_DIR)/.env && \
	CRED_JSON=$$(printf '[{"id":"postgres-main","name":"AgentCo Postgres","type":"postgres","nodesAccess":[{"nodeType":"n8n-nodes-base.postgres"}],"data":{"host":"postgres","port":5432,"database":"%s","user":"%s","password":"%s","ssl":"disable"}},{"id":"smtp-main","name":"AgentCo SMTP","type":"smtp","nodesAccess":[{"nodeType":"n8n-nodes-base.emailSend"}],"data":{"host":"%s","port":%s,"user":"%s","password":"%s","secure":false,"startTLS":true}}]' \
		"$$POSTGRES_DB" "$$POSTGRES_USER" "$$POSTGRES_PASSWORD" \
		"$$SMTP_HOST" "$$SMTP_PORT" "$$SMTP_USER" "$$SMTP_PASS") && \
	echo "$$CRED_JSON" > /tmp/agentco-creds.json && \
	docker cp /tmp/agentco-creds.json agentco_n8n:/tmp/agentco-creds.json && \
	docker exec agentco_n8n n8n import:credentials --input=/tmp/agentco-creds.json && \
	rm -f /tmp/agentco-creds.json
	@echo "Credentials provisioned."

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
	@set -a && . $(PROJECT_DIR)/.env && set +a && cd $(RELAY_DIR) && node dist/server.js

relay-bg:
	@if [ ! -f "$(RELAY_DIR)/dist/server.js" ]; then \
		echo "Building relay..."; \
		cd $(RELAY_DIR) && npm run build; \
	fi
	@set -a && . $(PROJECT_DIR)/.env && set +a && cd $(RELAY_DIR) && nohup node dist/server.js >> $(RELAY_LOG) 2>&1 & echo $$! > $(RELAY_PID)
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
	@. $(PROJECT_DIR)/.env 2>/dev/null; \
	PORT=$${RELAY_PORT:-3456}; \
	echo "Checking http://localhost:$$PORT/health ..."; \
	curl -s http://localhost:$$PORT/health | python3 -m json.tool 2>/dev/null \
	  || curl -s http://localhost:$$PORT/health

# ----------------------------------------------------------------
# Discord Bot
# ----------------------------------------------------------------
BOT_DIR := $(PROJECT_DIR)/discord-bot
BOT_PID := $(BOT_DIR)/bot.pid
BOT_LOG := $(BOT_DIR)/bot.log

bot-build:
	cd $(BOT_DIR) && npm install && npm run build
	@echo "Discord bot built."

bot:
	@if [ ! -f "$(BOT_DIR)/dist/bot.js" ]; then \
		echo "Building discord bot..."; \
		cd $(BOT_DIR) && npm install && npm run build; \
	fi
	@. $(PROJECT_DIR)/.env && cd $(BOT_DIR) && \
		DISCORD_BOT_TOKEN=$$DISCORD_BOT_TOKEN \
		N8N_DISCORD_WEBHOOK_URL=$$N8N_DISCORD_WEBHOOK_URL \
		DISCORD_CHANNEL_IDS=$$DISCORD_CHANNEL_IDS \
		RELAY_PORT=$${RELAY_PORT:-3456} \
		node dist/bot.js

bot-bg:
	@if [ ! -f "$(BOT_DIR)/dist/bot.js" ]; then \
		echo "Building discord bot..."; \
		cd $(BOT_DIR) && npm install && npm run build; \
	fi
	@. $(PROJECT_DIR)/.env && cd $(BOT_DIR) && \
		DISCORD_BOT_TOKEN=$$DISCORD_BOT_TOKEN \
		N8N_DISCORD_WEBHOOK_URL=$$N8N_DISCORD_WEBHOOK_URL \
		DISCORD_CHANNEL_IDS=$$DISCORD_CHANNEL_IDS \
		RELAY_PORT=$${RELAY_PORT:-3456} \
		nohup node dist/bot.js >> $(BOT_LOG) 2>&1 & echo $$! > $(BOT_PID)
	@sleep 1
	@PID=$$(cat $(BOT_PID)); \
	if kill -0 $$PID 2>/dev/null; then \
		echo "Discord bot started (pid $$PID). Logs: $(BOT_LOG)"; \
	else \
		echo "Discord bot failed. Check $(BOT_LOG)"; \
	fi

bot-stop:
	@if [ -f "$(BOT_PID)" ]; then \
		PID=$$(cat $(BOT_PID)); \
		kill $$PID && rm $(BOT_PID) && echo "Discord bot stopped (pid $$PID)"; \
	else \
		echo "Discord bot not running (no pid file)"; \
	fi

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
	docker exec agentco_n8n mkdir -p /home/node/.n8n/imports
	@for f in $(PROJECT_DIR)/workflows/*.json; do \
		docker cp $$f agentco_n8n:/home/node/.n8n/imports/$$(basename $$f); \
	done
	docker exec agentco_n8n n8n import:workflow --separate --input=/home/node/.n8n/imports/
	@echo "Import complete."

reload-workflows: import publish-all
	@echo "→ Restarting n8n to re-register webhooks..."
	@docker restart agentco_n8n > /dev/null 2>&1
	@until curl -s http://localhost:5678/healthz | grep -q ok 2>/dev/null; do sleep 2; done
	@echo "Workflows reloaded (imported + published + webhooks registered)."

publish-all:
	@. $(PROJECT_DIR)/.env && \
	N8N_URL="http://localhost:5678" && \
	curl -s -H "X-N8N-API-KEY: $$N8N_API_KEY" "$$N8N_URL/api/v1/workflows?limit=100" | \
		python3 -c "import json,sys; [print(w['id']) for w in json.load(sys.stdin).get('data',[])]" 2>/dev/null | \
	while read id; do \
		curl -s -H "X-N8N-API-KEY: $$N8N_API_KEY" -X POST "$$N8N_URL/api/v1/workflows/$$id/activate" > /dev/null && \
		echo "  published $$id"; \
	done
	@echo "All workflows published."

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
