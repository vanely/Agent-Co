# Agent 03 — Claude Code Relay Server

## What You Own

You write the complete relay server (`relay/src/server.ts`), install its
dependencies, compile it, and confirm it responds to HTTP requests.

The relay is a Node.js/Express server that runs **on the host machine** (not in
Docker). It receives tasks from n8n via HTTP POST and executes them by running
`claude --dangerously-skip-permissions -p '<task>'` as the local user.

## Why This Exists

`claude --dangerously-skip-permissions` authenticates using credentials stored in
`~/.claude/` on the host. Docker containers cannot access host auth files.
The relay bridges the gap: n8n (inside container) → HTTP → relay (on host) → exec claude.

## Precondition

Agent 01 (scaffold) must be complete:
```bash
ls ~/agent-company/relay/src/ && ls ~/agent-company/relay/package.json && echo "OK" || echo "FAIL — run agent 01 first"
```

## Done Condition

- `~/agent-company/relay/dist/server.js` exists
- `curl http://localhost:3456/health` returns `{"status":"ok",...}`
- `curl -X POST http://localhost:3456/run-agent -H 'Content-Type: application/json' -d '{"task":"Reply with the single word PONG and nothing else."}'` returns a response with `"success":true`

---

## Step 1 — Verify claude CLI Is Accessible

The relay execs `claude` — it must be in PATH on the host:

```bash
which claude && echo "claude found: $(which claude)" || echo "ERROR: claude not in PATH"
claude --version 2>/dev/null || echo "ERROR: claude --version failed"
```

If `claude` is not found, the relay will build and start fine but every
`/run-agent` call will fail with "command not found". Resolve the PATH issue
before testing, but you can still proceed with building the relay.

---

## Step 2 — Write relay/src/server.ts

Write this file exactly at `~/agent-company/relay/src/server.ts`:

```typescript
import express, { Request, Response, NextFunction } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = parseInt(process.env.RELAY_PORT ?? '3456', 10);
const RELAY_SECRET = process.env.RELAY_SECRET ?? '';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface RunAgentRequest {
  task: string;
  timeoutSeconds?: number;
}

interface RunAgentResponse {
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

// ----------------------------------------------------------------
// Auth middleware (optional — only active when RELAY_SECRET is set)
// ----------------------------------------------------------------

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!RELAY_SECRET) {
    next();
    return;
  }
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${RELAY_SECRET}`) {
    res.status(401).json({ success: false, error: 'Unauthorized', durationMs: 0 });
    return;
  }
  next();
}

// ----------------------------------------------------------------
// POST /run-agent — execute a claude task
// ----------------------------------------------------------------

app.post('/run-agent', authMiddleware, async (req: Request, res: Response) => {
  const { task, timeoutSeconds = 300 }: RunAgentRequest = req.body;

  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: 'task is required and must be a non-empty string',
      durationMs: 0,
    } satisfies RunAgentResponse);
    return;
  }

  const startMs = Date.now();
  const preview = task.slice(0, 100).replace(/\n/g, ' ');
  console.log(`[relay] [${new Date().toISOString()}] START: "${preview}..."`);

  try {
    // Use JSON.stringify to safely quote the task — handles single quotes,
    // newlines, special chars without shell injection risk
    const command = `claude --dangerously-skip-permissions -p ${JSON.stringify(task)}`;

    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutSeconds * 1000,
      maxBuffer: 10 * 1024 * 1024, // 10MB stdout buffer
      env: { ...process.env },      // full host env — includes PATH and ~/.claude auth
      shell: '/bin/bash',
    });

    const durationMs = Date.now() - startMs;

    if (stderr && stderr.trim().length > 0) {
      // claude sometimes writes progress to stderr — log but don't fail
      console.warn(`[relay] stderr: ${stderr.slice(0, 300)}`);
    }

    console.log(`[relay] [${new Date().toISOString()}] DONE in ${durationMs}ms`);

    res.json({
      success: true,
      output: stdout.trim(),
      durationMs,
    } satisfies RunAgentResponse);

  } catch (err: unknown) {
    const durationMs = Date.now() - startMs;
    let errorMsg: string;

    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      if (e['killed'] || e['signal'] === 'SIGTERM') {
        errorMsg = `Timeout: task exceeded ${timeoutSeconds}s limit`;
      } else if (typeof e['stderr'] === 'string' && e['stderr'].trim()) {
        errorMsg = e['stderr'].trim().slice(0, 500);
      } else if (typeof e['message'] === 'string') {
        errorMsg = e['message'].slice(0, 500);
      } else {
        errorMsg = 'Unknown error';
      }
    } else {
      errorMsg = String(err);
    }

    console.error(`[relay] [${new Date().toISOString()}] FAILED after ${durationMs}ms: ${errorMsg}`);

    res.status(500).json({
      success: false,
      error: errorMsg,
      durationMs,
    } satisfies RunAgentResponse);
  }
});

// ----------------------------------------------------------------
// GET /health — n8n polls this before running agent workflows
// ----------------------------------------------------------------

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    port: PORT,
    auth: RELAY_SECRET ? 'enabled' : 'disabled',
  });
});

// ----------------------------------------------------------------
// Start
// ----------------------------------------------------------------

// Bind to 127.0.0.1 only — not reachable from outside the machine
// Docker containers reach it via host.docker.internal which maps to the host's
// loopback interface on Mac/Windows. On Linux, host.docker.internal maps to the
// docker bridge gateway (172.17.0.1), so change '127.0.0.1' to '0.0.0.0' on Linux
// if the relay can't be reached from inside containers.

