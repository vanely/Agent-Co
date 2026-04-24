# Agent 10 — Discord Bot + ngrok Tunnel

## What You Own

You build a Discord bot that serves as the command interface and notification
channel for the agent company stack. You also configure an ngrok tunnel for
general n8n webhook exposure.

**Interaction pattern:** Mention the bot in any channel with a command word:
```
@Eli status
@Eli prompt: research boutique gyms in Miami and summarize findings
@Eli leads: show me top 10 validated leads
@Eli emails: how many sent today
@Eli pipeline: show full pipeline stats
@Eli pause: 07-email-dispatch
@Eli resume: 07-email-dispatch
@Eli relay: status
@Eli help
```

**Notifications pushed to Discord automatically (each configurable via .env):**
- Workflow errors
- Daily lead + email summary
- Claude task completions (agent finishes a research job)
- Relay health alerts (relay goes down or comes back)

**Architecture:**
```
Discord Gateway (WebSocket — outbound from host, no tunnel needed)
  └── discord-bot/src/bot.ts (host machine, port 3457 for n8n callbacks)
        ├── parses @mention commands
        ├── calls relay directly for 'prompt:' commands
        ├── calls n8n REST API for workflow control
        ├── queries Postgres directly for stats
        └── posts embeds back to Discord channel

n8n workflows (updated)
  └── POST http://localhost:3457/notify  ← bot's local HTTP server
        (same machine, no tunnel needed)

ngrok
  └── exposes localhost:5678 (n8n webhooks) as https://<static>.ngrok-free.app
        (for future external integrations, not needed for Discord)
```

## Preconditions

- Agents 01–09 complete and verified
- You have a Discord account and can create a bot at discord.com/developers
- You have an ngrok account and static domain from ngrok.com/dashboard

Verify:
```bash
ls ~/agent-company/scripts/dist/utils/db.js && \
curl -s http://localhost:3456/health | grep -q ok && \
echo "OK to proceed" || echo "FAIL — complete agents 01-09 first"
```

## Done Condition

- `~/agent-company/discord-bot/dist/bot.js` exists and compiled cleanly
- Bot process is running and shows "Bot ready" in logs
- Sending `@Eli status` in your Discord server returns a status embed
- n8n error handler workflow posts to Discord on failure
- `curl https://<your-static-domain>/healthz` returns n8n's health response

---

## Step 1 — Create Your Discord Bot Application

Do this in the browser before writing any code.

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it `Eli` (or whatever you want)
3. Go to **Bot** tab → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** ← required for reading @mention message text
5. Click **Reset Token** → copy the token → save it (shown once)
6. Go to **OAuth2 > URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Embed Links`, `Use Slash Commands`
7. Copy the generated URL → open it → add the bot to your server
8. In your Discord server, right-click the channel you want notifications in → **Copy Channel ID**
   (Enable Developer Mode first: User Settings > Advanced > Developer Mode)

You now have:
- `DISCORD_BOT_TOKEN` — from step 5
- `DISCORD_CHANNEL_ID` — from step 8
- `DISCORD_GUILD_ID` — right-click your server name → Copy Server ID

---

## Step 2 — Install ngrok

```bash
# Mac
brew install ngrok/ngrok/ngrok

# Linux
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && \
  echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
  | sudo tee /etc/apt/sources.list.d/ngrok.list && \
  sudo apt update && sudo apt install ngrok

# Or download directly from https://ngrok.com/download
```

Authenticate with your authtoken:
```bash
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
```

Verify:
```bash
ngrok version
cat ~/.config/ngrok/ngrok.yml | grep authtoken && echo "Authenticated"
```

---

## Step 3 — Add New Values to .env

Append these to `~/agent-company/.env`:

```bash
cat >> ~/agent-company/.env << 'EOF'

# ================================================================
# Discord Bot
# ================================================================
DISCORD_BOT_TOKEN=CHANGE_ME_paste_bot_token_here
DISCORD_CHANNEL_ID=CHANGE_ME_paste_channel_id_here
DISCORD_GUILD_ID=CHANGE_ME_paste_guild_id_here

# Bot name — used in @mention parsing (lowercase)
# If your bot is named "Eli", this stays as "eli"
DISCORD_BOT_NAME=eli

# Local port the bot's HTTP server listens on (for n8n → bot notifications)
BOT_PORT=3457

# ================================================================
# Notification toggles — set to 'true' or 'false'
# ================================================================
NOTIFY_WORKFLOW_ERRORS=true
NOTIFY_DAILY_SUMMARY=true
NOTIFY_CLAUDE_TASK_COMPLETE=true
NOTIFY_RELAY_HEALTH=true

# ================================================================
# ngrok
# ================================================================
NGROK_AUTHTOKEN=CHANGE_ME_paste_authtoken_here
# Your free static domain from ngrok.com/dashboard (Domains section)
# Format: something-something-something.ngrok-free.app
NGROK_STATIC_DOMAIN=CHANGE_ME_your-domain.ngrok-free.app
EOF

echo "Added Discord + ngrok vars to .env"
```

Fill in the real values now:
```bash
# Verify no placeholders remain for Discord
grep "DISCORD_BOT_TOKEN\|DISCORD_CHANNEL_ID\|NGROK_STATIC_DOMAIN" ~/agent-company/.env | \
  grep "CHANGE_ME" && echo "WARNING: fill in .env values" || echo ".env looks set"
