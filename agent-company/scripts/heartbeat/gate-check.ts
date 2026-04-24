/**
 * HEARTBEAT.md gate-check script.
 *
 * Read the HEARTBEAT.md file in the agent-company root and determine whether
 * it has active tasks. Active = at least one non-empty, non-comment line in
 * the body (outside the "Deactivated tasks (historical)" and "Notes" sections).
 *
 * The n8n heartbeat workflow (workflow 12) calls this script on each cron
 * tick via an Execute Command node. If hasTasks is false, the workflow exits
 * without invoking the relay, preserving tokens.
 *
 * Pattern borrowed from OpenClaw — empty HEARTBEAT.md = skip heartbeat
 * entirely.
 *
 * Output: JSON to stdout.
 *   { hasTasks: boolean, taskCount: number, tasks: string[] }
 *
 * Usage:
 *   node dist/heartbeat/gate-check.js
 *   (or tsx scripts/heartbeat/gate-check.ts from dev)
 *
 * Exit codes:
 *   0 — always (the hasTasks signal is in the JSON, not the exit code)
 *   1 — file missing or unreadable (prints { error: "..." } to stdout)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HEARTBEAT_PATH = process.env.HEARTBEAT_FILE
  ?? '/config/HEARTBEAT.md'

type Result =
  | { hasTasks: boolean; taskCount: number; tasks: string[] }
  | { error: string }

function gateCheck(filePath: string): Result {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch (err: any) {
    return { error: `Failed to read ${filePath}: ${err.message}` }
  }

  const lines = content.split('\n')
  const tasks: string[] = []

  let inActiveSection = false
  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Section boundaries
    if (/^##\s+Active tasks/i.test(line)) {
      inActiveSection = true
      continue
    }
    if (/^##\s+(Deactivated tasks|Notes)/i.test(line)) {
      inActiveSection = false
      continue
    }

    if (!inActiveSection) continue

    // Skip blanks, comments, separators
    if (line === '' || line === '---') continue
    if (line.startsWith('#')) continue

    // Found an active task line
    tasks.push(line)
  }

  return {
    hasTasks: tasks.length > 0,
    taskCount: tasks.length,
    tasks,
  }
}

const result = gateCheck(HEARTBEAT_PATH)
process.stdout.write(JSON.stringify(result))
process.exit('error' in result ? 1 : 0)
