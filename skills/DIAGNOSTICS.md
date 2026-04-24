---
name: DIAGNOSTICS
description: How to investigate when the problem isn't yet understood — deep codebase analysis, silent-failure isolation, profile-before-optimize, request tracing, troubleshooting runbooks, limitless-by-design stance. For when the symptom is visible but the cause isn't.
---

# DIAGNOSTICS — Methodologies for Investigation

Thinking assumes you know the problem. Ideation assumes you have options. Diagnostics is for *before* either — when something is wrong, or might be wrong, and you need to decode what's actually happening before proposing any fix.

Read this when: a hook fires successfully but nothing persists; a test passes but production fails; a feature works in isolation but breaks integrated; performance degrades without an obvious cause; an incident happens and you need to reproduce + locate + fix quickly.

---

## 0. THE CORE STANCE

> Before fixing, reproduce. Before reproducing, observe. Before observing, name the symptom precisely.

Most bad debugging sessions start with a vague symptom and jump to a vague hypothesis. Every method below disciplines one stage of the investigation so the fix, when it comes, is at the right layer.

---

## 1. NAME THE SYMPTOM PRECISELY

Before diagnosing, write down what you actually observed in one sentence. Not your interpretation — the raw observation.

**Method:**
1. State what you saw, not what you think it means. ("The /cc-health-check endpoint returned hooks_firing=false" — not "the hook is broken.")
2. State what you expected. ("I expected hooks_firing=true because the hook POSTed successfully from my manual test.")
3. State the discrepancy. ("Manual invocation works; systemd-invoked doesn't.")
4. Now diagnose against the *discrepancy*, not the symptom.

**Why:** diagnosing a precise symptom is tractable; diagnosing "the hook is broken" is a wild goose chase.

**Example:** "the hook didn't fire" is the lazy framing. Precise: "the systemd service reported hooks_firing=false while the manual invocation from the same shell reported true, even though both used the same script and environment." That's a diagnosable statement.

**Anti-pattern:** starting to debug without writing down the precise symptom. You end up "debugging vibes."

---

## 2. REPRODUCE BEFORE DIAGNOSING

A symptom you can reproduce on demand is a symptom you can debug. A symptom you can't reproduce is a guessing game.

**Method:**
1. Identify the minimal command or action that triggers the symptom.
2. Run it. Confirm the symptom appears every time (not intermittent).
3. If intermittent: identify the state it depends on (timing, order, external data). Capture that state. Make the reproducer deterministic.
4. Only then start hypothesizing.

**Why:** without a reproducer, you're fixing something blind. "Fixes" get shipped that don't actually address the cause because you can't verify either direction.

**Example:** for today's hook-silent-fail bug, the reproducer was `systemctl --user start agentco-cc-health-check.service` — deterministically reproduced "hooks_firing=false" every run. That let me bisect the environment and eventually find the WorkingDirectory difference.

**Contrast:** "sometimes messages get duplicated in memory.messages" → not diagnosable as stated. Find the trigger (which platform, which channel, which message shape), make it deterministic, then debug.

**Anti-pattern:** hypothesizing before reproducing. You end up fixing things that weren't broken.

---

## 3. BISECT THE DIFFERENCE

When two scenarios diverge (works here, breaks there), find the minimal change that flips the outcome.

**Method:**
1. State the two scenarios: "A: manual shell, hooks fire. B: systemd service, hooks don't fire."
2. List the differences you can observe: environment variables, CWD, user, cgroup, tty attachment, stdin, parent process.
3. For each difference, test whether removing it (or adding it to the other side) flips the outcome.
4. Halve the candidate list each step: copy half the differences at a time.
5. When a single difference flips outcomes, you've found the variable.

**Example:** the hook-silent-fail diagnosis:
1. A (works): manual shell. B (breaks): systemd.
2. Differences: CWD, tty, parent pid, stdin, env vars (DBUS, DISPLAY, XDG, JOURNAL_STREAM), resource limits.
3. Ran `env -i HOME=... PATH=...` manually (mimics systemd env): worked. So env vars not the cause.
4. Ran manual test with stdin from /dev/null: worked. So stdin not the cause.
5. Ran a debug script under systemd that dumped the CC stream-json: the init event showed `cwd=/home/vnly`, not agent-co. Hook's CWD guard rejected it.
6. Fix: `WorkingDirectory=/home/vnly/Projects/agent-co` in service unit.

That was a 5-step bisection; each step eliminated a category.

**Anti-pattern:** changing five things at once and seeing if it works. When it does, you don't know why. When it doesn't, you don't know what else to try.

---

## 4. FOLLOW THE CONTROL FLOW TO SILENCE

When something runs but produces no output (no log, no DB insert, no error), the failure is silent — and silent failures are the hardest kind. The fix is to instrument until silence becomes signal.