```

---

## Step 4 — Create discord-bot/ Directory Structure

```bash
mkdir -p ~/agent-company/discord-bot/src
```

---

## Step 5 — Write discord-bot/package.json

Write `~/agent-company/discord-bot/package.json`:

```json
{
  "name": "agentco-discord-bot",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/bot.js",
    "dev": "ts-node src/bot.ts",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "discord.js": "^14.14.1",
    "express": "^4.18.2",
    "pg": "^8.11.3"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "@types/pg": "^8.11.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

---

## Step 6 — Write discord-bot/tsconfig.json

Write `~/agent-company/discord-bot/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Step 7 — Write discord-bot/src/bot.ts

Write `~/agent-company/discord-bot/src/bot.ts`:

```typescript
import {
  Client,
  GatewayIntentBits,
  Message,
  EmbedBuilder,
  TextChannel,
  Events,
  ActivityType,
} from 'discord.js';
import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as http from 'http';

const execAsync = promisify(exec);

// ----------------------------------------------------------------
// Config from environment
// ----------------------------------------------------------------
const BOT_TOKEN        = process.env.DISCORD_BOT_TOKEN ?? '';
const CHANNEL_ID       = process.env.DISCORD_CHANNEL_ID ?? '';
const BOT_NAME         = (process.env.DISCORD_BOT_NAME ?? 'eli').toLowerCase();
const BOT_PORT         = parseInt(process.env.BOT_PORT ?? '3457', 10);
const RELAY_URL        = process.env.CLAUDE_RELAY_URL ?? 'http://localhost:3456';
const RELAY_PORT       = parseInt(process.env.RELAY_PORT ?? '3456', 10);
const N8N_URL          = 'http://localhost:5678';
const N8N_USER         = process.env.N8N_BASIC_AUTH_USER ?? 'admin';
const N8N_PASS         = process.env.N8N_BASIC_AUTH_PASSWORD ?? '';
const POSTGRES_URL     = process.env.POSTGRES_URL ?? '';

// Notification toggles
const NOTIFY = {
  errors:        process.env.NOTIFY_WORKFLOW_ERRORS === 'true',
  dailySummary:  process.env.NOTIFY_DAILY_SUMMARY === 'true',
  taskComplete:  process.env.NOTIFY_CLAUDE_TASK_COMPLETE === 'true',
  relayHealth:   process.env.NOTIFY_RELAY_HEALTH === 'true',
};

if (!BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is not set in .env');
if (!CHANNEL_ID) throw new Error('DISCORD_CHANNEL_ID is not set in .env');

// ----------------------------------------------------------------
// Postgres pool (for stats queries)
// ----------------------------------------------------------------
const db = new Pool({ connectionString: POSTGRES_URL, max: 3 });

// ----------------------------------------------------------------
// Discord client
// ----------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,  // requires Message Content Intent in dev portal
    GatewayIntentBits.DirectMessages,
  ],
});

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

async function getNotificationChannel(): Promise<TextChannel | null> {
  try {
    const ch = await client.channels.fetch(CHANNEL_ID);
    return ch instanceof TextChannel ? ch : null;
  } catch {
    return null;
  }
}

/** Post a notification embed to the configured channel. */
export async function notify(
  title: string,
  description: string,
  color: number = 0x5865F2,
  fields?: { name: string; value: string; inline?: boolean }[]
): Promise<void> {
  const channel = await getNotificationChannel();
  if (!channel) {
    console.error('[bot] Could not find notification channel');
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
  if (fields) embed.addFields(fields);
  await channel.send({ embeds: [embed] });
}

/** Reply to a message with an embed. */
async function reply(
  msg: Message,
  title: string,
  description: string,
  color: number = 0x5865F2,
  fields?: { name: string; value: string; inline?: boolean }[]
): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
  if (fields) embed.addFields(fields);
  await msg.reply({ embeds: [embed] });
}

/** Show a typing indicator while work is being done. */
async function withTyping<T>(msg: Message, fn: () => Promise<T>): Promise<T> {
  await msg.channel.sendTyping();
  return fn();
}

// ----------------------------------------------------------------
// n8n API helpers
// ----------------------------------------------------------------

async function n8nRequest(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const auth = Buffer.from(`${N8N_USER}:${N8N_PASS}`).toString('base64');
  const res = await fetch(`${N8N_URL}/api/v1${path}`, {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`n8n API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function getWorkflows(): Promise<{ id: string; name: string; active: boolean }[]> {
  const data = await n8nRequest('/workflows') as { data: { id: string; name: string; active: boolean }[] };
  return data.data ?? [];
}

async function setWorkflowActive(id: string, active: boolean): Promise<void> {
  await n8nRequest(`/workflows/${id}/${active ? 'activate' : 'deactivate'}`, 'POST');
}

// ----------------------------------------------------------------
// Postgres stats helpers
// ----------------------------------------------------------------

async function getStats(): Promise<{
  totalLeads: number;
  validatedLeads: number;
  pendingEmails: number;
  sentToday: number;
  researchedLeads: number;
  failedTasks: number;
}> {
  const [leads, emails, tasks] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_valid = true)::int AS validated,
        COUNT(*) FILTER (WHERE status = 'researched')::int AS researched
      FROM leads.contacts
    `),
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'sent' AND DATE(sent_at) = CURRENT_DATE)::int AS sent_today
      FROM outreach.emails
    `),
    db.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'failed' AND started_at > NOW() - INTERVAL '24 hours')::int AS failed
      FROM memory.task_log
    `),
  ]);
  return {
    totalLeads:      leads.rows[0].total,
    validatedLeads:  leads.rows[0].validated,
    researchedLeads: leads.rows[0].researched,
    pendingEmails:   emails.rows[0].pending,
    sentToday:       emails.rows[0].sent_today,
    failedTasks:     tasks.rows[0].failed,
  };
}

