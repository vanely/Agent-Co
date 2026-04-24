---
name: THINKING
description: How to think about non-obvious problems — structural diagnostics, dependency direction, conflict resolution, root-cause analysis, data lifecycle tracing, edge-case rigor, recursive self-questioning. Procedural methodology, not principles.
---

# THINKING — Methodologies for Non-Obvious Problems

This document defines *how to think* when the answer isn't obvious from the code or the request. It is the foundation the BUILDING, IDEATION, and DIAGNOSTICS skills compose with.

Read this when a task is ambiguous, a fix isn't landing, a design choice feels stuck, or the user's intent needs interpretation. These are procedural patterns — step-through methodologies, not slogans.

---

## 0. THE CORE STANCE

> When something feels wrong, it's a signal, not noise. Trace the signal to its structural source before proposing any fix.

Every section below is a specific way to decode signals. The common failure mode is to act on the surface of a signal (fix the symptom, answer the literal question) instead of finding what it's pointing at. Slow down to the structural layer; the right move usually becomes obvious.

---

## 1. STRUCTURAL DIAGNOSTICS — TENSIONS ARE SIGNALS, NOT TRADEOFFS

When two principles seem to conflict, the instinct is to "pick one." That's usually wrong. The tension is often telling you the boundaries are in the wrong place.

**Method:**
1. Name both principles in tension. ("We need X but also Y, and X kills Y.")
2. Ask: *if the right abstraction existed, would this tension dissolve?* Usually yes.
3. Look for the missing layer: a separation of concerns that lets both principles hold simultaneously, operating at different levels.
4. If the missing layer is real, the tension is a structural signal. Build the layer.
5. If after honest search no missing layer exists, then it is a real tradeoff — proceed to §3 (conflict resolution cascade).

**Example (the Learning Flywheel itself):** the tension "skill updates need to be both automatic (survives decay) and high-quality (requires judgment)" dissolves once you separate CAPTURE (passive text scan) from CONSOLIDATION (agentic distillation) from APPROVAL (human). Each phase has different quality requirements because each operates at a different layer.

**Example (the memory-vs-skills split):** the tension "this knowledge should be always-loaded (memory) but also detailed (skill)" resolves by storing the principle anchor in memory + the full procedure in a skill, cross-referenced.

**Anti-pattern:** treating every tension as a binary choice. That ships the compromise; it doesn't uncover the structure.

---

## 2. DEPENDENCY DIRECTION — LATERAL IMPORTS SIGNAL A MISSING LOWER LAYER

Dependencies flow downward: higher layers depend on lower ones, never sideways. When two modules at the same logical level import from each other (or one does circular-ish gymnastics to reach the other), a lower-layer abstraction is missing.

**Method:**
1. When you notice two peer modules reaching across each other, stop.
2. Ask: *what knowledge do they both need that neither should own?* That's the missing lower layer.
3. Extract that shared knowledge into a new module below both. Both peers now import downward, not sideways.
4. If the shared knowledge is small (a type, a constant), the "lower layer" might be a single file. Still extract it.

**Example:** Discord bot and Telegram bot both need to format messages in a consistent way. If Discord imports a helper from Telegram (or vice versa), that's a signal — the formatter belongs in a lower `shared/format.ts` both import from.

**Example from today's work:** the MCP server's `notify_discord`, `notify_telegram`, and `notify_all` all needed the same relay-auth + fetch pattern. Rather than duplicate or have them cross-reference, they all call a single `relayFetch()` helper — one lower layer.

**Anti-pattern:** helper modules that import from their callers. The helper should know less than its callers, not more.

---

## 3. CONFLICT RESOLUTION CASCADE — WHEN TWO RIGHT ANSWERS CLASH

After §1 confirms the tension is a real tradeoff (no structural fix exists), resolve in this order:

1. **Reversibility** — prefer the option that's easier to undo. A deploy that can be rolled back beats a schema migration that can't.
2. **Blast radius** — prefer the option whose failure affects fewer systems / users.
3. **Next change** — prefer the option that makes the *next likely change* easier, not the current one.
4. **Locality** — prefer keeping related changes in one place over spreading them.
5. If still tied: **ideate** (see IDEATION §2). Two tied options often mean the real answer is a third you haven't generated.

**Why this order:** reversibility dominates because a mistake you can undo is cheap; a mistake you can't is expensive. Blast radius comes next because limiting who a failure hurts is the next cheapest insurance. Next-change optimization beats current-change optimization because code outlives the moment it was written.

**Example:** "Should we add this column to the users table, or create a sidecar table?"
- Reversibility: dropping a sidecar is cleaner than dropping a column used in 12 queries. **Sidecar wins.**
- Blast radius: a broken column migration can lock the users table. Sidecar failure only affects the new feature. **Sidecar wins.**
- Decision: sidecar.

**Anti-pattern:** reaching for "purity" criteria (consistency, symmetry, elegance) before reversibility. Beautiful designs that can't be rolled back fail harder.

