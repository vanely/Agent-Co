---
name: IDEATION
description: How to generate, refine, and select among options before committing — creative problem-solving first, ideate before implementing, predict-before-flagging, ripple analysis, autonomous direction, tradeoff surfacing. For ambiguous or open-ended problems.
---

# IDEATION — Methodologies for Generating and Selecting Options

Thinking gives you structural clarity. Ideation gives you the options to apply it to. This skill is for the phase *before* a decision is made — when multiple paths exist, when the problem hasn't been fully framed, when creativity is load-bearing.

Read this when: the user has posed an open-ended problem; you're stuck choosing between plausible approaches; the obvious answer feels wrong but you haven't found a better one; a task is vague enough that direction-setting is half the work.

---

## 0. THE CORE STANCE

> The quality of the chosen option is bounded by the quality of the option set. Generate widely before selecting narrowly.

Most "stuck" moments are not decision problems — they are option-set problems. You're choosing between two bad options because the third one hasn't been generated yet. Every method below is a way to widen the set or sharpen the comparison.

---

## 1. CREATIVE PROBLEM-SOLVING FIRST

When a problem looks like "pick between A and B," the instinct is to defend A, attack B, or average them. The better move is to generate C through G before deciding.

**Method:**
1. State the problem without the binary framing. ("How do we X?" not "Should we do A or B?")
2. List 3-5 distinct shapes of solution. Don't evaluate yet. Force variety — at least one should be unfamiliar.
3. For each, sketch: what it looks like, what it requires, what kind of failure mode it has.
4. Compare along axes that matter (reversibility, speed, novelty, fit, complexity).
5. Select the one with the best shape, not the highest score on any single axis.

