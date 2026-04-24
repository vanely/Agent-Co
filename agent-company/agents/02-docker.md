# Agent 02 — Docker

## What You Own

You write `docker-compose.yml` and bring the stack up.
You verify both containers reach healthy/running status.
You do NOT write application code, schemas, or scripts.

## Precondition

Agent 01 (scaffold) must be complete. Verify:
```bash
ls ~/agent-company/.env && echo "OK" || echo "FAIL — run agent 01 first"
```

## Done Condition

`docker compose ps` in `~/agent-company/` shows:
- `agentco_postgres` with status `healthy`
- `agentco_n8n` with status `running` (not restarting, not exited)

---

## Step 1 — Verify .env Is Populated

```bash
cd ~/agent-company

# Check no placeholder values remain for critical fields
grep -E "CHANGE_ME|your@gmail" .env && echo "WARNING: placeholders remain in .env" || echo ".env looks populated"

# Confirm encryption key length (should be 64 hex chars)
KEY=$(grep N8N_ENCRYPTION_KEY .env | cut -d= -f2)
echo "Encryption key length: ${#KEY} (must be 64)"
```

If `N8N_ENCRYPTION_KEY` is still a placeholder, generate one now:
```bash
KEY=$(openssl rand -hex 32)
sed -i.bak "s|CHANGE_ME_run_openssl_rand_hex_32|$KEY|" ~/agent-company/.env
rm ~/agent-company/.env.bak
echo "Key set: $KEY"
```

---

## Step 2 — Write docker-compose.yml

Write `~/agent-company/docker-compose.yml` with this exact content:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: agentco_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./postgres-data:/var/lib/postgresql/data
      - ./scripts/sql/init.sql:/docker-entrypoint-initdb.d/init.sql
    # Postgres is NOT exposed to the host by default.
    # n8n reaches it via the Docker bridge network using hostname 'postgres'.
    # Uncomment below ONLY during dev if you need psql from the host:
    # ports:
    #   - "5432:5432"
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}']
      interval: 5s
      timeout: 5s
      retries: 10
    networks:
      - agentco

  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    container_name: agentco_n8n
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      # Core
      N8N_HOST: localhost
      N8N_PORT: 5678
      N8N_PROTOCOL: http
      WEBHOOK_URL: http://localhost:5678/
      GENERIC_TIMEZONE: ${TZ}

      # Basic auth — always enabled
      N8N_BASIC_AUTH_ACTIVE: "true"
      N8N_BASIC_AUTH_USER: ${N8N_BASIC_AUTH_USER}
      N8N_BASIC_AUTH_PASSWORD: ${N8N_BASIC_AUTH_PASSWORD}

      # Encryption key — NEVER change after first run
      # Changing it invalidates all stored credentials
      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}

      # Database backend — Postgres, not default SQLite
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_PORT: 5432
      DB_POSTGRESDB_DATABASE: ${POSTGRES_DB}
      DB_POSTGRESDB_USER: ${POSTGRES_USER}
      DB_POSTGRESDB_PASSWORD: ${POSTGRES_PASSWORD}

      # Enable Execute Command node (disabled by default in n8n v2.0+)
      # Used for running compiled TS scripts — NOT for Claude (that goes via relay)
      N8N_EXECUTE_COMMAND_ENABLED: "true"
      N8N_BLOCK_ENV_VARS_IN_EXECUTE_COMMAND: "false"

      # Secrets passed into container so scripts can read them via process.env
      POSTGRES_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      SMTP_FROM_NAME: ${SMTP_FROM_NAME}

      # Relay URL — host.docker.internal resolves to host machine from inside container
      # This is how n8n workflows call the claude CLI on the host
      CLAUDE_RELAY_URL: http://host.docker.internal:${RELAY_PORT:-3456}

      # Execution log retention
      EXECUTIONS_DATA_SAVE_ON_ERROR: all
      EXECUTIONS_DATA_SAVE_ON_SUCCESS: last
      EXECUTIONS_DATA_MAX_AGE: 168        # 7 days in hours

      # Timeouts — agent tasks can run for minutes
      EXECUTIONS_TIMEOUT: 3600            # 1 hour max per execution
      EXECUTIONS_TIMEOUT_MAX: 7200        # absolute hard cap

    volumes:
      - ./n8n-data:/home/node/.n8n
      - ./scripts:/scripts:ro             # TS scripts — read-only inside container
      - ./workflows:/workflows:ro         # workflow JSON exports

    depends_on:
      postgres:
        condition: service_healthy

    # Linux only: add this if host.docker.internal does not resolve
    # extra_hosts:
    #   - "host.docker.internal:host-gateway"

    networks:
      - agentco

  # Postgres admin GUI — only starts when: docker compose --profile dev up -d
  adminer:
    image: adminer:latest
    container_name: agentco_adminer
    restart: unless-stopped
    ports:
      - "8080:8080"
    networks:
      - agentco
    profiles:
      - dev

