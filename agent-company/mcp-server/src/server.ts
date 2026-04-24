#!/usr/bin/env node
/**
 * agentco-mcp — MCP server that exposes agent-co relay capabilities as tools
 * to Claude Code CLI sessions, bringing the CLI to parity with Discord/Telegram.
 *
 * Tools exposed:
 *   notify_discord        — post a message to the #pocket Discord channel
 *   list_skill_contributions — review pending skill proposals
 *   heartbeat_check       — inspect idle state + last heartbeat; used to decide
 *                           whether to surface a status pulse
 *
 * All tools proxy HTTP to the relay at http://localhost:3456. The relay's
 * auth middleware is bearer-token gated; the shared token is loaded from
 * AGENTCO_RELAY_TOKEN env var (falls back to reading from the relay's .env).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RELAY_URL = process.env.AGENTCO_RELAY_URL ?? "http://localhost:3456";

function loadRelayToken(): string | undefined {
  if (process.env.RELAY_SECRET) return process.env.RELAY_SECRET;
  if (process.env.AGENTCO_RELAY_TOKEN) return process.env.AGENTCO_RELAY_TOKEN;
  const envPath = `${homedir()}/Projects/agent-co/agent-company/.env`;
  try {
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(/^RELAY_SECRET=(.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const RELAY_TOKEN = loadRelayToken();

async function relayFetch(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (RELAY_TOKEN) headers.set("Authorization", `Bearer ${RELAY_TOKEN}`);
  const res = await fetch(`${RELAY_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // leave as text
  }
  return { ok: res.ok, status: res.status, body };
}

const server = new Server(
  {
    name: "agentco-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "notify_discord",
      description:
        "Post a message to the user's Discord channel (the same channel where the agent bot replies). Use this to broadcast a significant outcome, completed task, or get the user's attention across channels. Not for routine CLI chatter — use sparingly.",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description:
              "The message body. Discord-flavored markdown renders; keep under ~1800 chars to stay within Discord's single-message limit.",
          },
        },
        required: ["message"],
      },
    },
    {
      name: "notify_telegram",
      description:
        "Send a Telegram message to the user's direct chat with the agent bot. Same discipline as notify_discord — use for significant outcomes or attention-requiring moments, not routine CLI chatter.",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description:
              "The message body. Plain text or light markdown (Telegram supports MarkdownV2 but this endpoint sends as plain text). Chunked automatically at ~3800 chars per message.",
          },
        },
        required: ["message"],
      },
    },
    {
      name: "notify_all",
      description:
        "Broadcast a message across Discord + Telegram in one call. Use for cross-channel announcements where the user should see it regardless of which channel they're looking at (e.g., a blocker, a major completion, a long-running job finishing).",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message body. Formatted for plain/light-markdown reading on both platforms.",
          },
        },
        required: ["message"],
      },
    },
    {
      name: "list_skill_contributions",
      description:
        "List recent skill-contribution proposals (create/patch actions routed through /skill-manage). Use when reviewing the agent-authored skill queue, especially after a fleet-wide work burst.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "accepted", "rejected", "all"],
            description:
              "Filter by status. Default 'pending' to show only what's awaiting review.",
          },
          limit: {
            type: "number",
            description: "Max rows to return. Default 20.",
          },
        },
      },
    },
    {
      name: "heartbeat_check",
      description:
        "Check idle-state for the current CLI session: how long since the user's last message, when the last heartbeat was generated, and whether a status pulse should be surfaced. Idle threshold is 3 hours (configurable via AGENTCO_IDLE_THRESHOLD_HOURS) — respect it to avoid interrupting active conversation.",
      inputSchema: {
        type: "object",
        properties: {
          idle_threshold_hours: {
            type: "number",
            description:
              "Override the default 3-hour idle threshold. Mostly for testing.",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === "notify_discord") {
    const message = (args?.message as string | undefined)?.trim();
    if (!message) {
      return {
        content: [{ type: "text", text: "error: message is required" }],
        isError: true,
      };
    }
    const result = await relayFetch("/notify-pocket", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    if (!result.ok) {
      return {
        content: [
          {
            type: "text",
            text: `notify-pocket failed (${result.status}): ${JSON.stringify(result.body)}`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        { type: "text", text: `notify-pocket ok: ${JSON.stringify(result.body)}` },
      ],
    };
  }

  if (name === "notify_telegram") {
    const message = (args?.message as string | undefined)?.trim();
    if (!message) {
      return {
        content: [{ type: "text", text: "error: message is required" }],
        isError: true,
      };
    }
    const result = await relayFetch("/notify-telegram", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    if (!result.ok) {
      return {
        content: [
          {
            type: "text",
            text: `notify-telegram failed (${result.status}): ${JSON.stringify(result.body)}`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `notify-telegram ok: ${JSON.stringify(result.body)}` }],
    };
  }

  if (name === "notify_all") {
    const message = (args?.message as string | undefined)?.trim();
    if (!message) {
      return {
        content: [{ type: "text", text: "error: message is required" }],
        isError: true,
      };
    }
    const [discord, telegram] = await Promise.all([
      relayFetch("/notify-pocket", { method: "POST", body: JSON.stringify({ message }) }),
      relayFetch("/notify-telegram", { method: "POST", body: JSON.stringify({ message }) }),
    ]);
    const summary = {
      discord: { ok: discord.ok, status: discord.status, body: discord.body },
      telegram: { ok: telegram.ok, status: telegram.status, body: telegram.body },
    };
    const allOk = discord.ok && telegram.ok;
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      isError: !allOk,
    };
  }

  if (name === "list_skill_contributions") {
    const status = (args?.status as string | undefined) ?? "pending";
    const limit = (args?.limit as number | undefined) ?? 20;
    const qs = new URLSearchParams();
    if (status !== "all") qs.set("status", status);
    qs.set("limit", String(limit));
    const result = await relayFetch(`/skill-contributions?${qs.toString()}`);
    if (!result.ok) {
      return {
        content: [
          {
            type: "text",
            text: `list failed (${result.status}): ${JSON.stringify(result.body)}`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        { type: "text", text: JSON.stringify(result.body, null, 2) },
      ],
    };
  }

  if (name === "heartbeat_check") {
    const thresholdHours =
      (args?.idle_threshold_hours as number | undefined) ?? 3;
    const result = await relayFetch("/cli-idle-state");
    if (!result.ok) {
      return {
        content: [
          {
            type: "text",
            text: `cli-idle-state failed (${result.status}): ${JSON.stringify(result.body)}`,
          },
        ],
        isError: true,
      };
    }
    const state = result.body as Record<string, unknown>;
    const secondsIdle = state.secondsIdle as number | null;
    const shouldSurface =
      secondsIdle === null
        ? true
        : secondsIdle >= thresholdHours * 3600;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { ...state, idleThresholdHours: thresholdHours, shouldSurfaceHeartbeat: shouldSurface },
            null,
            2
          ),
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: `unknown tool: ${name}` }],
    isError: true,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