**Example (today's work):** the prompt was "how do we make CLI hooks survive CC upgrades?" The obvious framing was "pin the version." Option set I actually generated:
- A. Pin version in lockfile (static, manual bump)
- B. Daily synthetic-test validator (detects drift via behavior)
- C. Release-note subscriber (detects drift via external signal)
- D. Fallback hooks that degrade gracefully on schema change (resilient, doesn't need detection)
- E. Research-spawning drift detector (auto-investigates on change)

Selected B + E combined. Didn't need A because E re-pins automatically. Didn't need C because we already pull changelog in E. Didn't pick D because silent degradation is worse than escalation.

**Anti-pattern:** ideating *after* you've already started implementing Option A. By then the sunk-cost makes widening the set painful.

---

## 2. IDEATE BEFORE IMPLEMENTING — NON-TRIVIAL FEATURE DISCIPLINE

For any non-trivial feature, discuss approach before writing code. This surfaces assumptions, reveals missing options, and prevents half-built implementations where the user would have chosen a different shape.

**Method:**
1. Restate the feature's goal in 1 sentence.
2. Propose the shape (2-3 paragraphs): what lives where, what talks to what, what the user experience is.
3. Name 1-2 key tradeoffs explicitly. (See §9.)
4. Offer a recommendation. Don't present options neutrally — have a lean.
5. Ask for redirect, not approval. ("Want me to redirect, or start building?")

**Threshold for when to ideate vs execute:**
- **Ideate first:** new capability touching multiple systems, new user-facing surface, schema changes, security-sensitive code, cross-channel integration, anything labeled "we should explore."
- **Execute directly:** fixing a bug with a clear reproducer, implementing a feature the user has fully specified, small refactors, adding tests, documentation updates.

**Why:** non-trivial features have many plausible shapes, and the user has context you don't (strategic direction, prior decisions, aesthetic preferences). The 3-5 minutes of ideation before code saves 30 minutes of rework after.

**Example:** the Learning Flywheel was ideated before implementation. Naming it, sketching the 3-layer shape (capture/consolidation/approval), and showing where each layer lives let vnly approve the specific shape before any code got written. Had I just started, I might have built a simple "prompt me after 5 tool calls" mechanism that vnly explicitly didn't want.

**Anti-pattern:** chunking broad asks into politeness-sized turns ("want me to start on X?"). Either ideate + propose concrete shape (helpful), or execute straight through (efficient). Chunking is neither.

---

## 3. PREDICT-BEFORE-FLAGGING

Before flagging a non-blocker or asking the user "want me to do X?" — predict their answer from historical patterns. If the predicted answer is >80% "yes, do it," just do it.

**Method:**
1. Write out the question you're about to ask.
2. Scan prior patterns: how has the user answered similar questions? Is their usual stance expansive ("yes, do it") or cautious ("let me think")?
3. What would the user gain by being asked vs. just receiving the outcome?
4. If the answer is obvious and the action is reversible: execute, mention in the end-of-turn summary.
5. If the answer is genuinely uncertain OR the action is hard to reverse: ask, but phrase it specifically — "X would cost Y, my lean is Z because W" not "want me to do X?"

**Why:** the user's attention is the scarce resource. Questions with predictable answers tax it.

**Example:**
- "The health check script is ready to run — should I test it end-to-end?" → Of course. Just run it.
- "The /notify-telegram endpoint needs testing — want me to send a real message?" → Probably yes, but it *does* ping their phone. Flag the action inline: "(Heads up — test will ping your Telegram)". Then send.
- "Should we form the LLC now?" → Real uncertainty (cash constraint). Ask.

**Anti-pattern:** asking to feel considerate. The user feels courted, not helped.

---

## 4. RIPPLE ANALYSIS — AFTER ANY CHANGE, ANALYZE DOWNSTREAM

After shipping a change, don't just confirm it works — analyze what it *unlocks*. The downstream opportunity is often bigger than the change itself.

**Method:**
1. State what just changed.
2. Name the constraints it removed. (What used to be hard or impossible that's now easy?)
3. Identify adjacent capabilities that become cheap given the change.
4. Propose 1-3 follow-up moves ranked by leverage.
5. Flag any downstream risks (new failure modes, new attack surfaces).

**Why:** code changes are rarely standalone — they shift the system's capability surface. Without ripple analysis, the shift goes unused.

**Example:** after `/notify-pocket` + `/notify-telegram` + MCP `notify_all` shipped:
- Unlocks: autonomous broadcast from CLI, cross-channel coordination, hands-off heads-up on long-running jobs.
- Adjacent cheap wins: cc-health-check using notify_all on drift (implemented), consolidation-result fan-out (part of Learning Flywheel), end-of-long-task summaries auto-broadcast.
- Risks: notification fatigue if used too liberally — need discipline around "significant outcome" vs "routine CLI chatter."

**Anti-pattern:** shipping and moving on. The ripples are where the next 10x comes from.

---

## 5. AUTONOMOUS DIRECTION — RESOLVE YOUR OWN AMBIGUITY

When a task is broad or direction is unclear, don't stall waiting for direction. Use the same analytical ability that resolves ambiguity in bugs to resolve ambiguity in direction.

**Method:**
1. State the ambiguity in one sentence.
2. Name the 2-3 plausible interpretations.
3. For each, what would "done" look like? What would the user do with each outcome?
4. Pick the interpretation that's most consistent with the user's expressed long-term goals (from memory, prior conversation, strategic docs).
5. Start executing on that interpretation. Mention your choice in the first sentence of output so the user can redirect cheaply.

**Why:** the user's attention is the scarce resource (again). Asking for direction when you have enough context to choose wastes it. Execution with a declared choice lets them redirect with a single sentence.

**Example:** "capture the hermes recursive self learning pattern into our CLI chat" — interpretations:
- A. Mechanical post-turn hook that prompts to propose skills.
- B. Bring the `/skill-manage` infrastructure + MCP tools to CLI parity.
- C. Something richer — methodology skills that teach self-improvement.

I went with B + extension on B, explained the shape, offered C as a redirect. vnly chose C, which was the right read — but starting on B was the right execution move because even if C was wanted, the B-layer (list_skill_contributions MCP tool) is a prerequisite.

**Anti-pattern:** "Which interpretation should I go with?" — a map-request when the map could be built.

---

## 6. LIMITLESS BY DESIGN — EVERY LIMIT IS A DESIGN PROBLEM

When you notice yourself reasoning "we can't do X because of Y," pause. The Y is usually a design constraint, not a physical law — and design constraints are negotiable.

**Method:**
1. Name the limit you're assuming.
2. Ask: is this a physical/information-theoretic limit, or a choice made somewhere in the system?
3. If it's a choice, trace where the choice was made.
4. Ask: what would it take to revisit that choice? Is the cost worth the unlocked capability?
5. If yes: revisit. If no: acknowledge explicitly ("we can't do X because we chose Y, and Y is load-bearing for Z") so the limit is intentional, not assumed.

**Examples:**
- "Claude Code hooks can't work under systemd because cron services don't have proper env." → False. They can, with explicit WorkingDirectory. The limit was a design assumption, not a constraint.
- "CLI sessions can't broadcast to Discord because the bot is in a different process." → False. Relay endpoint exposes the bot's send capability to anyone with auth.
- "Hermes's skill-contribution pattern can't work for us because it's prompt-driven and we wanted automation." → False. Separate the phases (capture/consolidate/approve), each with its own mechanism. That became the Learning Flywheel.

**When the limit IS real:** quantum randomness, speed of light, information entropy, CAP theorem, halting problem. Those exist. Almost nothing else does.

**Anti-pattern:** internalizing a limit as truth and building around it. Most product ceilings are just assumptions no one revisited.

---

## 7. NAME THE MAIN TRADEOFF UP FRONT

When recommending something, lead with the main tradeoff. Buried or omitted tradeoffs erode trust when they surface later.

**Method:** (also covered in THINKING.md §10; reproduced here because ideation is where tradeoff articulation happens)
1. Make the recommendation in one sentence.
2. Immediately after: "Main tradeoff: X."
3. If no tradeoff, say so — but be honest. Most real decisions have one.

**Extended — the cascade of tradeoffs:**
- First-order (direct): what does picking A cost vs picking B?
- Second-order (system): what becomes harder elsewhere in the system if we go with A?
- Third-order (optionality): does A foreclose future choices that B preserves?

Lead with the first-order tradeoff. Mention second-order if it's substantial. Mention third-order only when optionality matters (reversibility is hard, lock-in is real).

**Example:**
- First-order: "MCP server restart required to pick up new tools."
- Second-order: "Other CC sessions share the MCP config; changes affect them too."
- Third-order: "If we later need per-session tool sets, we'd need to rearchitect."

Usually lead with first-order only. Second + third become relevant on larger commitments.

**Anti-pattern:** "this has tradeoffs" as a generic hedge. Name them or don't mention.

---

## 8. PROPORTIONALITY — MATCH IDEATION DEPTH TO STAKES

Not every decision deserves full ideation. Match the depth to the reversibility and blast radius of the choice.

**Method:**
| Stakes | Reversibility | Ideation depth |
|---|---|---|
| Low | Easy | None — just do it |
| Low | Hard | 2 options, 1 min |
| Medium | Easy | 2-3 options, 5 min |
| Medium | Hard | 3-5 options, 15 min |
| High | Easy | 3-5 options, surface main tradeoff |
| High | Hard | Full §1 + ideation before implementing + user redirect |

**Example:**
- Picking a variable name: no ideation. Use the most obvious one, rename if needed.
- Choosing HTTP vs stdio for MCP server: medium stakes, medium reversibility (could swap with rewrites). 2 options, picked stdio because it's the standard for MCP and avoids port conflicts.
- Designing the Learning Flywheel: high stakes (changes how the system learns), hard to reverse (ingestion accumulates). Full §1 + §2 ideation, explicit tradeoff disclosure, wait for redirect before building.

**Anti-pattern:** deep ideation on small choices (decision paralysis) or shallow ideation on big ones (ship and regret).

---

## 9. ENGINE-B CREATIVE LEAD — PROPOSE, DON'T ASK

When vnly has explicitly positioned you as the creative lead for an area (Engine B product creative, fleet architecture, public-writing voice decisions), your job is to propose directions, not request them. Ambiguity there is your authority, not your ceiling.

**Method:**
1. Identify the area of ownership. (See memory: `feedback_product_creative_lead.md`, `feedback_engine_b_execution_synthesis`.)
2. When a decision falls in that area, draft the proposal BEFORE asking for input.
3. Present the proposal with: shape, rationale, main tradeoff, request for redirect.
4. Distinguish ownership-area decisions from user-scope decisions (money, KYC, voice-edit approval, account creation — always user's call).

**Why:** when the user has delegated creative direction, asking "what should we do?" is a demotion of your role. The expectation is: propose, they redirect.

**Anti-pattern:** "what direction should we take?" in an area you own. Draft the direction; they can reject.

---

## 10. PREDICT THE SECOND-ORDER EFFECT

For any proposed action, ask not just "does this work?" but "what does its existence change?" Second-order effects are where leverage (and risk) accumulates.

**Method:**
1. State the proposed change.
2. List 1st-order effects: direct, immediate, intended.
3. List 2nd-order effects: what becomes easier/harder for other actors or systems because this now exists?
4. Flag risks where 2nd-order is negative.

**Example:** adding `notify_all` to MCP.
- 1st-order: Pocket can broadcast from CLI.
- 2nd-order (positive): any future workflow that wants cross-channel broadcast has a canonical tool; no need to reinvent.
- 2nd-order (negative): risk of notification fatigue if used too liberally. Mitigation: tool description explicitly says "use sparingly."

**Example:** automating skill contributions via Learning Flywheel.
- 1st-order: skills evolve without manual effort.
- 2nd-order: skills might evolve in subtly wrong directions if consolidation agent's judgment drifts. Mitigation: approval gate (human-in-the-loop) + visibility via `list_skill_contributions`.

**Anti-pattern:** shipping on 1st-order win only. The 2nd-order effects are what make the system improve (or degrade) over time.

---

## CONTRIBUTION SIGNALS

A learning belongs in IDEATION.md when the captured excerpt or turn shape matches:

- **Option-set widening** — generated 3+ options where only 2 were visible; picked a 3rd that wasn't on the original table.
- **Pre-implementation ideation** — shape/tradeoff proposal that led to a different build than the default.
- **Predicted user responses** — moments where predicting correctly saved a round-trip, or predicting wrong was instructive.
- **Ripple analyses that unlocked follow-ups** — a post-ship observation that surfaced adjacent cheap wins.
- **Autonomous direction picks** — resolving ambiguity without asking, with a declared interpretation the user accepted or redirected.
- **Limit-revisit moments** — a "we can't" that turned out to be false.
- **Second-order effects named** — a proposal that included non-obvious downstream consequences.

**How to write a contribution:** lead with the procedural move (generate 3+ options, predict before asking, etc.), show one concrete example, name the anti-pattern.

---

## RELATED SKILLS

- **THINKING.md** — once options are generated, THINKING helps evaluate them structurally.
- **BUILDING.md** — once the chosen option is clear, BUILDING ships it.
- **DIAGNOSTICS.md** — when "what are the options" can't be answered because the problem itself is unclear, DIAGNOSTICS reveals it.
- **UI-DESIGN-GUIDE.md** — ideation for user-facing decisions (design, copy, interaction).