---

## 4. ROOT CAUSE vs. SYMPTOM — THE FIVE-WHY LADDER

Every symptom points at a chain. Fixing the symptom without climbing the chain means the same problem reappears in a different shape.

**Method:**
1. State the symptom as observed. ("The hook didn't fire under systemd.")
2. Ask *why* that happened. ("The CWD was /home/vnly, not the agent-co path.")
3. Ask *why* that state existed. ("Systemd services default to HOME as WorkingDirectory.")
4. Ask *why* the CWD mattered. ("The hook script has an explicit CWD guard that rejects non-agent-co paths.")
5. Ask *why* the guard exists. ("To prevent hooks from firing during unrelated CC sessions in other projects.")
6. Stop when the next "why" is architectural intent rather than accidental state.

**The fix lives at the layer where "why" transitions from state to intent.** In the example: the root cause is the systemd-CWD default vs. the hook's CWD guard. Fix = set `WorkingDirectory=` explicitly on the service unit. Fixing higher (removing the CWD guard) would remove an intentional protection; fixing lower (changing systemd defaults) is out of scope.

**When to stop the ladder:**
- You hit architectural intent (design choice, not bug).
- The "why" starts repeating.
- Further climbing would require changes outside the blast radius you control.

**Anti-pattern:** stopping at the first "why." That fix usually works for one case and recreates the bug in the next case.

---

## 5. DATA LIFECYCLE TRACING — FOLLOW THE PAYLOAD, NOT THE CODE

Before building or debugging anything that moves data, trace the full lifecycle end-to-end: where it enters, every transformation, every persistence, every exit point. Gaps in the trace are where bugs and design errors live.

**Method:**
1. Identify the data unit. ("A skill contribution," "a CLI turn," "a lead record.")
2. Name every entry point. (HTTP POST, form submission, migration, cron insert.)
3. For each, walk forward: what function receives it? What does it transform? What table/file/stream does it persist to?
4. From each persistence, walk forward again: what reads it? What derives from it?
5. Flag branches: at any point, the data might be transformed, filtered, dropped.
6. Don't stop until every possible path reaches either a terminal state (deleted, archived) or is reintroduced upstream.

