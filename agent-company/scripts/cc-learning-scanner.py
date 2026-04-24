#!/usr/bin/env python3
"""cc-learning-scanner.py — Learning Flywheel capture layer.

Invoked by cc-persist-hook.py after the turn is persisted. Scans the
assistant text + transcript tool-call patterns for learning signals,
POSTs each match to /capture-learning.

Kept separate from the persist hook so the persistence path stays fast
and this layer can be extended independently.

Signal families:
  - narrative: regex patterns in assistant text ("the real issue was",
    "main tradeoff", "my lean", "bisect", etc.)
  - structural: transcript shapes (5+ Bash calls = diagnostic session,
    3+ Read across varied paths = deep analysis)
  - explicit: section markers (## Finding, ## Lesson, ## Root cause,
    "Learning:" line starters)

Each match is tagged with a skill (thinking/building/ideating/diagnosing)
and pattern. Dedup by (skill_tag, excerpt[:100]) per turn.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

RELAY_URL = os.environ.get("AGENTCO_RELAY_URL", "http://localhost:3456")
LOG_PATH = Path.home() / ".claude" / "cc-learning-scanner.log"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


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


# ── Narrative patterns: (regex, skill_tag, pattern_label) ──
# Patterns are case-insensitive, word-bounded where it matters.
# Each pattern triggers capture of the sentence it appears in.
NARRATIVE_PATTERNS = [
    # THINKING
    (r"\bthe real issue was\b", "thinking", "root-cause"),
    (r"\broot cause was\b", "thinking", "root-cause"),
    (r"\btension\b.*\bsignal\b|\bmissing layer\b", "thinking", "structural-diagnostic"),
    (r"\blower layer\b|\bshared knowledge\b", "thinking", "dependency-direction"),
    (r"\breversibility\b|\bblast radius\b", "thinking", "conflict-cascade"),
    (r"\bedge case\b.*\b(threshold|transition|boundary)\b", "thinking", "edge-case-rigor"),
    (r"\boriginal goal\b|\bend goal\b.*\bserve\b", "thinking", "recursive-self-questioning"),
    (r"\bwalk the state\b|\bstate machine\b", "thinking", "edge-case-rigor"),

    # BUILDING
    (r"\breinvent\b.*\bcompose\b|\bcompose\b.*\breinvent\b", "building", "reinvent-vs-compose"),
    (r"\bhost\b.*\blibrary\b.*\bservice\b|\bintegration shape\b", "building", "integration-shape"),
    (r"\bextract\b.*\bname would communicate\b", "building", "extraction"),
    (r"\berror boundary\b|\bcatch at boundary\b", "building", "error-boundary"),
    (r"\bfile-first\b|\bpersist before\b.*\bprocess\b", "building", "file-first"),
    (r"\bSIGTERM\b|\bgraceful shutdown\b", "building", "graceful-shutdown"),
    (r"\bidempoten\w+\b", "building", "idempotency"),
    (r"\btrace ?id\b|\brequest tracing\b", "building", "tracing"),

    # IDEATION
    (r"\bmy lean\b", "ideating", "recommendation"),
    (r"\bmain tradeoff\b|\bkey tradeoff\b", "ideating", "tradeoff-naming"),
    (r"\b3 options?\b|\boption set\b|\bgenerated .* options\b", "ideating", "option-widening"),
    (r"\bpredict(ed)? .* response\b|\bpredict(ed)? .* answer\b", "ideating", "predict-before-ask"),
    (r"\bripple\b.*\bunlocks?\b|\badjacent cheap wins\b", "ideating", "ripple-analysis"),
    (r"\bsecond-order\b", "ideating", "second-order-effects"),
    (r"\blimitless\b|\blimit.*\bdesign assumption\b", "ideating", "limit-revisit"),
    (r"\bautonomous direction\b|\bresolv\w* (the )?ambiguity\b", "ideating", "autonomous-direction"),

    # DIAGNOSTICS
    (r"\bsilent (failure|fail)\b", "diagnosing", "silent-failure"),
    (r"\bbisect\w*\b|\bhalve the candidate\b", "diagnosing", "bisection"),
    (r"\breproduc\w+\b.*\b(deterministic|before)\b|\breproducer\b", "diagnosing", "reproduce-first"),
    (r"\b(five|5)[\- ]why\b", "diagnosing", "root-cause-ladder"),
    (r"\binstrument .*silence\b|\bmake .*silence loud\b", "diagnosing", "silence-instrumentation"),
    (r"\bprofile\b.*\bbefore optimiz\w+\b", "diagnosing", "profile-first"),
    (r"\bpostmortem\b|\bstructural fix\b", "diagnosing", "postmortem"),
]
NARRATIVE_COMPILED = [(re.compile(p, re.IGNORECASE), s, l) for p, s, l in NARRATIVE_PATTERNS]

# ── Explicit section markers ──
EXPLICIT_PATTERNS = [
    (r"^##+\s*(finding|lesson|gotcha|root cause|key insight|learning)\b", "diagnosing", "explicit-section"),
    (r"^\s*(learning|lesson|key insight):\s+", "diagnosing", "explicit-line"),
]
EXPLICIT_COMPILED = [(re.compile(p, re.IGNORECASE | re.MULTILINE), s, l) for p, s, l in EXPLICIT_PATTERNS]


def extract_sentence(text: str, match_span: tuple[int, int], window: int = 320) -> str:
    """Grab the sentence containing match_span, clipped to a reasonable window."""
    start, end = match_span
    # Backtrack to sentence boundary (., !, ?, \n) or 160 chars
    left = max(0, start - window // 2)
    right = min(len(text), end + window // 2)
    # Snap left to nearest sentence start
    chunk = text[left:right]
    # Clean up whitespace
    excerpt = " ".join(chunk.split())
    return excerpt[:600]


def scan_narrative(assistant_text: str) -> list[dict]:
    """Return list of {skill_tag, signal_type, signal_pattern, excerpt} for narrative matches."""
    seen = set()
    results = []
    for regex, skill, label in NARRATIVE_COMPILED:
        for m in regex.finditer(assistant_text):
            excerpt = extract_sentence(assistant_text, m.span())
            key = (skill, label, excerpt[:100])
            if key in seen:
                continue
            seen.add(key)
            results.append({
                "skillTag": skill,
                "signalType": "narrative",
                "signalPattern": label,
                "excerpt": excerpt,
            })
    return results


def scan_explicit(assistant_text: str) -> list[dict]:
    """Find explicit section markers / learning lines. These override skill_tag
    since the author labeled them directly."""
    seen = set()
    results = []
    for regex, default_skill, label in EXPLICIT_COMPILED:
        for m in regex.finditer(assistant_text):
            # Grab the whole paragraph/section that follows the marker
            start = m.start()
            end = assistant_text.find("\n\n", m.end())
            if end == -1:
                end = min(len(assistant_text), m.end() + 600)
            excerpt = " ".join(assistant_text[start:end].split())[:600]
            key = (default_skill, label, excerpt[:100])
            if key in seen:
                continue
            seen.add(key)
            # Try to refine skill_tag based on excerpt content
            skill = default_skill
            if re.search(r"\b(extract|compose|reinvent|error boundary|SIGTERM)\b", excerpt, re.IGNORECASE):
                skill = "building"
            elif re.search(r"\b(tradeoff|option|ripple|lean)\b", excerpt, re.IGNORECASE):
                skill = "ideating"
            elif re.search(r"\b(tension|lower layer|root cause|edge case)\b", excerpt, re.IGNORECASE):
                skill = "thinking"
            results.append({
                "skillTag": skill,
                "signalType": "explicit",
                "signalPattern": label,
                "excerpt": excerpt,
            })
    return results


def count_tool_calls(transcript_path: str | None) -> tuple[int, dict[str, int]]:
    """Count tool_use blocks in the last assistant turn sequence. Return
    (total_count, per_tool_count). Used to detect debugging sessions."""
    if not transcript_path or not os.path.exists(transcript_path):
        return 0, {}
    try:
        with open(transcript_path, "r") as f:
            lines = f.readlines()
    except Exception:
        return 0, {}

    # Find the last user-text index, then count tool_use blocks after it.
    last_user_idx = None
    entries = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    for i in range(len(entries) - 1, -1, -1):
        msg = (entries[i].get("message") or {})
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, list):
            has_text = any(isinstance(b, dict) and b.get("type") == "text" for b in content)
            if has_text:
                last_user_idx = i
                break
        elif isinstance(content, str) and content.strip():
            last_user_idx = i
            break

    if last_user_idx is None:
        return 0, {}

    per_tool: dict[str, int] = {}
    total = 0
    for entry in entries[last_user_idx + 1:]:
        msg = entry.get("message") or {}
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                tool = block.get("name", "unknown")
                per_tool[tool] = per_tool.get(tool, 0) + 1
                total += 1
    return total, per_tool


def scan_structural(transcript_path: str | None, assistant_text: str) -> list[dict]:
    """Structural signals based on transcript shape."""
    results = []
    total, per_tool = count_tool_calls(transcript_path)

    # 5+ Bash calls in one turn → debugging session (diagnosing)
    bash_count = per_tool.get("Bash", 0)
    if bash_count >= 5:
        # Pair with the first 400 chars of assistant text for context
        excerpt = f"[structural: {bash_count} Bash calls in one turn] " + " ".join(assistant_text.split())[:500]
        results.append({
            "skillTag": "diagnosing",
            "signalType": "structural",
            "signalPattern": f"bash-debug-{bash_count}-calls",
            "excerpt": excerpt,
        })

    # 3+ Read of varied paths → deep codebase analysis (thinking)
    read_count = per_tool.get("Read", 0)
    if read_count >= 3:
        excerpt = f"[structural: {read_count} Read calls in one turn] " + " ".join(assistant_text.split())[:500]
        results.append({
            "skillTag": "thinking",
            "signalType": "structural",
            "signalPattern": f"read-deep-{read_count}",
            "excerpt": excerpt,
        })

    # 10+ total tool calls → complex multi-step work (building)
    if total >= 10:
        excerpt = f"[structural: {total} total tool calls, mix: {per_tool}] " + " ".join(assistant_text.split())[:500]
        results.append({
            "skillTag": "building",
            "signalType": "structural",
            "signalPattern": f"multi-step-{total}",
            "excerpt": excerpt,
        })

    return results


def post_capture(entry: dict, session_id: str | None, turn_context: str | None) -> bool:
    payload = {
        **entry,
        "turnContext": turn_context,
    }
    if session_id and UUID_RE.match(session_id):
        payload["sessionId"] = session_id

    req = urllib.request.Request(
        f"{RELAY_URL}/capture-learning",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    token = load_relay_token()
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            resp.read()
        return True
    except Exception as e:
        log(f"capture post failed: {e}")
        return False


def scan_and_capture(assistant_text: str, transcript_path: str | None,
                     session_id: str | None, user_preview: str | None) -> int:
    """Full scan. Returns count of signals captured."""
    signals = []
    signals.extend(scan_narrative(assistant_text))
    signals.extend(scan_explicit(assistant_text))
    signals.extend(scan_structural(transcript_path, assistant_text))

    # Dedup: same (skill_tag, pattern, excerpt[:60]) — lets different patterns
    # co-exist within one turn while collapsing obvious duplicates.
    seen = set()
    dedup = []
    for s in signals:
        key = (s["skillTag"], s["signalPattern"], s["excerpt"][:60])
        if key in seen:
            continue
        seen.add(key)
        dedup.append(s)

    turn_context = None
    if user_preview:
        turn_context = f"user:{user_preview[:120]}"

    captured = 0
    for s in dedup:
        if post_capture(s, session_id, turn_context):
            captured += 1
    return captured


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        log(f"bad input: {e}")
        return 0

    cwd = payload.get("cwd") or os.getcwd()
    allowlist: list[str] = []
    if os.environ.get("AGENT_CO_ROOT"):
        allowlist.append(os.environ["AGENT_CO_ROOT"])
    else:
        allowlist.append(str(Path.home() / "agent-co"))
    extra = os.environ.get("AGENTCO_CWD_ALLOWLIST", "")
    if extra:
        allowlist.extend(p.strip() for p in extra.split(",") if p.strip())
    if not any(cwd.startswith(p) for p in allowlist):
        return 0

    assistant_text = payload.get("last_assistant_message") or ""
    session_id = payload.get("session_id") or ""
    transcript_path = payload.get("transcript_path")
    user_preview = payload.get("last_user_message") or ""

    if not assistant_text.strip():
        return 0

    captured = scan_and_capture(assistant_text, transcript_path, session_id, user_preview)
    if captured > 0:
        log(f"captured {captured} learning signals")
    return 0


if __name__ == "__main__":
    sys.exit(main())