**Method:**
1. Add a log at the entry of the code path: "I got here."
2. Run. If the log doesn't appear, the path isn't being taken. Climb to the caller.
3. If the log appears, add another at the exit. If only entry appears, failure is mid-function. Bisect internally.
4. If both appear but the expected side effect didn't happen, the side effect's target is wrong (wrong path, wrong DB, wrong table, wrong channel).
5. Remove instrumentation once diagnosed. Don't leave debug logs littering production.

**Example:** the hook-silent-fail diagnosis added a `log(f"invoked cwd={cwd} ...")` line at the top of the hook. Under systemd, nothing appeared in the log file. That proved the hook wasn't being invoked at all — narrowed the problem to "CC isn't calling our hook" rather than "our hook isn't POSTing correctly." Different bug class, different fix.

**Key principle:** silent failure means your first job is to make it loud, not to fix it. A loud failure is one Google search from a fix.

**Anti-pattern:** guessing where the silence is. Instrument systematically.

---

## 5. READ THE TRACE BACKWARD

When an error surfaces, the most valuable line in the stack trace is often the deepest frame you own. Read bottom-up, not top-down.

**Method:**
1. Look at the deepest frame that's your code (not library internals).
2. Read it: what invariant does it expect? What input is it receiving? What's wrong with the input?
3. Climb up one frame. How did that wrong input get produced?
4. Continue until you reach the code that first introduced the wrong value.

**Why:** the top of the trace is often just "error bubbled up." The value is at the frame where the wrong value was born.

**Example:** `TypeError: Cannot read property 'id' of null` at line 312 of a route handler. Bottom-up:
- Line 312: expected user object, got null.
- Caller: `const user = await findUserById(req.params.id)`.
- `findUserById`: returns null if not found.
- The route handler didn't check for null — that's the bug.
- The fix isn't at line 312. It's at the boundary where null handling should happen.

**Anti-pattern:** reading top-down, fixing the first line that looks off. That patches symptoms.

---

## 6. PROFILE BEFORE OPTIMIZING

Performance work starts with measurement, not precaution. Don't optimize the thing you *think* is slow; optimize the thing the profile *shows* is slow.

**Method:**
1. Set a concrete target: "this endpoint should respond in <500ms p95."
2. Measure current state: real profiler (perf, py-spy, node --prof) or structured timing logs.
3. Identify the top 1-2 contributors to slowness. These are usually < 20% of the code doing > 80% of the time.
4. Optimize those specifically. Re-measure.
5. If target met: stop. Don't keep optimizing.

**Why:** intuition about what's slow is wrong more often than it's right. "Slow because too many DB queries" is sometimes a slow serializer. "Slow because synchronous I/O" is sometimes a slow regex.

**Example:** if the `/dashboard-summary` endpoint is slow, measure first. It could be the N+1 query on conversations, or the homedir path resolution, or the text serialization. Each needs a different fix. Guessing wastes the optimization budget.

**Anti-pattern:** "let me cache this" without measuring. Caches add complexity (invalidation, staleness) and should only be introduced when the profile justifies.

---

## 7. INCIDENT DOCUMENTATION — SYMPTOM → DIAGNOSIS → FIX

Every real incident should produce a row in a troubleshooting runbook: symptom, diagnosis, fix. This converts one-time pain into permanent recovery speed.

**Method:**
1. After resolving an incident, write:
   - **Symptom:** what the user/monitor observed.
   - **Diagnosis:** what was actually happening, including how you figured it out.
   - **Fix:** what change resolved it.
   - **Prevention:** what guardrail would prevent this class of issue (test, alert, hook, schema constraint).
2. Add to a runbook (markdown file, internal wiki, whichever is canonical).
3. When the same symptom shows up again, the runbook shortcuts diagnosis.

**Why:** incidents cluster. The same kind of bug happens 3 times before the pattern is named. A runbook makes the 2nd and 3rd instances 10x faster.

**Example (today):** hook-silent-fail under systemd. Add to a runbook:
- Symptom: hook invocation log empty, memory.messages no cli rows after `claude -p` under systemd.
- Diagnosis: systemd service CWD defaults to HOME; hook's CWD guard rejects paths outside agent-co.
- Fix: set `WorkingDirectory=/home/vnly/Projects/agent-co` on the service unit.
- Prevention: CI check that any new systemd service running claude commands has WorkingDirectory set. (Or: document "always set WorkingDirectory for claude-invoking services" in INFRA.md.)

**Anti-pattern:** "I'll remember." You won't. Six months from now you'll re-diagnose the same bug.

---

## 8. TRACE IDs FOR CROSS-SYSTEM DEBUGGING

When work crosses processes (HTTP call, queue message, subprocess, hook), logs become correlatable only if they share a traceId. This is diagnostic infrastructure you set up *before* the incident.

