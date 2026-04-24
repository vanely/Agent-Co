#!/usr/bin/env python3
"""cc-persist-hook.py — Claude Code Stop-hook that persists CLI turns.

Fires after every CLI response. Reads the transcript, extracts the last
user-prompt + assistant-response pair, POSTs to the relay's
/persist-cli-turn endpoint. Non-blocking: any failure prints to stderr
(captured by CC) but never exits non-zero (which would block CC).

Hook input (stdin JSON):
  { session_id, transcript_path, cwd, hook_event_name, stop_hook_active }

Only fires for agent-co CWDs — other Claude Code projects are ignored.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

RELAY_URL = os.environ.get("AGENTCO_RELAY_URL", "http://localhost:3456")


def _default_cwd_allowlist() -> tuple[str, ...]:
    """Which CWDs should trigger the hook. Agent-co install root is always
    allowed; extend via AGENTCO_CWD_ALLOWLIST (comma-separated absolute paths)
    for additional project directories (e.g., a local browser-harness clone).
    """
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
LOG_PATH = Path.home() / ".claude" / "cc-persist-hook.log"


def log(msg: str) -> None:
    try:
        with LOG_PATH.open("a") as f:
            f.write(msg.rstrip() + "\n")
    except Exception:
        pass


def extract_text_blocks(content) -> str:
    """content is either a string or a list of content blocks. Join text blocks."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text" and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "\n".join(parts).strip()


def find_last_turn(transcript_path: str) -> tuple[str | None, str | None]:
    """Scan transcript for the last user-text prompt + aggregated assistant text
    that followed it. Returns (user_content, assistant_content)."""
    entries = []
    try:
        with open(transcript_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except FileNotFoundError:
        return (None, None)

    last_user_idx = None
    for i in range(len(entries) - 1, -1, -1):
        entry = entries[i]
        msg = entry.get("message") or {}
        if msg.get("role") != "user":
            continue
        text = extract_text_blocks(msg.get("content"))
        if text:
            last_user_idx = i
            break

    if last_user_idx is None:
        return (None, None)

    user_content = extract_text_blocks(entries[last_user_idx]["message"].get("content"))

    assistant_parts = []
    for entry in entries[last_user_idx + 1:]:
        msg = entry.get("message") or {}
        if msg.get("role") == "assistant":
            text = extract_text_blocks(msg.get("content"))
            if text:
                assistant_parts.append(text)

    assistant_content = "\n\n".join(assistant_parts).strip() or None
    return (user_content or None, assistant_content)


def post_turn(session_id: str, user_content: str | None, assistant_content: str) -> None:
    payload = {
        "channelId": "cli-pocket",
        "assistantContent": assistant_content,
        "username": os.environ.get("AGENTCO_USERNAME", "user"),
    }
    if session_id and UUID_RE.match(session_id):
        payload["traceId"] = session_id
    if user_content:
        payload["userContent"] = user_content

    req = urllib.request.Request(
        f"{RELAY_URL}/persist-cli-turn",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            resp.read()  # consume
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        log(f"post failed: HTTP {e.code} — body={body} — payload_sizes=user:{len(user_content or '')},assistant:{len(assistant_content)}")
    except Exception as e:
        log(f"post failed: {e}")


def main() -> int:
    try:
        raw = sys.stdin.read()
    except Exception as e:
        log(f"stdin read failed: {e}")
        return 0  # never block CC


    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        log(f"bad json: {e}")
        return 0

    cwd = payload.get("cwd") or os.getcwd()
    if not any(cwd.startswith(p) for p in AGENTCO_PATHS):
        return 0  # silently skip non-agent-co sessions

    transcript_path = payload.get("transcript_path")
    if not transcript_path:
        log("no transcript_path in hook input")
        return 0

    session_id = payload.get("session_id") or ""

    # CC's Stop hook passes `last_assistant_message` directly in stdin —
    # prefer it over transcript parsing because the transcript JSONL is
    # flushed asynchronously and may not contain the latest assistant text
    # yet when the hook fires. Fall back to transcript parsing for older
    # CC versions that don't include the field.
    assistant_content = payload.get("last_assistant_message")
    user_content = payload.get("last_user_message")

    if not assistant_content or not user_content:
        transcript_user, transcript_assistant = find_last_turn(transcript_path)
        if not assistant_content:
            assistant_content = transcript_assistant
        if not user_content:
            user_content = transcript_user

    if not assistant_content or not assistant_content.strip():
        # No substantive assistant text (e.g., pure tool-use turn) — skip.
        return 0

    post_turn(session_id, user_content, assistant_content)

    # Chain the Learning Flywheel signal scanner. Non-blocking; failures here
    # don't affect persistence (which has already happened above). Scanner
    # lives next to this script; compute relative to __file__ so it stays
    # portable across install locations.
    try:
        import subprocess
        scanner_path = str(Path(__file__).parent / "cc-learning-scanner.py")
        if Path(scanner_path).exists():
            # Forward the same stdin payload so the scanner has transcript + session.
            subprocess.Popen(
                [scanner_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,  # detach so CC doesn't wait on it
            ).communicate(input=raw.encode("utf-8"), timeout=0.5)
    except subprocess.TimeoutExpired:
        pass  # scanner keeps running detached; CC moves on
    except Exception as e:
        log(f"scanner spawn failed: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