**Then ask:**
- Which steps are *implicit*? (E.g., "the Stop hook fires after the turn" is implicit unless you also check that the transcript has been flushed — and today we learned it hasn't.)
- Which branches drop or swallow data silently?
- Which persistences diverge from each other? (Two sources of truth = future bugs.)

**Example from today:** the Stop hook was reading the transcript for the assistant content, but the transcript isn't flushed synchronously with Stop firing. The fix came from tracing the lifecycle: the assistant content enters the hook via stdin's `last_assistant_message` field *before* it lands in the transcript. Fix: prefer the stdin field, fall back to transcript.

**Anti-pattern:** starting to code before the trace is complete. Bugs hide in the gaps of the trace.

---

## 6. EDGE-CASE RIGOR — WALK THE STATE MACHINE BEFORE SHIPPING

Every feature has states. Most bugs live at state transitions: boundary conditions, concurrent edits, empty/null/overflow inputs. Walk the full state machine before declaring done.

**Method:**
1. Enumerate every state the feature can be in. (Idle, loading, loaded, error, deleting, empty, full, concurrent-modified, …)
2. Enumerate every transition between states. (Initial load, refresh, failure mid-load, succeed after failure, cancel, timeout, …)
3. For each transition, ask:
   - What if it happens twice in a row?
   - What if the prior state was unexpected?
   - What if the transition partially completes?
4. For each state, check:
   - Empty input (0, "", null, [], undefined)
   - Max input (overflow, huge array, deeply nested)
   - Concurrent input (two callers racing)
   - Idempotency (calling twice == calling once?)

**Thresholds aren't transitions.** If a feature fires "after 3 hours," check behavior at 2h59m, 3h00m, 3h01m. If a count-based trigger fires at 5+, check at 4, 5, 6.

**Example:** the idle heartbeat (3h threshold). I test at 2h59m (silent), 3h00m (fires), 3h01m (fires). I also test with secondsIdle=null (first-ever session, should fire) and seconds_idle=0 (just messaged, should NOT fire).

**Anti-pattern:** testing the golden path and shipping. Edge cases surface at 3am.

---

## 7. RECURSIVE SELF-QUESTIONING — CHECK AGAINST THE END GOAL

Between every few steps of building, pause and ask: *does what I've built so far actually serve the end goal?* Not the proximate task — the real goal the user stated at the start.

**Method:**
1. Restate the user's original goal in one sentence. Not your interpretation — their actual words.
2. Walk through what you've built. For each piece: is this piece directly serving the goal, or serving an intermediate abstraction you invented?
3. Test the goal against the output: if a user tried to accomplish the goal using only what exists right now, would they succeed?
4. If the answer is "almost, but they'd hit X" — X is not a nice-to-have. X is blocking the goal.

**Example:** if the goal is "CLI sessions have parity with Discord/Telegram," the test isn't "does /notify-pocket work?" It's "can I, as Pocket, broadcast from CLI to both channels with one call?" That led to the `notify_all` tool — not a nice-to-have, but the actual goal's shape.

**The test of done:** if the user can't accomplish the goal end-to-end through the built surface, it isn't done, regardless of how much code shipped.

**Anti-pattern:** treating "I built the thing I set out to build" as the definition of done. The real test is whether the *user's original goal* is reachable through the built thing.

---

## 8. DEEP CODEBASE ANALYSIS — UNDERSTAND BEFORE TOUCHING

Non-trivial changes to an unfamiliar area require understanding the whole system first. The ripple analysis happens before the fix, not after.

**Method:**
1. Map the entry points: where does this flow enter the system?
2. Map the data movement (§5): what goes where, transformed how?
3. Map the consumers: what depends on the current behavior? Tests, other modules, downstream services, UI?
4. Predict cascades: if I change X, what breaks? What other flows touch the same surface?
5. Verify all affected files explicitly — don't rely on grep alone; grep misses dynamic references (strings, reflection, config).
6. Only then propose the change.

**Triggers for this method:**
- The feature touches a shared surface (auth, db, shared lib).
- The change will persist (schema migration, config, API contract).
- The codebase is unfamiliar.
- You've been surprised by the code at least once already.

**Skip this method when:**
- The change is local (one file, no consumers).
- The system is throwaway (migration script, one-off tool).
- You've touched this exact surface yesterday.

**Anti-pattern:** "surgical" fixes in unfamiliar areas that land quickly but break flows you didn't know existed.

---

## 9. PREDICTING THE USER'S RESPONSE BEFORE ASKING

When you feel the urge to ask the user "want me to do X?" or "should I proceed with Y?" — pause. Predict their answer from historical patterns.

**Method:**
1. Name the question you want to ask.
2. From prior context (this conversation, memory entries, the way they've responded to similar questions), what's the likely answer?
3. If the likely answer is "yes, do it" with >80% confidence: just do it, don't ask.
4. If the likely answer is genuinely uncertain or the action is high-blast-radius: ask.
5. If the likely answer is "no" or "not yet": either find the reason and preempt it, or flag it as a blocker without the useless question.

**Why:** asking wastes their attention on questions whose answers are predictable. Saves questions for moments that actually need judgment.

**Anti-pattern:** "Want me to check the logs?" after they asked what's happening. Of course they do. Check them.

---

## 10. NAMING THE TRADEOFF UP FRONT

When recommending something to the user, lead with the main tradeoff — not buried in the middle, not omitted.

**Method:**
1. Make the recommendation in one sentence.
2. Immediately after: "Main tradeoff: X."
3. Don't hedge with "but we could also…" lists unless asked.
4. If there's no tradeoff, say so explicitly — but be sure. Most real decisions have one.

**Why:** it lets the user evaluate with all the relevant info in the first 3 seconds. Hidden tradeoffs erode trust when they surface later.

**Example:** "My lean: MCP server over inline fetch calls. Main tradeoff: MCP requires a CC session restart to pick up tool changes, whereas inline fetch works immediately but doesn't expose the capability to other sessions."

---

## CONTRIBUTION SIGNALS

The Learning Flywheel routes captured learnings to skill docs based on pattern-matching the turn content. A learning belongs in THINKING.md when the captured excerpt or turn shape matches:

- **Structural diagnostic moments** — I resolved a conflict by finding a missing layer rather than picking one side.
- **Dependency-direction fixes** — a peer-import problem was solved by extracting shared knowledge downward.
- **Five-why ladders that landed somewhere new** — a root-cause chain that revealed an architectural intent I hadn't named before.
- **Data-lifecycle discoveries** — an implicit step in a flow that, once made explicit, explained a class of bugs.
- **State-machine edge cases** — a bug or near-miss at a threshold or transition.
- **Recursive goal-check moments** — a realization that "done" meant something other than the proximate task.
- **Named tradeoff formulations** — a tradeoff statement clean enough to reuse.

When the consolidation agent distills journal entries, it groups matching excerpts and proposes a `PROPOSED SKILL UPDATE:` with `mode: section-replace` against the most relevant section above — or `mode: append` if the learning doesn't fit an existing section.

**How to write a contribution:**
- Lead with the *method* (the procedural shape), not the anecdote.
- Include one concrete example (the anecdote) so future-me can ground the method.
- End with an explicit anti-pattern so the method's boundary is clear.

---

## RELATED SKILLS

- **BUILDING.md** — how to build given a thinking answer (composition, integration, extraction)
- **IDEATION.md** — how to generate options before committing to one thinking approach
- **DIAGNOSTICS.md** — how to investigate when the signal isn't decodable yet

Thinking precedes building; ideation precedes thinking (when uncertain); diagnostics precedes ideation (when the problem itself is unclear).