async function getTopLeads(limit = 10): Promise<{ business_name: string; email: string; validation_score: number; status: string; city: string; state: string }[]> {
  const res = await db.query(`
    SELECT business_name, COALESCE(email, 'no email') AS email,
           validation_score, status,
           COALESCE(city, '?') AS city, COALESCE(state, '?') AS state
    FROM leads.contacts
    WHERE is_valid = true
    ORDER BY validation_score DESC
    LIMIT $1
  `, [limit]);
  return res.rows;
}

// ----------------------------------------------------------------
// Command handlers
// ----------------------------------------------------------------

async function handleStatus(msg: Message): Promise<void> {
  await withTyping(msg, async () => {
    const stats  = await getStats();
    const relayOk = await fetch(`http://localhost:${RELAY_PORT}/health`).then(r => r.ok).catch(() => false);
    const n8nOk   = await fetch(`${N8N_URL}/healthz`).then(r => r.ok).catch(() => false);

    await reply(msg, '🤖 Agent Company Status', 'Live snapshot of the stack', 0x57F287, [
      { name: '📊 Leads',          value: `Total: **${stats.totalLeads}**\nValidated: **${stats.validatedLeads}**\nResearched: **${stats.researchedLeads}**`, inline: true },
      { name: '📧 Emails',         value: `Pending: **${stats.pendingEmails}**\nSent today: **${stats.sentToday}**`,                                            inline: true },
      { name: '⚠️ Failed Tasks',    value: `Last 24h: **${stats.failedTasks}**`,                                                                                 inline: true },
      { name: '🔧 Services',        value: `n8n: ${n8nOk ? '🟢 up' : '🔴 down'}\nRelay: ${relayOk ? '🟢 up' : '🔴 down'}`,                                   inline: true },
    ]);
  });
}

async function handlePrompt(msg: Message, taskText: string): Promise<void> {
  if (!taskText.trim()) {
    await reply(msg, '❌ Missing prompt', 'Usage: `@Eli prompt: your task here`', 0xED4245);
    return;
  }
  await withTyping(msg, async () => {
    await reply(msg, '⏳ Running task...', `\`\`\`${taskText.slice(0, 200)}\`\`\`\nThis may take a minute.`, 0xFEE75C);

    try {
      const res = await fetch(`${RELAY_URL}/run-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: taskText, timeoutSeconds: 300 }),
      });
      const data = await res.json() as { success: boolean; output?: string; error?: string; durationMs: number };

      if (data.success) {
        const output = (data.output ?? '').slice(0, 1800);
        await reply(msg, '✅ Task complete', `\`\`\`\n${output}\n\`\`\``, 0x57F287, [
          { name: 'Duration', value: `${(data.durationMs / 1000).toFixed(1)}s`, inline: true },
        ]);
      } else {
        await reply(msg, '❌ Task failed', data.error ?? 'Unknown error', 0xED4245);
      }
    } catch (e) {
      await reply(msg, '❌ Relay unreachable', `Cannot reach Claude relay at ${RELAY_URL}.\nIs it running?`, 0xED4245);
    }
  });
}

async function handleLeads(msg: Message, arg: string): Promise<void> {
  await withTyping(msg, async () => {
    const limit = parseInt(arg) || 10;
    const leads = await getTopLeads(Math.min(limit, 25));

    if (leads.length === 0) {
      await reply(msg, '📋 No validated leads yet', 'Run the scraper workflow to generate leads.', 0xFEE75C);
      return;
    }

    const rows = leads
      .map((l, i) => `**${i + 1}.** ${l.business_name} — ${l.city}, ${l.state} (score: ${l.validation_score}) \`${l.status}\``)
      .join('\n');

    await reply(msg, `📋 Top ${leads.length} Validated Leads`, rows, 0x5865F2);
  });
}

async function handleEmails(msg: Message): Promise<void> {
  await withTyping(msg, async () => {
    const res = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int   AS pending,
        COUNT(*) FILTER (WHERE status = 'sent')::int      AS total_sent,
        COUNT(*) FILTER (WHERE status = 'sent' AND DATE(sent_at) = CURRENT_DATE)::int AS sent_today,
        COUNT(*) FILTER (WHERE status = 'bounced')::int   AS bounced,
        COUNT(*) FILTER (WHERE status = 'replied')::int   AS replied
      FROM outreach.emails
    `);
    const r = res.rows[0];
    await reply(msg, '📧 Email Pipeline', 'Lifetime stats', 0x5865F2, [
      { name: 'Pending',     value: `**${r.pending}**`,    inline: true },
      { name: 'Sent Today',  value: `**${r.sent_today}**`, inline: true },
      { name: 'Total Sent',  value: `**${r.total_sent}**`, inline: true },
      { name: 'Replied',     value: `**${r.replied}**`,    inline: true },
      { name: 'Bounced',     value: `**${r.bounced}**`,    inline: true },
    ]);
  });
}

async function handlePipeline(msg: Message): Promise<void> {
  await withTyping(msg, async () => {
    const res = await db.query(`
      SELECT status, COUNT(*)::int AS count
      FROM leads.contacts
      GROUP BY status
      ORDER BY count DESC
    `);
    const rows = res.rows.map(r => `\`${r.status}\`: **${r.count}**`).join('\n');
    const stats = await getStats();
    await reply(msg, '🔄 Full Pipeline', rows, 0x5865F2, [
      { name: 'Email Drafts Pending', value: `**${stats.pendingEmails}**`, inline: true },
      { name: 'Sent Today',           value: `**${stats.sentToday}**`,     inline: true },
    ]);
  });
}

