# Session Export / Import

Export and import **Claude Code sessions** — the per-session state that lives under `~/.claude/projects/`. Useful for migrating an agent's identity between machines, sharing a skill library snapshot, or archiving a finished project's conversation history.

**What this does NOT touch:** the agent-co infrastructure. Postgres state, n8n workflows, and the system-wide agent-co skills library are all separate concerns — they have their own backup path. This tool operates strictly on Claude Code's session directories.

## Quick start

```bash
# See what's on this machine
agentco session list

# Interactive export (default scope: memory only)
agentco session export

# Target-specific export
agentco session export --slug=-home-you-agent-co --scope=full --out=/tmp/my-export

# Import elsewhere
agentco session import /path/to/my-export/<agent-name>_<timestamp>/
```

## What's a session?

Claude Code keys session state by CWD. Every directory you've run `claude` from becomes a "session" under `~/.claude/projects/<cwd-slug>/`, where the slug is the CWD with `/` replaced by `-`.

Inside a session directory:
- `*.jsonl` — full conversation transcripts (one file per CC session start)
- `memory/*.md` — auto-loaded memory files (if that session uses them)

The session's **CWD** is where skills live (at `<cwd>/skills/`), where bootstrap files live (`<cwd>/context/`, `<cwd>/CLAUDE.md`), where `.mcp.json` is picked up, etc.

### Two "names" — they look similar but mean different things

The list view shows both because they're independent and get confused easily:

| Column | Source | What it is |
|---|---|---|
| `agent` | `<cwd>/context/SOUL.md` (the `I am **<name>**.` line) | The **identity** the user gave the agent — what it calls itself |
| `title` | Claude Code `customTitle` (set by `claude --name <title>`) | The **session-group key** CC uses to resume sessions and show in `/resume` pickers |

You can have an agent named `Pocket` (identity) whose sessions live under the customTitle `agent-co` (so every channel — CLI, Discord, Telegram — resumes the same thread). Changing either one doesn't change the other. Export manifests record both (`agent_name` and `session_title`) so context survives the move.

## Scopes

| Scope | What's included |
|---|---|
| `memory` *(default)* | Just `memory/*.md` |
| `skills-only` | Just `<cwd>/skills/*.md` |
| `full` | `memory/` + `transcripts/*.jsonl` + `<cwd>/skills/` |

**Default is memory** because memory files are the most valuable and most portable — they hold the agent's identity, feedback, preferences, and project context without the transcript weight.

**Use full** when migrating a project between machines and you want conversation continuity.

**Use skills-only** to share a methodology snapshot between installs without bringing anything personal along.

## Export directory structure

```
~/agent-co-exports/<agent-name>_<timestamp>Z/
├── manifest.json
├── memory/              (if scope ∈ {memory, full})
│   └── *.md
├── transcripts/         (if scope = full)
│   └── *.jsonl
└── skills/              (if scope ∈ {full, skills-only})
    └── *.md
```

### manifest.json

```json
{
  "schema_version": 1,
  "tool": "agentco-session",
  "exported_at": "2026-04-23T21:25:02Z",
  "source_hostname": "my-laptop",
  "source_user": "ada",
  "session_slug": "-home-ada-agent-co",
  "session_cwd": "/home/ada/agent-co",
  "agent_name": "Atlas",
  "scope": "full",
  "counts": { "memory": 85, "transcripts": 14, "skills": 10 }
}
```

Used by the importer to show a preview and decide where things go.

## Interactive export flow

```
$ agentco session export

Claude Code sessions (14 found)
    #  agent        last active    msgs  mem  slug
  ───  ──────────── ──────────── ────── ────  ───────────────────
    1. Atlas        5s ago        19850   85  -home-you-agent-co
    2. —            6h ago         1056    0  -home-you-agent-co-agent-company-relay
    ...

Pick session(s) to export (number / comma-list / range / 'all' / 'q' to quit): 1
Exporting 1 session(s) with scope=memory
▸ Atlas …
✓ → ~/agent-co-exports/Atlas_20260423T212502Z  (memory:85 transcripts:0 skills:0)
```