**Method:** (covered in BUILDING.md §7; here, the diagnostic angle)
1. When investigating, filter all logs by the incident's traceId. Cross-system view.
2. If the incident has no traceId: the fix is adding one, even retroactively. Grep for approximate correlators (timestamps, unique fields) and stitch manually for this incident, then instrument for future.
3. Cross-reference DB state with trace: does the trace end at a row in memory.messages, or did it lose its way?

**Why:** distributed systems without traceIds are effectively undebuggable at scale. You can diagnose one incident through heroics, but you can't maintain the system.

**Example:** `memory.cc_health_checks.research_traceId` joins against `memory.messages` — so when a health-check drift spawns a research claude, I can find the research turn later by SELECT research_traceId, then JOIN messages on trace_id. That join is only possible because we persisted the trace on both sides.

**Anti-pattern:** thinking traceIds are overhead. They're the single highest-leverage piece of observability you can add to a distributed system.

---

## 9. LIMITLESS-BY-DESIGN AS DIAGNOSTIC STANCE

Many "impossible to debug" problems are actually "we haven't instrumented the right place." Before declaring something undiagnosable, question whether the limit is physical or a design assumption.

**Method:**
1. State why you think you can't debug it. ("We can't see into that process." "The subprocess loses context." "This only happens in production.")
2. For each reason, ask: is this physical, or is it a choice?
3. "We can't see into that process" → add stdout/stderr logging. Or attach a debugger. Or strace it.
4. "The subprocess loses context" → pass a traceId via env var. Or have it POST a startup event.
5. "Only happens in production" → replay production traffic in staging. Or add high-cardinality logging that reveals the triggering input.

**Why:** debuggability is almost always a design choice. "Can't debug" is a challenge to the instrumentation, not a hard limit.

**Example:** "we can't tell whether the Stop hook fired under systemd because systemd captures stdout to journal" → false. journalctl shows the captured output. And if we wanted structured hook audit beyond stdout, we'd write to a dedicated log file (~/.claude/cc-persist-hook.log) — which we did.

**Anti-pattern:** accepting opacity as inherent. It almost never is.

---

## 10. POSTMORTEM, NOT BLAMESTORM

After an incident resolves, the useful question is *why the system allowed it*, not *who made a mistake*. The fix is structural.

**Method:**
1. What was the signal the system should have caught?
2. Where in the pipeline did the signal get lost or ignored?
3. What structural change adds a fence or a signal at that point?
4. Was the diagnostic journey itself slow? Where? Add instrumentation to speed the next one.

**Example:** the hook-silent-fail. Blamestorm would be "Pocket's script has a bad assumption." Postmortem:
- Signal lost: hook invocation didn't log anything when it short-circuited on CWD guard.
- Structural fix: the hook now logs even on early-return, so next time a systemd-invoked CC session silently fails, the log shows "cwd=/home/vnly, skipping."
- (Actually decided against this change because too-chatty logs are also an anti-pattern. Mitigated instead by the daily health check, which now always catches this class of issue.)

**Why:** systems fail; people do their best with the systems they have. Blame is emotionally expensive and structurally useless. Fences are both.

**Anti-pattern:** the "root cause was X forgot to Y" framing. The real question is why the system let a forgotten Y cause a problem.

---

## CONTRIBUTION SIGNALS

A learning belongs in DIAGNOSTICS.md when the captured excerpt or turn shape matches:

- **Silent-failure isolation journeys** — a bug where the key diagnostic move was "make the silence loud," with the specific instrumentation that revealed it.
- **Bisection successes** — a two-scenario divergence resolved by isolating the flipping variable.
- **Root-cause chains with non-obvious endings** — five-why ladders where the end was surprising.
- **Trace recoveries** — moments where traceIds (or their absence) were load-bearing for the diagnosis.
- **Profile-driven optimizations** — a perf fix where the profile revealed a non-obvious hot spot.
- **Incident runbook entries** — symptom/diagnosis/fix/prevention tuples worth permanent storage.
- **Limit revisits during debugging** — a "can't debug this" that turned out to be an instrumentation gap.
- **Postmortem-style structural fixes** — an incident that led to a fence or signal, not a discipline.

**How to write a contribution:** lead with the diagnostic move (instrument silence, bisect, read bottom-up), include one concrete incident as example, name the anti-pattern that would have misled the investigation.

---

## RELATED SKILLS

- **THINKING.md** — once diagnosis is complete, THINKING shapes the fix structurally.
- **BUILDING.md** — diagnosis often reveals architectural gaps that BUILDING addresses.
- **IDEATION.md** — when "what's the fix?" has multiple plausible answers, IDEATION generates the option set.
- **INFRA.md** — deploy-layer debugging (container, systemd, secrets).
- **TESTING-GUIDE.md** — preventing regressions after the fix.
