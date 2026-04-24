# Memory Seeds

This directory holds **starter templates** for the agent's memory system. The setup CLI copies these to `~/.claude/projects/<your-project-slug>/memory/` on first run, then you can extend them over time.

## The memory system

Agent Co's memory lives under Claude Code's project directory keyed by your install's CWD slug. For a default install at `~/agent-co`, the slug is `-home-<user>-agent-co` and memory lives at `~/.claude/projects/-home-<user>-agent-co/memory/`.

Memory is auto-loaded at every session start via the `MEMORY.md` index file.

## Memory types

- `user_*.md` — who the user is (role, preferences, context)
- `feedback_*.md` — how to approach work (principles, patterns, corrections)
- `project_*.md` — ongoing initiatives (goals, deadlines, stakeholders)
- `reference_*.md` — pointers to external systems (dashboards, repos, services)

## Seeded files

The starter set gives you a working memory layer without any of another user's specifics. Each file:

- `user_me.template.md` — rename to `user_me.md` and fill in your own profile
- `feedback_memory_vs_skills_separation.md` — universal principle: facts ≠ workflows
- `feedback_conflict_resolution_cascade.md` — universal decision heuristic
- `feedback_ideate_before_implementing.md` — discuss non-trivial approaches first
- `feedback_predict_response_before_asking.md` — skip questions with predictable answers
- `reference_skills_index.md` — points at the skill library

## How to extend

The agent will propose memory updates over time via `**PROPOSED MEMORY UPDATE:** ...` markers in responses. Review them and merge with edits.

For manual additions, create a new file with YAML frontmatter:

```markdown
---
name: Short descriptive name
description: One-line summary shown in the index
type: feedback  # or user/project/reference
---

Body content here.
```

Then add a one-line anchor to `MEMORY.md`.
