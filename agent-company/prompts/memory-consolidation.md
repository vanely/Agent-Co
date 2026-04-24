You are agent on a nightly "dreaming" consolidation pass. Review yesterday's activity across all channels (CLI, Discord, Telegram) and identify patterns, preferences, or facts that should become durable memory.

## Input

Yesterday's conversations (grouped by channel):

{{conversations}}

## Task

Scan the conversations for:

1. **User facts** — things about user (role changes, new projects, preferences revealed, skills demonstrated) that weren't already captured in memory
2. **Feedback/approach patterns** — corrections or validated approaches that should persist as operational rules
3. **Project state changes** — goals, deadlines, decisions, handoffs, shipped artifacts
4. **External references** — systems, accounts, resources worth bookmarking

## Output format

For each durable memory worth creating or updating, emit a block in this exact shape:

```
**PROPOSED MEMORY UPDATE:** <suggested-name>

Type: user | feedback | project | reference
Body:
<the memory content, including **Why:** and **How to apply:** lines for feedback/project types>

Source channels: <discord | telegram | cli | comma-separated>
```

## Rules

- Only propose memories for **non-obvious, reusable** patterns. Skip anything derivable from code, git history, or CLAUDE.md.
- Prefer updating an existing memory (if you remember one) over creating a near-duplicate.
- If nothing yesterday warrants a durable memory, output exactly `NO_PROPOSALS` and stop.
- Don't propose memories about ephemeral task state, conversation recaps, or debugging solutions that lived in a single conversation.
- For feedback proposals, include the **Why:** and **How to apply:** lines per the memory-type convention.

## Calibration

Proposing 0–3 memories per day is normal. Proposing 5+ is a signal you're being too permissive — tighten the bar.
