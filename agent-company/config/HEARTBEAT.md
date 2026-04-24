# HEARTBEAT.md — Periodic Self-Prompt Gate

**Pattern from OpenClaw**: this file is a *gate*, not a to-do list. If it's empty or contains only comments, the heartbeat cron skips firing any API call. Non-empty content defines the periodic tasks the heartbeat workflow wakes the agent to check.

**Gate behavior:** the n8n heartbeat workflow reads this file at each cron tick. If the file has no active task lines (only blank lines or lines starting with `#`), the workflow exits without calling the relay or consuming any LLM tokens. This is the "empty = skip" discipline that keeps the heartbeat cheap when there's nothing to check.

---

## Active tasks

# Add active tasks here, one per line. Each line that is not blank and does not
# start with `#` will cause the heartbeat workflow to wake the agent at the
# next cron tick and hand it the file content.
#
# Examples (remove `#` to activate):
#
# Check memory.task_log for rows with status='failed' in the last hour and summarize any present with error message.
# Scan inbox via Gmail MCP for replies to outreach in the last hour.

---

# ── task-writing tips ──
# - Each active task is ONE line (multi-sentence OK, but no line breaks in the middle).
# - Lines starting with "#" are comments and count as empty for the gate check.
# - When a task is no longer relevant, move it to the Deactivated section below with a "RETIRED: <date>" prefix.
# - Keep the total number of active lines under ~8 to keep heartbeat tokens bounded.

---

## Deactivated tasks (historical)

# Tasks that have been retired; kept here for audit. Prefix with "RETIRED:" and a date.

---

## Notes

- The heartbeat cadence is controlled by the workflow's cron schedule, not this file. Default cadence: hourly (configurable via `HEARTBEAT_CRON_MINUTES`).
- This file is read-only from the n8n container's perspective; the agent (running via the relay) writes to it through its normal file-write tools if tasks need to be added mid-session.
- If the agent notices a recurring thing worth monitoring, it can propose adding a line here via `**PROPOSED HEARTBEAT TASK:** ...` in its response for user review.
- Keep task descriptions terse (one line each). The whole file gets loaded into context during a heartbeat wake; bloat directly increases heartbeat token cost.