async function handlePause(msg: Message, workflowName: string): Promise<void> {
  await withTyping(msg, async () => {
    try {
      const workflows = await getWorkflows();
      const match = workflows.find(w =>
        w.name.toLowerCase().includes(workflowName.toLowerCase())
      );
      if (!match) {
        await reply(msg, '❌ Workflow not found', `No workflow matching \`${workflowName}\``, 0xED4245);
        return;
      }
      await setWorkflowActive(match.id, false);
      await reply(msg, '⏸️ Workflow paused', `**${match.name}** has been deactivated.`, 0xFEE75C);
    } catch (e) {
      await reply(msg, '❌ Error', String(e), 0xED4245);
    }
  });
}

async function handleResume(msg: Message, workflowName: string): Promise<void> {
  await withTyping(msg, async () => {
    try {
      const workflows = await getWorkflows();
      const match = workflows.find(w =>
        w.name.toLowerCase().includes(workflowName.toLowerCase())
      );
      if (!match) {
        await reply(msg, '❌ Workflow not found', `No workflow matching \`${workflowName}\``, 0xED4245);
        return;
      }
      await setWorkflowActive(match.id, true);
      await reply(msg, '▶️ Workflow resumed', `**${match.name}** has been activated.`, 0x57F287);
    } catch (e) {
      await reply(msg, '❌ Error', String(e), 0xED4245);
    }
  });
}

async function handleRelay(msg: Message, arg: string): Promise<void> {
  const sub = arg.trim().toLowerCase();
  if (sub === 'status' || sub === '') {
    try {
      const res = await fetch(`http://localhost:${RELAY_PORT}/health`);
      const data = await res.json() as { status: string; timestamp: string };
      await reply(msg, '🔌 Relay Status', `Status: **${data.status}**\nLast checked: ${data.timestamp}`, 0x57F287);
    } catch {
      await reply(msg, '🔴 Relay Down', 'Cannot reach the Claude relay server.', 0xED4245);
    }
  } else {
    await reply(msg, '❓ Unknown relay command', 'Usage: `@Eli relay: status`', 0xED4245);
  }
}

async function handleWorkflows(msg: Message): Promise<void> {
  await withTyping(msg, async () => {
    try {
      const workflows = await getWorkflows();
      const rows = workflows
        .map(w => `${w.active ? '🟢' : '🔴'} ${w.name}`)
        .join('\n');
      await reply(msg, '⚙️ n8n Workflows', rows || 'No workflows found', 0x5865F2);
    } catch (e) {
      await reply(msg, '❌ Error fetching workflows', String(e), 0xED4245);
    }
  });
}

async function handleHelp(msg: Message): Promise<void> {
  await reply(msg, '📖 Agent Company Commands', 'All commands start with @' + BOT_NAME, 0x5865F2, [
    { name: '`status`',                value: 'Full stack status — leads, emails, services',     inline: false },
    { name: '`prompt: <task>`',         value: 'Run any task via Claude Code',                    inline: false },
    { name: '`leads: [N]`',             value: 'Show top N validated leads (default 10)',          inline: false },
    { name: '`emails`',                 value: 'Email pipeline stats',                            inline: false },
    { name: '`pipeline`',               value: 'Full lead pipeline breakdown',                    inline: false },
    { name: '`workflows`',              value: 'List all n8n workflows and their status',          inline: false },
    { name: '`pause: <workflow name>`', value: 'Deactivate an n8n workflow',                      inline: false },
    { name: '`resume: <workflow name>`',value: 'Activate an n8n workflow',                        inline: false },
    { name: '`relay: status`',          value: 'Check Claude relay health',                       inline: false },
    { name: '`help`',                   value: 'Show this message',                               inline: false },
  ]);
}

// ----------------------------------------------------------------
// Message parser — @mention command routing
// ----------------------------------------------------------------