networks:
  agentco:
    driver: bridge
```

---

## Step 3 — Validate YAML Before Starting

```bash
cd ~/agent-company
docker compose config --quiet && echo "YAML valid" || echo "YAML ERROR — fix docker-compose.yml before continuing"
```

Do not proceed if this fails.

---

## Step 4 — Check init.sql Exists

The Postgres container mounts `./scripts/sql/init.sql` on first startup to create
the schema. If it doesn't exist yet (agent 04 hasn't run), we need a placeholder
so Postgres starts successfully now. Agent 04 will write the real schema.

```bash
if [ ! -f ~/agent-company/scripts/sql/init.sql ]; then
  echo "-- init.sql placeholder — agent 04 will write the real schema" \
    > ~/agent-company/scripts/sql/init.sql
  echo "Created placeholder init.sql"
else
  echo "init.sql already exists"
fi
```

---

## Step 5 — Start The Stack

```bash
cd ~/agent-company
docker compose up -d
```

Expected output:
```
[+] Running 3/3
 ✔ Network agentco_agentco    Created
 ✔ Container agentco_postgres  Started
 ✔ Container agentco_n8n       Started
```

---

## Step 6 — Wait For Postgres Health Check

Postgres runs a health check every 5 seconds with up to 10 retries (50 seconds max).
Wait for it to become healthy before continuing:

```bash
echo "Waiting for Postgres to become healthy..."
for i in $(seq 1 12); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' agentco_postgres 2>/dev/null)
  echo "  Attempt $i: $STATUS"
  if [ "$STATUS" = "healthy" ]; then
    echo "Postgres is healthy."
    break
  fi
  sleep 5
done

# Final check
STATUS=$(docker inspect --format='{{.State.Health.Status}}' agentco_postgres)
if [ "$STATUS" != "healthy" ]; then
  echo "ERROR: Postgres did not become healthy. Check logs:"
  docker logs agentco_postgres --tail 30
  exit 1
fi
```

---

## Step 7 — Verify n8n Started

```bash
echo "Checking n8n..."
sleep 10  # Give n8n time to initialize

# Check it's running (not restarting)
N8N_STATUS=$(docker inspect --format='{{.State.Status}}' agentco_n8n 2>/dev/null)
echo "n8n container status: $N8N_STATUS"

if [ "$N8N_STATUS" != "running" ]; then
  echo "ERROR: n8n is not running. Logs:"
  docker logs agentco_n8n --tail 40
  exit 1
fi

# Check it responds on port 5678
echo "Checking n8n HTTP..."
for i in $(seq 1 12); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5678/healthz 2>/dev/null)
  echo "  Attempt $i: HTTP $HTTP_CODE"
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
    # 401 = auth required = n8n is up
    echo "n8n is responding."
    break
  fi
  sleep 5
done
```

---

## Step 8 — Final Status Check

```bash
cd ~/agent-company
docker compose ps
```

Expected: both containers show `running` or `healthy`. No container should show
`restarting` or `exited`.

If n8n is restarting, check logs:
```bash
docker logs agentco_n8n --tail 50
```

Common causes of n8n restart loop:
- `N8N_ENCRYPTION_KEY` is still a placeholder string (not real hex)
- Postgres connection failed (check POSTGRES_PASSWORD matches in .env)
- Port 5678 already in use on the host (`lsof -i :5678`)

---

## Step 9 — Linux Host-Gateway Note

On **Linux**, `host.docker.internal` may not resolve by default. If n8n workflows
fail to reach the relay later, add this to the `n8n` service in `docker-compose.yml`:

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Then restart: `docker compose restart n8n`

This is already in the docker-compose.yml above as a comment. On Mac and Windows it
is not needed. Uncomment it only if relay calls fail with DNS errors.

---

## Step 10 — Update BUILD_STATE.md

```bash
sed -i.bak 's/- \[ \] 02-docker/- [x] 02-docker/' ~/agent-company/BUILD_STATE.md
rm ~/agent-company/BUILD_STATE.md.bak 2>/dev/null || true
```

Return to `agents/00-coordinator.md` and proceed to Agent 03.
