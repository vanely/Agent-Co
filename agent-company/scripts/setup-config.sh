#!/bin/bash
# ================================================================
# Agent Company — Interactive Configuration Script
# Sets up .env, systemd services, and provisions the stack.
# Pure bash, no external dependencies beyond openssl/curl/docker.
#
# Usage: ./scripts/setup-config.sh
# ================================================================

set -euo pipefail

# ----------------------------------------------------------------
# Auto-detect PROJECT_DIR from script location
# ----------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/templates"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"
USER_HOME="$HOME"
SYSTEMD_DIR="$HOME/.config/systemd/user"

# ----------------------------------------------------------------
# ANSI Colors
# ----------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ----------------------------------------------------------------
# State — current values (loaded from .env or defaults)
# ----------------------------------------------------------------
declare -A CFG         # current config values
declare -A OLD_CFG     # values at load time (for change detection)
declare -A CHANGED_CATEGORIES  # which categories had changes

# ----------------------------------------------------------------
# Load existing .env if present
# ----------------------------------------------------------------
load_env() {
    if [ -f "$ENV_FILE" ]; then
        while IFS='=' read -r key value; do
            # Skip comments and empty lines
            [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
            # Remove surrounding quotes
            value="${value%\"}"
            value="${value#\"}"
            CFG["$key"]="$value"
            OLD_CFG["$key"]="$value"
        done < <(grep -v '^\s*#' "$ENV_FILE" | grep '=')
    fi
}

# ----------------------------------------------------------------
# Defaults for empty values
# ----------------------------------------------------------------
apply_defaults() {
    CFG[POSTGRES_DB]="${CFG[POSTGRES_DB]:-agentco}"
    CFG[POSTGRES_USER]="${CFG[POSTGRES_USER]:-agentco}"
    CFG[POSTGRES_PASSWORD]="${CFG[POSTGRES_PASSWORD]:-}"
    CFG[N8N_ENCRYPTION_KEY]="${CFG[N8N_ENCRYPTION_KEY]:-}"
    CFG[N8N_OWNER_EMAIL]="${CFG[N8N_OWNER_EMAIL]:-admin@agentco.local}"
    CFG[N8N_OWNER_PASSWORD]="${CFG[N8N_OWNER_PASSWORD]:-}"
    CFG[N8N_API_KEY]="${CFG[N8N_API_KEY]:-}"
    CFG[SMTP_HOST]="${CFG[SMTP_HOST]:-smtp.gmail.com}"
    CFG[SMTP_PORT]="${CFG[SMTP_PORT]:-587}"
    CFG[SMTP_USER]="${CFG[SMTP_USER]:-}"
    CFG[SMTP_PASS]="${CFG[SMTP_PASS]:-}"
    CFG[SMTP_FROM_NAME]="${CFG[SMTP_FROM_NAME]:-}"
    CFG[RELAY_PORT]="${CFG[RELAY_PORT]:-3456}"
    CFG[RELAY_SECRET]="${CFG[RELAY_SECRET]:-}"
    CFG[DASHBOARD_USER]="${CFG[DASHBOARD_USER]:-admin}"
    CFG[DASHBOARD_PASSWORD]="${CFG[DASHBOARD_PASSWORD]:-}"
    CFG[JWT_SECRET]="${CFG[JWT_SECRET]:-}"
    CFG[DISCORD_BOT_TOKEN]="${CFG[DISCORD_BOT_TOKEN]:-}"
    CFG[N8N_DISCORD_WEBHOOK_URL]="${CFG[N8N_DISCORD_WEBHOOK_URL]:-http://localhost:5678/webhook/discord-message}"
    CFG[DISCORD_CHANNEL_IDS]="${CFG[DISCORD_CHANNEL_IDS]:-}"
    CFG[TELEGRAM_BOT_TOKEN]="${CFG[TELEGRAM_BOT_TOKEN]:-}"
    CFG[TELEGRAM_CHAT_ID]="${CFG[TELEGRAM_CHAT_ID]:-}"
    CFG[TZ]="${CFG[TZ]:-America/New_York}"
    CFG[PROJECT_DIR]="$PROJECT_DIR"
}

# ----------------------------------------------------------------
# Validation
# ----------------------------------------------------------------
DISALLOWED_CHARS="'\`\$%\\\\"

validate_password() {
    local pass="$1" min_len="$2" name="$3"
    if [ ${#pass} -lt "$min_len" ]; then
        echo "Must be at least $min_len characters"
        return 1
    fi
    if [[ "$pass" =~ [\'\`\$%\\\\] ]]; then
        echo "Cannot contain ' \` \$ % \\ — these conflict with the system"
        return 1
    fi
    return 0
}

validate_n8n_password() {
    local pass="$1"
    local err
    err=$(validate_password "$pass" 8 "n8n password") || { echo "$err"; return 1; }
    if ! [[ "$pass" =~ [A-Z] ]]; then echo "Must contain an uppercase letter"; return 1; fi
    if ! [[ "$pass" =~ [a-z] ]]; then echo "Must contain a lowercase letter"; return 1; fi
    if ! [[ "$pass" =~ [0-9] ]]; then echo "Must contain a number"; return 1; fi
    return 0
}

validate_email() {
    if ! [[ "$1" =~ @ ]]; then echo "Must contain @"; return 1; fi
    return 0
}

validate_port() {
    if ! [[ "$1" =~ ^[0-9]+$ ]] || [ "$1" -lt 1024 ] || [ "$1" -gt 65535 ]; then
        echo "Must be a number between 1024-65535"
        return 1
    fi
    return 0
}

# ----------------------------------------------------------------
# Secret generation
# ----------------------------------------------------------------
generate_password() {
    openssl rand -base64 24 | tr -d '/+=\n' | head -c 24
}

generate_encryption_key() {
    openssl rand -hex 32
}

# ----------------------------------------------------------------
# Prompt helpers
# ----------------------------------------------------------------
prompt_field() {
    local label="$1" key="$2" is_secret="${3:-false}" validator="${4:-}"
    local current="${CFG[$key]}"
    local display_val

    if [ "$is_secret" = "true" ] && [ -n "$current" ]; then
        display_val="$(printf '•%.0s' $(seq 1 ${#current}))"
    else
        display_val="$current"
    fi

    while true; do
        echo -ne "  ${CYAN}$label${NC}"
        if [ -n "$display_val" ]; then
            echo -ne " ${DIM}[$display_val]${NC}"
        fi
        echo -ne ": "

        if [ "$is_secret" = "true" ]; then
            read -rs value
            echo ""
        else
            read -r value
        fi

        # Use existing value if empty input
        [ -z "$value" ] && value="$current"

        # Strip spaces from Gmail app passwords
        if [ "$key" = "SMTP_PASS" ]; then
            value="${value// /}"
        fi

        # Validate if validator provided
        if [ -n "$validator" ] && [ -n "$value" ]; then
            local err
            err=$($validator "$value" 2>&1) || {
                echo -e "    ${RED}✗ $err${NC}"
                continue
            }
        fi

        CFG["$key"]="$value"
        if [ -n "$value" ]; then
            echo -e "    ${GREEN}✓${NC}"
        fi
        break
    done
}

prompt_field_with_generate() {
    local label="$1" key="$2" generator="$3" validator="${4:-}"
    local current="${CFG[$key]}"

    if [ -n "$current" ]; then
        echo -e "  ${CYAN}$label${NC} ${DIM}[set — press Enter to keep, G to regenerate]${NC}"
    else
        echo -e "  ${CYAN}$label${NC} ${DIM}[empty — press Enter to auto-generate, or type a value]${NC}"
    fi
    echo -ne "  > "
    read -r value

    if [ "$value" = "G" ] || [ "$value" = "g" ] || { [ -z "$value" ] && [ -z "$current" ]; }; then
        value=$($generator)
        echo -e "    ${GREEN}✓ Generated${NC}"
    elif [ -z "$value" ]; then
        value="$current"
        echo -e "    ${GREEN}✓ Kept existing${NC}"
    fi

    CFG["$key"]="$value"
}

# ----------------------------------------------------------------
# Category editors
# ----------------------------------------------------------------
edit_database() {
    echo ""
    echo -e "${BOLD}Database Configuration${NC}"
    echo -e "${DIM}Postgres credentials for the agent-company database${NC}"
    echo ""
    prompt_field "Database name" POSTGRES_DB
    prompt_field "Database user" POSTGRES_USER
    prompt_field_with_generate "Database password" POSTGRES_PASSWORD generate_password "validate_password \$1 16 password"

    # Derive RELAY_POSTGRES_URL
    CFG[RELAY_POSTGRES_URL]="postgresql://${CFG[POSTGRES_USER]}:${CFG[POSTGRES_PASSWORD]}@localhost:5432/${CFG[POSTGRES_DB]}"
}

edit_n8n() {
    echo ""
    echo -e "${BOLD}n8n Configuration${NC}"
    echo -e "${DIM}Workflow engine settings${NC}"

    # Encryption key warning
    if [ -d "$PROJECT_DIR/n8n-data" ] && [ -n "${OLD_CFG[N8N_ENCRYPTION_KEY]:-}" ]; then
        echo -e "  ${RED}⚠ Changing the encryption key will invalidate all stored credentials${NC}"
    fi
    echo ""

    prompt_field_with_generate "Encryption key" N8N_ENCRYPTION_KEY generate_encryption_key
    prompt_field "Owner email" N8N_OWNER_EMAIL false validate_email
    prompt_field_with_generate "Owner password" N8N_OWNER_PASSWORD generate_password "validate_n8n_password"

    echo -e "  ${DIM}API key will be auto-generated after n8n starts${NC}"
}

edit_smtp() {
    echo ""
    echo -e "${BOLD}Email (SMTP) Configuration${NC}"
    echo -e "${DIM}For Gmail: enable 2FA → create App Password at${NC}"
    echo -e "${DIM}https://myaccount.google.com/apppasswords${NC}"
    echo ""
    prompt_field "SMTP host" SMTP_HOST
    prompt_field "SMTP port" SMTP_PORT false validate_port
    prompt_field "SMTP user (email)" SMTP_USER false validate_email
    prompt_field "SMTP password" SMTP_PASS true
    prompt_field "From name" SMTP_FROM_NAME
}

edit_discord() {
    echo ""
    echo -e "${BOLD}Discord Bot Configuration${NC}"
    echo -e "${DIM}Create a bot at https://discord.com/developers/applications${NC}"
    echo -e "${DIM}Required intents: Message Content, Server Members${NC}"
    echo -e "${DIM}Permissions: Send Messages, Read Message History, Add Reactions${NC}"
    echo ""
    prompt_field "Bot token" DISCORD_BOT_TOKEN true
    prompt_field "Webhook URL" N8N_DISCORD_WEBHOOK_URL
    prompt_field "Channel IDs (comma-separated, empty=all)" DISCORD_CHANNEL_IDS
}

edit_telegram() {
    echo ""
    echo -e "${BOLD}Telegram Bot Configuration${NC}"
    echo -e "${DIM}1. Create a bot via @BotFather on Telegram → copy the token${NC}"
    echo -e "${DIM}2. Message your bot once from your account${NC}"
    echo -e "${DIM}3. Visit https://api.telegram.org/bot<TOKEN>/getUpdates → find chat.id${NC}"
    echo ""
    prompt_field "Bot token" TELEGRAM_BOT_TOKEN true
    prompt_field "Chat ID (your numeric Telegram user/chat id)" TELEGRAM_CHAT_ID
}

edit_communication() {
    while true; do
        echo ""
        echo -e "${BOLD}Communication Channels${NC}"
        echo -e "${DIM}Select which messaging platform(s) to configure${NC}"
        echo ""

        local discord_status=" "
        local telegram_status=" "
        [ -n "${CFG[DISCORD_BOT_TOKEN]:-}" ] && discord_status="${GREEN}✓${NC}"
        [ -n "${CFG[TELEGRAM_BOT_TOKEN]:-}" ] && [ -n "${CFG[TELEGRAM_CHAT_ID]:-}" ] && telegram_status="${GREEN}✓${NC}"

        printf "  [%b] 1. Discord\n" "$discord_status"
        printf "  [%b] 2. Telegram\n" "$telegram_status"
        echo "       3. Configure both"
        echo "       4. Back"
        echo ""
        echo -ne "  > "
        read -r choice

        case "$choice" in
            1) edit_discord ;;
            2) edit_telegram ;;
            3) edit_discord; edit_telegram ;;
            4|[bB]) return ;;
            *) echo -e "  ${RED}Invalid choice${NC}" ;;
        esac
    done
}

edit_dashboard() {
    echo ""
    echo -e "${BOLD}Dashboard Configuration${NC}"
    echo -e "${DIM}Credentials for the command center dashboard${NC}"
    echo ""
    prompt_field "Username" DASHBOARD_USER
    prompt_field "Password" DASHBOARD_PASSWORD true
    echo -e "  ${DIM}JWT secret (empty = auto-generate on each relay start)${NC}"
    prompt_field "JWT secret" JWT_SECRET true
}

edit_relay() {
    echo ""
    echo -e "${BOLD}Relay Server Configuration${NC}"
    echo ""
    prompt_field "Port" RELAY_PORT false validate_port
    prompt_field "Auth secret (empty=disabled)" RELAY_SECRET true
}

edit_system() {
    echo ""
    echo -e "${BOLD}System Configuration${NC}"
    echo ""
    prompt_field "Timezone" TZ
    echo -e "  ${CYAN}Project directory${NC} ${DIM}[${CFG[PROJECT_DIR]}]${NC} ${GREEN}✓ auto-detected${NC}"
}

# ----------------------------------------------------------------
# Write .env
# ----------------------------------------------------------------
write_env() {
    local tmpfile="$ENV_FILE.tmp"
    local date_str=$(date '+%Y-%m-%d %H:%M:%S')

    cat > "$tmpfile" << ENVEOF
# ================================================================
# Agent Company — Configuration
# Generated by setup-config.sh on $date_str
# ================================================================

# ================================================================
# Database
# ================================================================
POSTGRES_DB=${CFG[POSTGRES_DB]}
POSTGRES_USER=${CFG[POSTGRES_USER]}
POSTGRES_PASSWORD=${CFG[POSTGRES_PASSWORD]}

# ================================================================
# n8n
# ================================================================
N8N_ENCRYPTION_KEY=${CFG[N8N_ENCRYPTION_KEY]}
N8N_OWNER_EMAIL=${CFG[N8N_OWNER_EMAIL]}
N8N_OWNER_PASSWORD=${CFG[N8N_OWNER_PASSWORD]}
N8N_API_KEY=${CFG[N8N_API_KEY]}

# ================================================================
# Email (SMTP)
# ================================================================
SMTP_HOST=${CFG[SMTP_HOST]}
SMTP_PORT=${CFG[SMTP_PORT]}
SMTP_USER=${CFG[SMTP_USER]}
SMTP_PASS=${CFG[SMTP_PASS]}
SMTP_FROM_NAME="${CFG[SMTP_FROM_NAME]}"

# ================================================================
# Relay Server
# ================================================================
RELAY_PORT=${CFG[RELAY_PORT]}
RELAY_SECRET=${CFG[RELAY_SECRET]}
RELAY_POSTGRES_URL=postgresql://${CFG[POSTGRES_USER]}:${CFG[POSTGRES_PASSWORD]}@localhost:5432/${CFG[POSTGRES_DB]}

# ================================================================
# Dashboard
# ================================================================
DASHBOARD_USER=${CFG[DASHBOARD_USER]}
DASHBOARD_PASSWORD=${CFG[DASHBOARD_PASSWORD]}
JWT_SECRET=${CFG[JWT_SECRET]}

# ================================================================
# Discord Bot
# ================================================================
DISCORD_BOT_TOKEN=${CFG[DISCORD_BOT_TOKEN]}
N8N_DISCORD_WEBHOOK_URL=${CFG[N8N_DISCORD_WEBHOOK_URL]}
DISCORD_CHANNEL_IDS=${CFG[DISCORD_CHANNEL_IDS]}

# ================================================================
# Telegram Bot
# ================================================================
TELEGRAM_BOT_TOKEN=${CFG[TELEGRAM_BOT_TOKEN]}
TELEGRAM_CHAT_ID=${CFG[TELEGRAM_CHAT_ID]}

# ================================================================
# System
# ================================================================
TZ=${CFG[TZ]}
PROJECT_DIR=${CFG[PROJECT_DIR]}
ENVEOF

    # Backup existing .env
    if [ -f "$ENV_FILE" ]; then
        cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    fi

    # Atomic write
    mv "$tmpfile" "$ENV_FILE"
    echo -e "  ${GREEN}✓${NC} .env written"
}

# ----------------------------------------------------------------
# Write .env.example
# ----------------------------------------------------------------
write_env_example() {
    cat > "$ENV_EXAMPLE" << 'EXEOF'
# ================================================================
# Agent Company — Configuration Template
# Copy to .env and fill in your values, or run: ./scripts/setup-config.sh
# ================================================================

# ================================================================
# Database
# ================================================================
POSTGRES_DB=agentco
POSTGRES_USER=agentco
POSTGRES_PASSWORD=CHANGE_ME_min_16_chars

# ================================================================
# n8n
# ================================================================
# Generate with: openssl rand -hex 32
# CRITICAL: Never change this after first run
N8N_ENCRYPTION_KEY=CHANGE_ME_run_openssl_rand_hex_32
N8N_OWNER_EMAIL=admin@agentco.local
N8N_OWNER_PASSWORD=CHANGE_ME_min_8_chars_with_Upper1
N8N_API_KEY=

# ================================================================
# Email (SMTP)
# ================================================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_16_char_app_password
SMTP_FROM_NAME=Your Name

# ================================================================
# Relay Server
# ================================================================
RELAY_PORT=3456
RELAY_SECRET=
RELAY_POSTGRES_URL=postgresql://agentco:CHANGE_ME@localhost:5432/agentco

# ================================================================
# Dashboard
# ================================================================
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=CHANGE_ME
JWT_SECRET=

# ================================================================
# Discord Bot
# ================================================================
DISCORD_BOT_TOKEN=your_discord_bot_token
N8N_DISCORD_WEBHOOK_URL=http://localhost:5678/webhook/discord-message
DISCORD_CHANNEL_IDS=

# ================================================================
# Telegram Bot
# ================================================================
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_numeric_chat_id

# ================================================================
# System
# ================================================================
TZ=America/New_York
PROJECT_DIR=
EXEOF
    echo -e "  ${GREEN}✓${NC} .env.example updated"
}

# ----------------------------------------------------------------
# Generate systemd services from templates
# ----------------------------------------------------------------
generate_systemd_services() {
    mkdir -p "$SYSTEMD_DIR"

    for template in "$TEMPLATES_DIR"/*.template; do
        local filename=$(basename "$template" .template)
        local output="$SYSTEMD_DIR/$filename"

        sed -e "s|{{PROJECT_DIR}}|${CFG[PROJECT_DIR]}|g" \
            -e "s|{{HOME}}|$USER_HOME|g" \
            "$template" > "$output"
    done

    systemctl --user daemon-reload 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Systemd services generated"
}

# ----------------------------------------------------------------
# Detect what changed
# ----------------------------------------------------------------
detect_changes() {
    CHANGED_CATEGORIES=()
    local db_changed=false n8n_changed=false smtp_changed=false
    local discord_changed=false telegram_changed=false
    local dashboard_changed=false relay_changed=false system_changed=false

    for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD; do
        [ "${CFG[$key]:-}" != "${OLD_CFG[$key]:-}" ] && db_changed=true
    done
    for key in N8N_ENCRYPTION_KEY N8N_OWNER_EMAIL N8N_OWNER_PASSWORD; do
        [ "${CFG[$key]:-}" != "${OLD_CFG[$key]:-}" ] && n8n_changed=true
    done
    for key in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM_NAME; do
        [ "${CFG[$key]:-}" != "${OLD_CFG[$key]:-}" ] && smtp_changed=true
    done
    for key in DISCORD_BOT_TOKEN N8N_DISCORD_WEBHOOK_URL DISCORD_CHANNEL_IDS; do
        [ "${CFG[$key]:-}" != "${OLD_CFG[$key]:-}" ] && discord_changed=true
    done
    for key in TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
        [ "${CFG[$key]:-}" != "${OLD_CFG[$key]:-}" ] && telegram_changed=true
    done
    for key in DASHBOARD_USER DASHBOARD_PASSWORD JWT_SECRET; do
        [ "${CFG[$key]:-}" != "${OLD_CFG[$key]:-}" ] && dashboard_changed=true
    done
    for key in RELAY_PORT RELAY_SECRET; do
        [ "${CFG[$key]:-}" != "${OLD_CFG[$key]:-}" ] && relay_changed=true
    done
    [ "${CFG[TZ]:-}" != "${OLD_CFG[TZ]:-}" ] && system_changed=true
    [ "${CFG[PROJECT_DIR]:-}" != "${OLD_CFG[PROJECT_DIR]:-}" ] && system_changed=true

    $db_changed && CHANGED_CATEGORIES[database]=1
    $n8n_changed && CHANGED_CATEGORIES[n8n]=1
    $smtp_changed && CHANGED_CATEGORIES[smtp]=1
    $discord_changed && CHANGED_CATEGORIES[discord]=1
    $telegram_changed && CHANGED_CATEGORIES[telegram]=1
    $dashboard_changed && CHANGED_CATEGORIES[dashboard]=1
    $relay_changed && CHANGED_CATEGORIES[relay]=1
    $system_changed && CHANGED_CATEGORIES[system]=1
}

# ----------------------------------------------------------------
# Restart affected services
# ----------------------------------------------------------------
restart_services() {
    local need_docker=false need_relay=false need_bot=false need_telegram_bot=false

    # System change = everything
    if [ -n "${CHANGED_CATEGORIES[system]:-}" ]; then
        need_docker=true; need_relay=true; need_bot=true; need_telegram_bot=true
    fi
    [ -n "${CHANGED_CATEGORIES[database]:-}" ] && need_docker=true && need_relay=true
    [ -n "${CHANGED_CATEGORIES[n8n]:-}" ] && need_docker=true
    [ -n "${CHANGED_CATEGORIES[smtp]:-}" ] && need_docker=true
    [ -n "${CHANGED_CATEGORIES[discord]:-}" ] && need_bot=true
    [ -n "${CHANGED_CATEGORIES[telegram]:-}" ] && need_telegram_bot=true
    [ -n "${CHANGED_CATEGORIES[dashboard]:-}" ] && need_relay=true
    [ -n "${CHANGED_CATEGORIES[relay]:-}" ] && need_relay=true

    if $need_docker; then
        echo -ne "  Docker stack ..."
        if command -v docker &>/dev/null; then
            cd "$PROJECT_DIR" && docker compose up -d > /dev/null 2>&1
            echo -e " ${GREEN}✓${NC}"
        else
            echo -e " ${YELLOW}skipped (docker not found)${NC}"
        fi
    fi

    if $need_relay; then
        echo -ne "  Relay server ..."
        if command -v systemctl &>/dev/null; then
            systemctl --user enable --now agentco-relay.service > /dev/null 2>&1 || true
            systemctl --user restart agentco-relay.service > /dev/null 2>&1 || true
            echo -e " ${GREEN}✓${NC}"
        else
            echo -e " ${YELLOW}skipped (no systemd)${NC}"
        fi
    fi

    if $need_bot; then
        echo -ne "  Discord bot ..."
        if command -v systemctl &>/dev/null; then
            systemctl --user enable --now agentco-bot.service > /dev/null 2>&1 || true
            systemctl --user restart agentco-bot.service > /dev/null 2>&1 || true
            echo -e " ${GREEN}✓${NC}"
        else
            echo -e " ${YELLOW}skipped (no systemd)${NC}"
        fi
    fi

    if $need_telegram_bot; then
        echo -ne "  Telegram bot ..."
        if [ -n "${CFG[TELEGRAM_BOT_TOKEN]:-}" ] && [ -n "${CFG[TELEGRAM_CHAT_ID]:-}" ]; then
            if command -v systemctl &>/dev/null; then
                systemctl --user enable --now agentco-telegram-bot.service > /dev/null 2>&1 || true
                systemctl --user restart agentco-telegram-bot.service > /dev/null 2>&1 || true
                echo -e " ${GREEN}✓${NC}"
            elif [ -x "$PROJECT_DIR/telegram-bot/start.sh" ]; then
                "$PROJECT_DIR/telegram-bot/stop.sh" > /dev/null 2>&1 || true
                "$PROJECT_DIR/telegram-bot/start.sh" > /dev/null 2>&1 && echo -e " ${GREEN}✓${NC}" || echo -e " ${YELLOW}failed${NC}"
            else
                echo -e " ${YELLOW}skipped (no systemd or start.sh)${NC}"
            fi
        else
            echo -e " ${YELLOW}skipped (no token/chat id)${NC}"
        fi
    fi

    # Enable healthcheck timer
    if command -v systemctl &>/dev/null; then
        systemctl --user enable --now agentco-healthcheck.timer > /dev/null 2>&1 || true
    fi

    # Enable linger
    loginctl enable-linger "$(whoami)" 2>/dev/null || true
}

# ----------------------------------------------------------------
# Provision n8n (owner, API key, credentials, workflows)
# ----------------------------------------------------------------
provision_n8n() {
    if ! command -v docker &>/dev/null; then
        echo -e "  ${YELLOW}Skipping n8n provisioning (docker not available)${NC}"
        return
    fi

    # Wait for n8n
    echo -ne "  Waiting for n8n ..."
    local attempts=0
    while [ $attempts -lt 30 ]; do
        if curl -s http://localhost:5678/healthz 2>/dev/null | grep -q ok; then
            echo -e " ${GREEN}✓${NC}"
            break
        fi
        sleep 2
        attempts=$((attempts + 1))
    done
    if [ $attempts -ge 30 ]; then
        echo -e " ${RED}✗ timeout${NC}"
        return
    fi

    # Create owner account (idempotent)
    echo -ne "  Owner account ..."
    local setup_result
    setup_result=$(curl -s -X POST http://localhost:5678/rest/owner/setup \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"${CFG[N8N_OWNER_EMAIL]}\",\"firstName\":\"Admin\",\"lastName\":\"AgentCo\",\"password\":\"${CFG[N8N_OWNER_PASSWORD]}\"}" 2>/dev/null)

    if echo "$setup_result" | grep -q '"email"'; then
        echo -e " ${GREEN}✓ created${NC}"
    else
        echo -e " ${GREEN}✓ exists${NC}"
    fi

    # Auto-generate API key if empty
    if [ -z "${CFG[N8N_API_KEY]}" ]; then
        echo -ne "  Generating API key ..."

        # Login to get auth token
        local auth_token
        auth_token=$(curl -s -c - -X POST http://localhost:5678/rest/login \
            -H "Content-Type: application/json" \
            -d "{\"emailOrLdapLoginId\":\"${CFG[N8N_OWNER_EMAIL]}\",\"password\":\"${CFG[N8N_OWNER_PASSWORD]}\"}" 2>/dev/null \
            | grep "n8n-auth" | awk '{print $NF}')

        if [ -n "$auth_token" ]; then
            # Get scopes from existing key or use empty (n8n will give full scopes)
            local scopes
            scopes=$(curl -s -H "Cookie: n8n-auth=$auth_token" "http://localhost:5678/rest/api-keys" 2>/dev/null \
                | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['data'][0]['scopes']) if d.get('data') else '[]')" 2>/dev/null || echo '[]')

            local expires_at
            expires_at=$(python3 -c "import time; print(int((time.time() + 315360000) * 1000))")

            local key_result
            key_result=$(curl -s -H "Cookie: n8n-auth=$auth_token" -X POST "http://localhost:5678/rest/api-keys" \
                -H "Content-Type: application/json" \
                -d "{\"label\":\"setup-script\",\"scopes\":$scopes,\"expiresAt\":$expires_at}" 2>/dev/null)

            local api_key
            api_key=$(echo "$key_result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('apiKey',''))" 2>/dev/null)

            if [ -n "$api_key" ]; then
                CFG[N8N_API_KEY]="$api_key"
                # Write key back to .env (re-write the whole file)
                write_env > /dev/null 2>&1
                echo -e " ${GREEN}✓${NC}"
            else
                echo -e " ${YELLOW}✗ manual setup needed in n8n UI${NC}"
            fi
        else
            echo -e " ${YELLOW}✗ login failed${NC}"
        fi
    fi

    # Provision credentials
    echo -ne "  Provisioning credentials ..."
    cd "$PROJECT_DIR" && make provision-credentials > /dev/null 2>&1 && echo -e " ${GREEN}✓${NC}" || echo -e " ${YELLOW}✗${NC}"

    # Import and publish workflows
    echo -ne "  Importing workflows ..."
    cd "$PROJECT_DIR" && make import > /dev/null 2>&1 && echo -e " ${GREEN}✓${NC}" || echo -e " ${YELLOW}✗${NC}"

    echo -ne "  Publishing workflows ..."
    cd "$PROJECT_DIR" && make publish-all > /dev/null 2>&1 && echo -e " ${GREEN}✓${NC}" || echo -e " ${YELLOW}✗${NC}"

    # Restart n8n to register webhooks
    echo -ne "  Registering webhooks ..."
    docker restart agentco_n8n > /dev/null 2>&1
    sleep 5
    echo -e " ${GREEN}✓${NC}"
}

# ----------------------------------------------------------------
# Create workspace directories
# ----------------------------------------------------------------
create_workspace() {
    mkdir -p "$USER_HOME/.agent-co/workspace/context/core"
    mkdir -p "$USER_HOME/.agent-co/workspace/context/business-guides"
    mkdir -p "$USER_HOME/.agent-co/workspace/context/technical-guides"
    mkdir -p "$USER_HOME/.agent-co/workspace/context/technical-research"
    mkdir -p "$USER_HOME/.agent-co/workspace/context/design"
    mkdir -p "$USER_HOME/.agent-co/workspace/context/outreach"
    mkdir -p "$USER_HOME/.agent-co/workspace/context/self-build/agents/employees"
    mkdir -p "$USER_HOME/.agent-co/workspace/memory"
    mkdir -p "$USER_HOME/.agent-co/workspace/projects"
    mkdir -p "$USER_HOME/.agent-co/workspace/research/leads"
    echo -e "  ${GREEN}✓${NC} Workspace directories created"
}

# ----------------------------------------------------------------
# Main menu
# ----------------------------------------------------------------
show_menu() {
    local categories=("Database" "n8n" "Email (SMTP)" "Communication" "Dashboard" "Relay Server" "System")
    local functions=(edit_database edit_n8n edit_smtp edit_communication edit_dashboard edit_relay edit_system)
    # For "Communication", a field counts as filled if EITHER Discord or Telegram is configured.
    local check_fields=(
        "POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD"
        "N8N_ENCRYPTION_KEY N8N_OWNER_EMAIL N8N_OWNER_PASSWORD"
        "SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM_NAME"
        "__COMMUNICATION__"
        "DASHBOARD_USER DASHBOARD_PASSWORD"
        "RELAY_PORT"
        "TZ"
    )

    while true; do
        echo ""
        echo ""
        echo -e "${BOLD}╔═══════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}║  AGENT COMPANY — Configuration                ║${NC}"
        echo -e "${BOLD}╠═══════════════════════════════════════════════╝${NC}"
        echo "║"

        for i in "${!categories[@]}"; do
            local filled=0 total=0 status_text=""

            if [ "${check_fields[$i]}" = "__COMMUNICATION__" ]; then
                # Communication: Discord and/or Telegram — either counts as configured
                local discord_set=0 telegram_set=0
                [ -n "${CFG[DISCORD_BOT_TOKEN]:-}" ] && discord_set=1
                [ -n "${CFG[TELEGRAM_BOT_TOKEN]:-}" ] && [ -n "${CFG[TELEGRAM_CHAT_ID]:-}" ] && telegram_set=1
                local active=()
                [ $discord_set -eq 1 ] && active+=("Discord")
                [ $telegram_set -eq 1 ] && active+=("Telegram")
                if [ ${#active[@]} -eq 0 ]; then
                    status_text="none configured"
                else
                    status_text="$(IFS=, ; echo "${active[*]}")"
                fi
                filled=$(( discord_set + telegram_set ))
                total=2
            else
                for field in ${check_fields[$i]}; do
                    total=$((total + 1))
                    [ -n "${CFG[$field]:-}" ] && filled=$((filled + 1))
                done
                status_text="$filled/$total fields"
            fi

            local check=" "
            [ $filled -gt 0 ] && [ $filled -eq $total ] && check="${GREEN}✓${NC}"
            [ "${check_fields[$i]}" = "__COMMUNICATION__" ] && [ $filled -gt 0 ] && check="${GREEN}✓${NC}"

            printf "║  [%b] %d. %-20s (%s)\n" "$check" $((i+1)) "${categories[$i]}" "$status_text"
        done

        echo "║"
        echo -e "║  ${DIM}Enter 1-7 to edit, S to submit, Q to quit${NC}"
        echo ""
        echo -ne "  > "
        read -r choice

        case "$choice" in
            [1-7])
                local idx=$((choice - 1))
                ${functions[$idx]}
                ;;
            [sS])
                submit_config
                return
                ;;
            [qQ])
                echo -e "\n${DIM}Configuration cancelled. No changes written.${NC}"
                exit 0
                ;;
            *)
                echo -e "  ${RED}Invalid choice${NC}"
                ;;
        esac
    done
}

# ----------------------------------------------------------------
# Submit — write everything and restart
# ----------------------------------------------------------------
submit_config() {
    echo ""
    echo -e "${BOLD}Submitting configuration...${NC}"
    echo ""

    detect_changes
    local is_first_run=false
    [ ! -f "$ENV_FILE" ] || [ -z "${OLD_CFG[POSTGRES_DB]:-}" ] && is_first_run=true

    echo -e "${DIM}Writing files:${NC}"
    write_env
    write_env_example
    generate_systemd_services
    create_workspace

    echo ""
    echo -e "${DIM}Restarting services:${NC}"
    restart_services

    echo ""
    echo -e "${DIM}Provisioning:${NC}"
    provision_n8n

    echo ""
    echo -e "${GREEN}${BOLD}✓ Configuration complete.${NC}"
    echo ""
    echo -e "  Dashboard:  ${CYAN}http://localhost:3001${NC}"
    echo -e "  n8n:        ${CYAN}http://localhost:5678${NC}"
    echo -e "  Relay:      ${CYAN}http://localhost:${CFG[RELAY_PORT]}${NC}"
    echo ""
}

# ----------------------------------------------------------------
# Prerequisite checks
# ----------------------------------------------------------------
check_prerequisites() {
    echo -e "${DIM}Checking prerequisites...${NC}"
    local ok=true

    echo -ne "  Docker: "
    if command -v docker &>/dev/null; then echo -e "${GREEN}✓${NC}"; else echo -e "${YELLOW}not found (stack won't start)${NC}"; fi

    echo -ne "  Node.js: "
    if command -v node &>/dev/null; then echo -e "${GREEN}✓ $(node --version)${NC}"; else echo -e "${RED}✗ required${NC}"; ok=false; fi

    echo -ne "  Claude CLI: "
    if command -v claude &>/dev/null; then echo -e "${GREEN}✓${NC}"; else echo -e "${YELLOW}not found (relay won't call Claude)${NC}"; fi

    echo -ne "  openssl: "
    if command -v openssl &>/dev/null; then echo -e "${GREEN}✓${NC}"; else echo -e "${RED}✗ required for secret generation${NC}"; ok=false; fi

    echo -ne "  curl: "
    if command -v curl &>/dev/null; then echo -e "${GREEN}✓${NC}"; else echo -e "${RED}✗ required${NC}"; ok=false; fi

    echo -ne "  systemd: "
    if command -v systemctl &>/dev/null && systemctl --user status > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${YELLOW}not available (services won't auto-start)${NC}"
    fi

    if ! $ok; then
        echo -e "\n${RED}Missing required tools. Install them and re-run.${NC}"
        exit 1
    fi
    echo ""
}

# ----------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------
main() {
    echo ""
    echo -e "${BOLD}Agent Company — Setup${NC}"
    echo -e "${DIM}Interactive configuration for the agent-company stack${NC}"
    echo ""

    check_prerequisites
    load_env
    apply_defaults
    show_menu
}

main "$@"