client.on(Events.MessageCreate, async (msg: Message) => {
  // Ignore bots (including self)
  if (msg.author.bot) return;

  // Check if our bot was mentioned
  const botMentioned = msg.mentions.users.has(client.user?.id ?? '');
  if (!botMentioned) return;

  // Strip the mention and parse: first word = command, rest = argument
  const content = msg.content
    .replace(/<@!?\d+>/g, '')  // remove all @mentions
    .trim();

  const colonIdx = content.indexOf(':');
  let command: string;
  let arg: string;

  if (colonIdx !== -1) {
    command = content.slice(0, colonIdx).trim().toLowerCase();
    arg     = content.slice(colonIdx + 1).trim();
  } else {
    command = content.trim().toLowerCase();
    arg     = '';
  }

  console.log(`[bot] Command: "${command}" Arg: "${arg.slice(0, 80)}"`);

  try {
    switch (command) {
      case 'status':    await handleStatus(msg);              break;
      case 'prompt':    await handlePrompt(msg, arg);         break;
      case 'leads':     await handleLeads(msg, arg);          break;
      case 'emails':    await handleEmails(msg);              break;
      case 'pipeline':  await handlePipeline(msg);            break;
      case 'pause':     await handlePause(msg, arg);          break;
      case 'resume':    await handleResume(msg, arg);         break;
      case 'relay':     await handleRelay(msg, arg);          break;
      case 'workflows': await handleWorkflows(msg);           break;
      case 'help':
      case '':          await handleHelp(msg);                break;
      default:
        await reply(msg,
          '❓ Unknown command',
          `I don't know \`${command}\`. Try \`@${BOT_NAME} help\`.`,
          0xED4245
        );
    }
  } catch (e) {
    console.error('[bot] Command handler error:', e);
    await reply(msg, '❌ Internal error', String(e).slice(0, 500), 0xED4245).catch(() => {});
  }
});

// ----------------------------------------------------------------
// Local HTTP server — receives notifications from n8n workflows
// n8n POSTs here instead of calling Discord API directly
// ----------------------------------------------------------------

const notifyApp = express();
notifyApp.use(express.json({ limit: '1mb' }));

interface NotifyPayload {
  type: 'error' | 'daily_summary' | 'task_complete' | 'relay_health';
  title: string;
  description: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  color?: number;
}