const BIND_HOST = process.platform === 'linux' ? '0.0.0.0' : '127.0.0.1';

app.listen(PORT, BIND_HOST, () => {
  console.log(`[relay] Claude Code relay server running`);
  console.log(`[relay] Listening on http://${BIND_HOST}:${PORT}`);
  console.log(`[relay] Auth: ${RELAY_SECRET ? 'ENABLED (Bearer token required)' : 'DISABLED (local only)'}`);
  console.log(`[relay] Claude CLI: ${process.env.PATH?.includes('claude') ? 'in PATH' : 'check PATH if calls fail'}`);
});
```

---

## Step 3 — Install Dependencies

```bash
cd ~/agent-company/relay
npm install
```

Expected: installs express and devDependencies. No errors.

```bash
ls node_modules/express && echo "express installed" || echo "ERROR: express not found"
ls node_modules/typescript && echo "typescript installed" || echo "ERROR: typescript not found"
```

---

## Step 4 — Compile TypeScript

```bash
cd ~/agent-company/relay
npm run build
```

Expected output: no errors, creates `dist/server.js`.

```bash
ls ~/agent-company/relay/dist/server.js && echo "Compiled OK" || echo "ERROR: compilation failed"
```

If compilation fails, check the error output. Common issues:
- TypeScript strict mode error → check the type in server.ts
- Missing `@types/express` → re-run `npm install`

---

## Step 5 — Start The Relay

```bash
# Load RELAY_PORT from .env
export $(grep -v '^#' ~/agent-company/.env | grep RELAY_PORT | xargs)

# Start in background, redirect logs to a file
cd ~/agent-company/relay
nohup node dist/server.js >> ~/agent-company/relay/relay.log 2>&1 &
RELAY_PID=$!
echo $RELAY_PID > ~/agent-company/relay/relay.pid
echo "Relay started with PID $RELAY_PID"
sleep 2
```

---

## Step 6 — Verify Health Endpoint

```bash
curl -s http://localhost:3456/health | python3 -m json.tool
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-03-25T...",
  "port": 3456,
  "auth": "disabled"
}
```

If this fails:
```bash
# Check if the process is running
cat ~/agent-company/relay/relay.pid | xargs ps -p 2>/dev/null || echo "Process not running"

# Check logs
cat ~/agent-company/relay/relay.log
```

---

## Step 7 — Smoke Test: Run A Task

```bash
curl -s -X POST http://localhost:3456/run-agent \
  -H "Content-Type: application/json" \
  -d '{"task": "Reply with only the word PONG and nothing else. No explanation, no punctuation, just PONG.", "timeoutSeconds": 60}' \
  | python3 -m json.tool
```

Expected response:
```json
{
  "success": true,
  "output": "PONG",
  "durationMs": 3000
}
```

The exact durationMs will vary. What matters: `"success": true` and `"output"` contains "PONG".

If `"success": false`:
- Error "command not found" → `claude` is not in PATH for the process. See Step 1.
- Error "Timeout" → increase timeoutSeconds or check `claude` isn't hanging
- Error from claude itself → check you are logged in: run `claude --version` manually

---

## Step 8 — Test From Docker Network (Important)

n8n calls the relay using `host.docker.internal`. Verify this hostname resolves
from inside the n8n container:

```bash
# Test DNS resolution from inside n8n container
docker exec agentco_n8n wget -q -O- http://host.docker.internal:3456/health 2>/dev/null || \
docker exec agentco_n8n curl -s http://host.docker.internal:3456/health 2>/dev/null || \
echo "Cannot reach relay from n8n container"
```

If this fails and you are on **Linux**:

1. Stop the relay: `kill $(cat ~/agent-company/relay/relay.pid)`
2. The relay's `server.ts` already handles this — on Linux it binds to `0.0.0.0` instead of `127.0.0.1` (see the BIND_HOST logic in server.ts).
3. Restart: `cd ~/agent-company/relay && nohup node dist/server.js >> relay.log 2>&1 & echo $! > relay.pid`
4. Also add to the `n8n` service in `docker-compose.yml`:
   ```yaml
       extra_hosts:
         - "host.docker.internal:host-gateway"
   ```
5. Restart n8n: `docker compose restart n8n`

If this fails on **Mac/Windows**: something unusual is happening. Check Docker Desktop
settings — "host.docker.internal" must be enabled (it is by default).

---

## Step 9 — pm2 Setup (Optional But Recommended)

For the relay to survive terminal sessions and restart on machine reboot:

```bash
# Install pm2 globally if not present
which pm2 || npm install -g pm2

# Register the relay with pm2
cd ~/agent-company/relay
pm2 start dist/server.js --name claude-relay

# Save the process list
pm2 save

# Configure pm2 to start on reboot
pm2 startup
# Follow the printed command (usually: sudo env PATH=... pm2 startup ...)
```

To check relay status later: `pm2 status claude-relay`
To see logs: `pm2 logs claude-relay`
To restart: `pm2 restart claude-relay`

---

## Step 10 — Update BUILD_STATE.md

```bash
sed -i.bak 's/- \[ \] 03-relay/- [x] 03-relay/' ~/agent-company/BUILD_STATE.md
rm ~/agent-company/BUILD_STATE.md.bak 2>/dev/null || true
```

Return to `agents/00-coordinator.md` and proceed to Agent 04.
