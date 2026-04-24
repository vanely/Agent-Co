# context/ — Session Bootstrap Directory

This directory holds the bootstrap files that shape each agent session. Referenced from the root `CLAUDE.md`; read at session start.

## Files

| File | Scope |
|---|---|
| `SOUL.md` | Agent identity, voice, ethos, drift-checks |
| `AGENTS.md` | Operational rules: coordinator pattern, trade-off hierarchies, anti-drift directives, named reasoning vocabulary, pointers to runtime layers |
| `SKILLS-INDEX.md` | XML lazy-discovery index for the skill library; individual SKILL.md bodies stay out of context until invoked |
| `README.md` | This file |

## Loading precedence

From `CLAUDE.md`:

1. `AGENTS.md` — operational patterns shape behavior
2. `SOUL.md` — identity tunes voice/style
3. `SKILLS-INDEX.md` — methodology manifest available on demand

This mirrors OpenClaw's shipped bootstrap precedence.

## The mental model

**Bootstrap files are vocabulary. Runtime is reasoning.**

- AGENTS names trade-off preferences, observable failure modes, input trust classification, and invocable reasoning patterns
- SOUL names identity, relationship patterns, drift-checks — the "who" behind the reasoning
- SKILLS-INDEX names methodologies available on demand — the "how-tos" for specific situations

None of these replace reasoning; they **shape** it.

## Extending

You can customize these files for your install:

- **SOUL.md** — make the identity your own (name, voice, what this agent is *for* in your life)
- **AGENTS.md** — adjust operational rules if your workflow differs materially from the defaults
- **SKILLS-INDEX.md** — add entries for any new skills you write

All three are designed to be read (not just loaded). Open them and adjust.

## Memory vs. bootstrap

Bootstrap files here are **stable**, auto-loaded every session.

Specific evolving knowledge — preferences, project status, incidents, reference pointers — goes to the **memory system** at `~/.claude/projects/<slug>/memory/`, seeded on first-run from `memory-seeds/`. The memory index is `MEMORY.md`.

Bootstrap is the skeleton. Memory is the fast brain. Both matter.