notifyApp.post('/notify', async (req: Request, res: Response) => {
  const payload = req.body as NotifyPayload;

  // Check toggle for this notification type
  const enabled = {
    error:         NOTIFY.errors,
    daily_summary: NOTIFY.dailySummary,
    task_complete: NOTIFY.taskComplete,
    relay_health:  NOTIFY.relayHealth,
  }[payload.type] ?? true;

  if (!enabled) {
    res.json({ ok: true, skipped: true, reason: `type ${payload.type} is disabled` });
    return;
  }

  try {
    await notify(payload.title, payload.description, payload.color, payload.fields);
    res.json({ ok: true });
  } catch (e) {
    console.error('[bot] Failed to send notification:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

notifyApp.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', botReady: client.isReady() });
});

notifyApp.listen(BOT_PORT, '127.0.0.1', () => {
  console.log(`[bot] Notification server on http://127.0.0.1:${BOT_PORT}`);
});

// ----------------------------------------------------------------
// Relay health monitor — polls relay every 60s, notifies on change
// ----------------------------------------------------------------

let lastRelayState: boolean | null = null;

setInterval(async () => {
  if (!NOTIFY.relayHealth) return;
  const isUp = await fetch(`http://localhost:${RELAY_PORT}/health`)
    .then(r => r.ok)
    .catch(() => false);

  if (lastRelayState !== null && lastRelayState !== isUp) {
    if (isUp) {
      await notify('🟢 Relay Back Online', 'Claude Code relay is responding again.', 0x57F287).catch(() => {});
    } else {
      await notify('🔴 Relay Down', `Claude relay at port ${RELAY_PORT} is not responding.\nRun: \`cd ~/agent-company/relay && npm run dev\``, 0xED4245).catch(() => {});
    }
  }
  lastRelayState = isUp;
}, 60_000);

// ----------------------------------------------------------------
// Bot ready
// ----------------------------------------------------------------

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Logged in as ${c.user.tag}`);
  c.user.setActivity('the pipeline', { type: ActivityType.Watching });

  // Startup notification
  const stats = await getStats().catch(() => null);
  const startMsg = stats
    ? `Stack is up. ${stats.totalLeads} leads, ${stats.validatedLeads} validated, ${stats.sentToday} emails sent today.`
    : 'Stack is up. (Could not load stats — check Postgres connection.)';

  await notify('🚀 Agent Company Online', startMsg, 0x57F287).catch(() => {});
});

// ----------------------------------------------------------------
// Login
// ----------------------------------------------------------------

client.login(BOT_TOKEN).catch(e => {
  console.error('[bot] Login failed:', e);
  process.exit(1);
});
```

---

## Step 8 — Update n8n Workflow: Error Handler

The error handler workflow needs to POST to the bot's local HTTP server instead
of sending email directly. Update `~/agent-company/workflows/09-error-handler.json`
by replacing the `Email Alert` node with an HTTP Request to the bot:

The new node to add (replace the `Email Alert` node):

```json
{
  "id": "discord-notify",
  "name": "Discord Notify",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4,
  "position": [900, 300],
  "parameters": {
    "method": "POST",
    "url": "http://localhost:3457/notify",
    "sendHeaders": true,
    "headerParameters": {
      "parameters": [{"name": "Content-Type", "value": "application/json"}]
    },
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"type\": \"error\",\n  \"title\": \"❌ Workflow Error: {{ $json.workflow_name }}\",\n  \"description\": \"**Node:** `{{ $json.node_name }}`\\n**Error:** {{ $json.error_message }}\",\n  \"color\": 15548997,\n  \"fields\": [\n    {\"name\": \"Execution ID\", \"value\": \"{{ $json.execution_id }}\", \"inline\": true},\n    {\"name\": \"Time\", \"value\": \"{{ $json.timestamp }}\", \"inline\": true}\n  ]\n}",
    "options": {}
  }
}
```

Update the connections for the error handler workflow:
```json
"Log Error To DB": {"main": [[{"node": "Discord Notify", "type": "main", "index": 0}]]}
```

---

## Step 9 — Add Daily Summary Workflow

Write `~/agent-company/workflows/10-daily-summary.json`:

```json
{
  "name": "10 - Daily Summary",
  "nodes": [
    {
      "id": "schedule",
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1,
      "position": [240, 300],
      "parameters": {
        "rule": {"interval": [{"field": "cronExpression", "expression": "0 18 * * 1-5"}]}
      }
    },
    {
      "id": "get-stats",
      "name": "Get Daily Stats",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [460, 300],
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT (SELECT COUNT(*)::int FROM leads.contacts) AS total_leads, (SELECT COUNT(*)::int FROM leads.contacts WHERE is_valid = true) AS valid_leads, (SELECT COUNT(*)::int FROM leads.contacts WHERE DATE(created_at) = CURRENT_DATE) AS new_today, (SELECT COUNT(*)::int FROM outreach.emails WHERE status = 'sent' AND DATE(sent_at) = CURRENT_DATE) AS sent_today, (SELECT COUNT(*)::int FROM outreach.emails WHERE status = 'replied') AS replies_total, (SELECT COUNT(*)::int FROM memory.task_log WHERE status = 'failed' AND DATE(started_at) = CURRENT_DATE) AS errors_today",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "send-summary",
      "name": "Send Discord Summary",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [680, 300],
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3457/notify",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [{"name": "Content-Type", "value": "application/json"}]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"type\": \"daily_summary\",\n  \"title\": \"📊 Daily Summary\",\n  \"description\": \"End of day report\",\n  \"color\": 5793266,\n  \"fields\": [\n    {\"name\": \"New Leads Today\", \"value\": \"{{ $json.new_today }}\", \"inline\": true},\n    {\"name\": \"Total Valid Leads\", \"value\": \"{{ $json.valid_leads }}\", \"inline\": true},\n    {\"name\": \"Emails Sent Today\", \"value\": \"{{ $json.sent_today }}\", \"inline\": true},\n    {\"name\": \"Total Replies\", \"value\": \"{{ $json.replies_total }}\", \"inline\": true},\n    {\"name\": \"Errors Today\", \"value\": \"{{ $json.errors_today }}\", \"inline\": true}\n  ]\n}",
        "options": {}
      }
    }
  ],
  "connections": {
    "Schedule Trigger": {"main": [[{"node": "Get Daily Stats", "type": "main", "index": 0}]]},
    "Get Daily Stats": {"main": [[{"node": "Send Discord Summary", "type": "main", "index": 0}]]}
  },
  "settings": {"executionOrder": "v1", "errorWorkflow": "09-error-handler"},
  "staticData": null
}
```

---

## Step 10 — Add Task Complete Notification to Lead Researcher Workflow

In `~/agent-company/workflows/06-lead-researcher.json`, add this node after
the existing `Log Task Complete` node:

```json
{
  "id": "discord-task-complete",
  "name": "Notify Task Complete",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4,
  "position": [3100, 140],
  "parameters": {
    "method": "POST",
    "url": "http://localhost:3457/notify",
    "sendHeaders": true,
    "headerParameters": {
      "parameters": [{"name": "Content-Type", "value": "application/json"}]
    },
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"type\": \"task_complete\",\n  \"title\": \"✅ Research Complete\",\n  \"description\": \"Email draft ready for **{{ $('One At A Time').item.json.business_name }}**\",\n  \"color\": 5763719,\n  \"fields\": [\n    {\"name\": \"Subject\", \"value\": \"{{ $json.subject }}\", \"inline\": false},\n    {\"name\": \"Duration\", \"value\": \"{{ $json.durationMs }}ms\", \"inline\": true}\n  ]\n}",
    "options": {}
  }
}
```

Add to connections:
```json
"Log Task Complete": {"main": [[{"node": "Notify Task Complete", "type": "main", "index": 0}]]}
```

---

## Step 11 — Configure ngrok

Create an ngrok config file:

```bash
mkdir -p ~/.config/ngrok

# Load static domain from .env
source ~/agent-company/.env

cat > ~/.config/ngrok/ngrok.yml << EOF
version: "2"
authtoken: ${NGROK_AUTHTOKEN}
tunnels:
  n8n-webhooks:
    proto: http
    addr: 5678
    domain: ${NGROK_STATIC_DOMAIN}
EOF

echo "ngrok config written"
cat ~/.config/ngrok/ngrok.yml
```

Test the tunnel manually:
```bash
ngrok start n8n-webhooks
```

You should see:
```
Forwarding  https://your-domain.ngrok-free.app -> http://localhost:5678
```

Press Ctrl+C — we'll start it in the background via manage.sh.

---

## Step 12 — Install Dependencies and Compile

```bash
cd ~/agent-company/discord-bot
npm install

echo "Compiling..."
npm run build

ls dist/bot.js && echo "Compiled OK" || echo "ERROR: check TypeScript output above"
```

---

## Step 13 — Start the Bot

```bash
# Load env vars
set -a && source ~/agent-company/.env && set +a

# Start bot in background
cd ~/agent-company/discord-bot
nohup node dist/bot.js \
  >> ~/agent-company/discord-bot/bot.log 2>&1 &
echo $! > ~/agent-company/discord-bot/bot.pid
sleep 3

# Verify it's running
PID=$(cat ~/agent-company/discord-bot/bot.pid)
kill -0 $PID 2>/dev/null && echo "Bot running (pid $PID)" || echo "FAIL: check bot.log"
tail -5 ~/agent-company/discord-bot/bot.log
```

You should see in the log:
```
[bot] Notification server on http://127.0.0.1:3457
[bot] Logged in as Eli#XXXX
```

And in your Discord channel:
```
🚀 Agent Company Online
Stack is up. X leads, Y validated, Z emails sent today.
```

---

## Step 14 — Update manage.sh

Add bot and ngrok management to `manage.sh`. Append these cases to the
`do_action()` function and add entries to the menu display:

```bash
# Append to the manage.sh do_action() case statement — add before the 0) exit case:

# BOT
    25)
      BOT_DIR="$PROJECT_DIR/discord-bot"
      if [ ! -f "$BOT_DIR/dist/bot.js" ]; then
        echo "Building bot..."
        cd "$BOT_DIR" && npm run build
      fi
      set -a && source "$PROJECT_DIR/.env" && set +a
      cd "$BOT_DIR"
      nohup node dist/bot.js >> "$BOT_DIR/bot.log" 2>&1 &
      echo $! > "$BOT_DIR/bot.pid"
      sleep 2
      PID=$(cat "$BOT_DIR/bot.pid")
      kill -0 $PID 2>/dev/null && green "Bot started (pid $PID)" || red "Bot failed — check $BOT_DIR/bot.log"
      ;;
    26)
      BOT_PID_FILE="$PROJECT_DIR/discord-bot/bot.pid"
      if [ -f "$BOT_PID_FILE" ]; then
        PID=$(cat "$BOT_PID_FILE")
        kill "$PID" 2>/dev/null && rm "$BOT_PID_FILE" && green "Bot stopped (was pid $PID)" || yellow "Bot was not running"
      else
        yellow "No bot pid file found"
      fi
      ;;
    27)
      tail -30 "$PROJECT_DIR/discord-bot/bot.log"
      ;;
    28)
      cd "$PROJECT_DIR/discord-bot" && npm run build
      green "Bot compiled."
      ;;

    # NGROK
    29)
      source "$PROJECT_DIR/.env"
      echo "Starting ngrok tunnel → https://$NGROK_STATIC_DOMAIN"
      nohup ngrok start n8n-webhooks \
        >> "$PROJECT_DIR/ngrok.log" 2>&1 &
      echo $! > "$PROJECT_DIR/ngrok.pid"
      sleep 3
      curl -s http://localhost:4040/api/tunnels | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for t in d.get('tunnels', []):
        print(f'  Tunnel: {t[\"public_url\"]} → {t[\"config\"][\"addr\"]}')
except: print('  (ngrok starting...)')
      "
      ;;
    30)
      if [ -f "$PROJECT_DIR/ngrok.pid" ]; then
        PID=$(cat "$PROJECT_DIR/ngrok.pid")
        kill "$PID" 2>/dev/null && rm "$PROJECT_DIR/ngrok.pid" && green "ngrok stopped" || yellow "ngrok was not running"
      else
        yellow "No ngrok pid file"
      fi
      ;;
    31)
      curl -s http://localhost:4040/api/tunnels | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for t in d.get('tunnels', []):
        print(f'Active: {t[\"public_url\"]} → {t[\"config\"][\"addr\"]}')
    if not d.get('tunnels'):
        print('No active tunnels')
except:
    print('ngrok not running or API not ready')
      "
      ;;
```

---

## Step 15 — Add to Makefile

Append to `~/agent-company/Makefile`:

```makefile

# ----------------------------------------------------------------
# Discord Bot
# ----------------------------------------------------------------
BOT_DIR := $(PROJECT_DIR)/discord-bot
BOT_PID := $(BOT_DIR)/bot.pid
BOT_LOG := $(BOT_DIR)/bot.log

bot:
	@if [ ! -f "$(BOT_DIR)/dist/bot.js" ]; then cd $(BOT_DIR) && npm run build; fi
	@set -a && source $(PROJECT_DIR)/.env && set +a && \
	 cd $(BOT_DIR) && nohup node dist/bot.js >> $(BOT_LOG) 2>&1 & echo $$! > $(BOT_PID)
	@sleep 2 && PID=$$(cat $(BOT_PID)); \
	 kill -0 $$PID 2>/dev/null && echo "Bot started (pid $$PID)" || echo "Bot failed — check $(BOT_LOG)"

bot-stop:
	@[ -f "$(BOT_PID)" ] && kill $$(cat $(BOT_PID)) && rm $(BOT_PID) && echo "Bot stopped" || echo "Not running"

bot-logs:
	@tail -40 $(BOT_LOG)

bot-build:
	cd $(BOT_DIR) && npm run build

# ----------------------------------------------------------------
# ngrok
# ----------------------------------------------------------------
ngrok-start:
	@source $(PROJECT_DIR)/.env && \
	 nohup ngrok start n8n-webhooks >> $(PROJECT_DIR)/ngrok.log 2>&1 & \
	 echo $$! > $(PROJECT_DIR)/ngrok.pid
	@sleep 3 && curl -s http://localhost:4040/api/tunnels | \
	 python3 -c "import sys,json; [print(t['public_url']) for t in json.load(sys.stdin).get('tunnels',[])]"

ngrok-stop:
	@[ -f "$(PROJECT_DIR)/ngrok.pid" ] && \
	 kill $$(cat $(PROJECT_DIR)/ngrok.pid) && rm $(PROJECT_DIR)/ngrok.pid && \
	 echo "ngrok stopped" || echo "Not running"

ngrok-status:
	@curl -s http://localhost:4040/api/tunnels | \
	 python3 -c "import sys,json; d=json.load(sys.stdin); \
	 [print(t['public_url'],'→',t['config']['addr']) for t in d.get('tunnels',[])] or print('No tunnels')" \
	 2>/dev/null || echo "ngrok not running"
```

---

## Step 16 — Update .env.example

Add these new fields to `~/agent-company/.env.example` so future setups
know what's needed:

```bash
cat >> ~/agent-company/.env.example << 'EOF'

# ================================================================
# Discord Bot
# ================================================================
DISCORD_BOT_TOKEN=CHANGE_ME_paste_bot_token_here
DISCORD_CHANNEL_ID=CHANGE_ME_paste_channel_id_here
DISCORD_GUILD_ID=CHANGE_ME_paste_guild_id_here
DISCORD_BOT_NAME=eli
BOT_PORT=3457

# Notification toggles
NOTIFY_WORKFLOW_ERRORS=true
NOTIFY_DAILY_SUMMARY=true
NOTIFY_CLAUDE_TASK_COMPLETE=true
NOTIFY_RELAY_HEALTH=true

# ================================================================
# ngrok
# ================================================================
NGROK_AUTHTOKEN=CHANGE_ME_paste_authtoken_here
NGROK_STATIC_DOMAIN=CHANGE_ME_your-domain.ngrok-free.app
EOF
```

---

## Step 17 — Verify

```bash
echo "=== Discord Bot Verification ===" && \

# Bot process running
BOT_PID=$(cat ~/agent-company/discord-bot/bot.pid 2>/dev/null)
kill -0 "$BOT_PID" 2>/dev/null && echo "OK: bot process running (pid $BOT_PID)" || echo "FAIL: bot not running"

# Bot HTTP server responding
curl -s http://localhost:3457/health | grep -q "ok" && \
  echo "OK: bot notification server responding" || \
  echo "FAIL: bot HTTP server not up"

# Bot log shows logged in
grep -q "Logged in" ~/agent-company/discord-bot/bot.log && \
  echo "OK: bot logged in to Discord" || \
  echo "FAIL: check bot.log for login errors"

echo ""
echo "=== ngrok Verification ==="
source ~/agent-company/.env
echo "Static domain: $NGROK_STATIC_DOMAIN"
curl -s "https://$NGROK_STATIC_DOMAIN/healthz" | grep -q "ok\|status" && \
  echo "OK: ngrok tunnel working" || \
  echo "INFO: ngrok tunnel not active (start with: make ngrok-start)"

echo ""
echo "=== Discord Integration Test ==="
echo "Send '@$(grep DISCORD_BOT_NAME ~/agent-company/.env | cut -d= -f2) status' in your Discord server."
echo "The bot should reply with an embed showing stack status."
```

---

## Step 18 — Update coordinator's BUILD_STATE.md

```bash
cat >> ~/agent-company/BUILD_STATE.md << 'EOF'

## Agent 10 — Discord Bot + ngrok
- [x] discord-bot/ directory created
- [x] Bot TypeScript compiled to dist/
- [x] Bot process running
- [x] Bot logged in to Discord
- [x] Notification HTTP server on port 3457
- [x] Daily summary workflow (10-daily-summary.json) created
- [x] Error handler updated to post to Discord
- [x] Lead researcher workflow updated with task-complete notifications
- [x] ngrok configured with static domain
- [x] manage.sh and Makefile updated with bot/ngrok commands
EOF

echo "BUILD_STATE.md updated."
```

---

## Complete Command Reference

Once everything is running, here's every `@Eli` command:

| Command | What it does |
|---|---|
| `@Eli status` | Full stack health — leads, emails, services |
| `@Eli prompt: <task>` | Run anything via Claude Code, reply with output |
| `@Eli leads: 20` | Show top 20 validated leads by score |
| `@Eli emails` | Email pipeline stats |
| `@Eli pipeline` | Full lead status breakdown |
| `@Eli workflows` | List all n8n workflows with active/inactive state |
| `@Eli pause: email-dispatch` | Deactivate a workflow by partial name match |
| `@Eli resume: email-dispatch` | Activate a workflow by partial name match |
| `@Eli relay: status` | Check if Claude relay is up |
| `@Eli help` | Show command list |

And automatic notifications (configurable in `.env`):
- `NOTIFY_WORKFLOW_ERRORS=true` — any n8n workflow failure
- `NOTIFY_DAILY_SUMMARY=true` — 6 PM weekdays, full stats embed
- `NOTIFY_CLAUDE_TASK_COMPLETE=true` — each time a research job completes
- `NOTIFY_RELAY_HEALTH=true` — relay goes down or comes back up
