#!/usr/bin/env python3
"""cc-session-start-hook.py — Claude Code SessionStart hook that surfaces
heartbeat context only when the user has been silent for >=IDLE_THRESHOLD_HOURS.

Rationale: during active back-and-forth (CLI or Discord/Telegram), injecting
a heartbeat into context creates desync — the agent would respond to a stale
pulse instead of the conversation. Only when the channel has been idle long
enough that the agent is effectively starting cold does the heartbeat add
value.

Hook input (stdin JSON):
  { session_id, transcript_path, cwd, hook_event_name, source }

Hook output (stdout JSON, optional):
  { "hookSpecificOutput": { "hookEventName": "SessionStart",
                            "additionalContext": "<text to inject>" } }

Non-blocking: any failure exits 0 without emitting context.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

RELAY_URL = os.environ.get("AGENTCO_RELAY_URL", "http://localhost:3456")
IDLE_THRESHOLD_HOURS = int(os.environ.get("AGENTCO_IDLE_THRESHOLD_HOURS", "3"))


def _default_cwd_allowlist() -> tuple[str, ...]:
    paths: list[str] = []
    if os.environ.get("AGENT_CO_ROOT"):
        paths.append(os.environ["AGENT_CO_ROOT"])
    else:
        paths.append(str(Path.home() / "agent-co"))
    extra = os.environ.get("AGENTCO_CWD_ALLOWLIST", "")
    if extra:
        paths.extend(p.strip() for p in extra.split(",") if p.strip())
    return tuple(paths)


AGENTCO_PATHS = _default_cwd_allowlist()
LOG_PATH = Path.home() / ".claude" / "cc-session-start-hook.log"


def log(msg: str) -> None:
    try:
        with LOG_PATH.open("a") as f:
            f.write(msg.rstrip() + "\n")
    except Exception:
        pass


def load_relay_token() -> str | None:
    if os.environ.get("RELAY_SECRET"):
        return os.environ["RELAY_SECRET"]
    agent_co_root = os.environ.get("AGENT_CO_ROOT") or str(Path.home() / "agent-co")
    env_path = Path(agent_co_root) / "agent-company" / ".env"
    try:
        for line in env_path.read_text().splitlines():
            if line.startswith("RELAY_SECRET="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return None


def fetch_idle_state() -> dict | None:
    req = urllib.request.Request(f"{RELAY_URL}/cli-idle-state")
    token = load_relay_token()
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        log(f"fetch failed: {e}")
        return None


def format_heartbeat_context(state: dict) -> str:
    seconds_idle = state.get("secondsIdle")
    last_user_at = state.get("lastUserMessageAt")
    last_hb_mtime = state.get("lastHeartbeatMtime")
    preview = state.get("lastHeartbeatPreview") or ""
    idle_desc = (
        "no prior user message"
        if seconds_idle is None
        else f"{seconds_idle // 3600}h{(seconds_idle % 3600) // 60}m"
    )
    lines = [
        "## Heartbeat (idle-surfaced)",
        "",
        f"User has been silent for: {idle_desc}",
        f"Last user message at: {last_user_at or 'n/a'}",
        f"Last heartbeat generated at: {last_hb_mtime or 'n/a'}",
        "",
        "Recent HEARTBEAT.md content:",
        "```",
        preview.rstrip(),
        "```",
        "",
        "This pulse surfaces only after >=3h idle, so I'm starting cold.",
        "Check whether the heartbeat file lists any active gate items that need action.",
    ]
    return "\n".join(lines)


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        log(f"bad input: {e}")
        return 0

    cwd = payload.get("cwd") or os.getcwd()
    if not any(cwd.startswith(p) for p in AGENTCO_PATHS):
        return 0

    state = fetch_idle_state()
    if not state:
        return 0

    # Decide locally — keeps this script's threshold the source of truth
    # even if the relay's default differs.
    seconds_idle = state.get("secondsIdle")
    if seconds_idle is None:
        should_surface = True  # no prior user message → cold start, surface
    else:
        should_surface = seconds_idle >= IDLE_THRESHOLD_HOURS * 3600

    if not should_surface:
        return 0

    context = format_heartbeat_context(state)
    output = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        }
    }
    sys.stdout.write(json.dumps(output))
    return 0


if __name__ == "__main__":
    sys.exit(main())