Picker syntax:
- `1` — single
- `1,3,5` — list
- `2-4` — range
- `all` — every session
- `q` — quit without exporting

## Interactive import flow

```
$ agentco session import ~/agent-co-exports/Atlas_20260423T212502Z

Import preview
  source host   : my-laptop
  exported at   : 2026-04-23T21:25:02Z
  agent name    : Atlas
  session slug  : -home-ada-agent-co
  scope         : full
  contents      : memory=85  transcripts=14  skills=10

Target session
  Target slug [-home-newmachine-agent-co]: ⏎

Per-section strategy
  Options per section:
    replace  back up the existing section, use imported as-is
    merge    add imported files; on collision keep both (suffix .imported)
    skip     don't touch this section

  memory (85 file(s)) (replace/MERGE/skip) [merge]: ⏎
  transcripts (14 jsonl) (replace/merge/SKIP) [skip]: ⏎
  skills (10 file(s)) (replace/MERGE/skip) [merge]: replace

Skills target directory
  Skills install location [~/agent-co]: ⏎

Import complete
  ✓ memory: 85 copied, 0 skipped (identical)
  ✓ transcripts: 0 copied, 0 skipped
  ✓ skills: 10 copied, 0 skipped
```

### Strategies

- **replace** — back up the existing section (as `<name>.pre-import.<timestamp>/`), copy imported as-is.
- **merge** — add imported files that don't exist; on byte-identical collisions, skip silently; on content-different collisions, keep both (imported file gets `.imported` suffix).
- **skip** — don't touch this section.

Replace is destructive but guaranteed; merge is safe but leaves some cleanup. Skip is what you want when you've already imported memory on a prior run and just want to bring in skills now.

## Boundaries

**What this tool does NOT do:**

- ❌ Export `memory.messages`, `memory.learning_journal`, `memory.skill_contributions`, or any other Postgres-backed state.
- ❌ Export n8n workflows, credentials, or executions.
- ❌ Export agent-co's `.env` secrets.
- ❌ Modify `~/.claude/settings.json` (hooks) or the supervision configs.

For those, use the separate agent-co infrastructure backup (`bin/agentco-backup-infra`, forthcoming) which does `pg_dump` + skill library snapshot + workflow export.

**What this tool is for:**

- ✅ Moving an agent's identity + accumulated memory between machines.
- ✅ Archiving a finished project's conversation history.
- ✅ Sharing a methodology snapshot (skills-only) without any personal data.
- ✅ Forking an agent: export one session, import to a new slug, give it a new name.

## Safety

- Export is always additive — it never modifies the source session.
- Import's `replace` strategy always backs up before overwriting.
- The tool refuses to export sessions with no transcripts (likely stale).
- Agent name is auto-detected from `<cwd>/context/SOUL.md` when present, so exports are self-labeling.
- The CWD recorded in the manifest is read from the transcript's `cwd` field (robust to slugs-with-dashes) with a naive slug-decode fallback.
- Timestamps in export directory names (`_YYYYMMDDTHHMMSSZ`) prevent accidental overwrites on repeated exports.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "No sessions found" | `~/.claude/projects/` doesn't exist or has no transcripts | Start a Claude Code session first |
| Export shows `agent name: —` | Session's CWD doesn't have `context/SOUL.md` | That's fine — sessions don't require a SOUL file |
| Import writes to wrong slug | Typed a slug without leading `-` | Claude Code slugs are always CWD-encoded with a leading `-`; the tool warns but lets you proceed |
| Merge left `.imported` suffixed files | Collision with content-different files | Review each; delete whichever you want to discard |
| Skills section skipped silently | No `AGENT_CO_ROOT` env var and the user skipped the skills-target prompt | Re-run with `AGENT_CO_ROOT=/path/to/install` or type the path when prompted |
