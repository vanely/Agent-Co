---
name: BUILDING
description: How to build once the thinking answer is clear — reinvent-vs-compose decision, integration shape evaluation, extraction criteria, error-boundary placement, file-first processing, graceful shutdown. Procedural methodology for translating design into shipped code.
---

# BUILDING — Methodologies for Shipping the Right Shape

Thinking tells you *what* to build. Building is *how to build it* — the decisions about composition, boundaries, lifecycle, and integration that separate code that ships-and-lasts from code that ships-and-rots.

Read this when: you know what you're building but multiple implementation shapes are plausible; when you're adding a new capability and want to choose build vs. compose; when extracting or consolidating existing code; when crossing a system boundary (process, service, container).

---

## 0. THE CORE STANCE

> Most hard problems of building have been partially solved by other teams. The job is rarely to reinvent — it's to compose existing pieces with taste into the specific shape your problem needs.

Every section below is a decision framework for one layer of building: what to reuse, where to cut abstractions, where to catch errors, how to separate concerns across process boundaries. Together they keep the build from accumulating debt that later sessions have to pay down.

---

## 1. REINVENT vs. COMPOSE — THE FIRST DECISION

Before writing any non-trivial capability, ask: *does an existing tool solve most of this, and if so, what's the composition cost?*

**Method:**
1. State the capability in one sentence. ("Drive a browser from an LLM." "Persist agent skills with validation.")
2. Survey existing tools: 15 minutes of search. Look at GitHub, Anthropic's ecosystem, HN, adjacent open-source projects.
3. For each candidate, evaluate:
   - **Fit** — does it solve ≥70% of the problem as-is?
   - **Surface area** — how much of its complexity does using it impose on the rest of the system?
   - **License + governance** — is it safely composable? (Permissive license, active maintainer, contributable.)
   - **Composition cost** — how much glue code to integrate?
4. Compare to reinvent cost: estimate hours to build the 70%, add the 30% gap you'd need to fill, add the ongoing maintenance.
5. **Default: compose.** Only reinvent when (a) nothing exists, (b) everything that exists has fundamentally wrong architecture for your shape, or (c) the surface you need is narrow enough that composition overhead exceeds reinvention.

**Examples:**
- **browser-harness:** 600 LOC Python harness that gives full CDP control. Composition: `uv tool install -e .`, register in SKILLS-INDEX, write overlay. Cost: ~2 hours. Reinvent cost: weeks. **Compose.**
- **Hermes's skill-manage:** not a library; we extracted the *pattern* and built our own `/skill-manage` endpoint because we needed it server-side integrated with our existing relay + Postgres. **Reinvent (but borrow the pattern).**
- **Claude Code hooks:** exposed via settings.json + scripts. Compose rather than fork CC.

**Anti-pattern:** not-invented-here. Also: composing when the tool's architecture fundamentally mismatches (e.g., using a Flask-shaped library inside a FastAPI app — the glue consumes the benefit).

---

## 2. INTEGRATION SHAPE — HOST, LIBRARY, OR SERVICE?

Once you've decided to compose, the next question is *how* it integrates with the rest of the system. Three shapes:

- **Host integration** — the tool runs in-process. You import it as a library, share its memory, fast but coupled.
- **Library wrapper** — same process, but wrapped in an adapter so the tool's interface is isolated from callers.
- **Service integration** — separate process/container. Communicates via HTTP/IPC/stdio. Slower, independently deployable, resilient to the tool's failures.

**Decision criteria:**

| Dimension | Host | Library | Service |
|---|---|---|---|
| Perf | Fast | Fast | Slower (IPC) |
| Isolation | None | Interface-level | Process-level |
| Failure domain | Shared | Shared | Isolated |
| Deploy coupling | Tight | Tight | Independent |
| Language coupling | Same | Same | Any |

**Method:**
1. If the tool is language-matched and stable, start with **host**.
2. If the tool is stable but you want to swap it later, wrap with **library adapter**.
3. If the tool is language-different, unstable, or safety-critical (you don't want its crash to take down your process), use **service**.

**Example:**
- **MCP server**: service integration (stdio subprocess). CC talks to it over MCP protocol. Lets us swap relay backends without touching CC config.
- **browser-harness**: service integration (subprocess spawned per invocation with stdin Python). Each invocation is a fresh CDP connection, so no long-running daemon to crash-isolate against.
- **relayFetch helper inside MCP**: library (in-process function). Stable, simple.

**Anti-pattern:** defaulting to service for everything ("microservices!"). The IPC overhead + ops burden often exceed the isolation benefit when the tool is stable.

---

## 3. EXTRACTION CRITERIA — WHEN TO TURN REPETITION INTO A FUNCTION

Repeated code is only sometimes a problem. The real signal for extraction is *when a name would communicate more than the code itself*.

**Method:**
1. Look at the duplicated block. Can you name what it does in 3 words? (`fetchRelayJson`, `validateFrontmatter`, `chunkForDiscord`.)
2. Does the name carry meaning the code can't? ("chunkForDiscord" conveys *intent* — "this belongs to the Discord flow" — that `slice(0, 2000)` does not.)
3. Does the extracted function have one clear purpose, or are you bundling unrelated things to avoid repetition?
4. If all three are yes: extract.

**When NOT to extract:**
- The repetition is shallow (3 similar lines that will diverge as the system grows).
- The "shared" logic has different invariants in each location (coincidental structure, not shared meaning).
- Extraction would require passing so many parameters that the call site is harder to read than the duplication.

**Length is a symptom, not the disease.** A 200-line function that does one coherent thing doesn't need splitting. A 20-line function that does three things does.

**Example:**
- `relayFetch()` in the MCP server: extracted because "auth + fetch + JSON-or-text body" is one concept used 5 times.
- `chunkMessage()` in system.ts: same chunker used by discord-send and telegram-send. Extracted because Discord's 2000-char and Telegram's 4096-char limits both need the same algorithm with different constants.
- Hook CWD guard: *not* extracted between cc-persist-hook.py and cc-session-start-hook.py, even though it's identical. They're small enough that the duplication is clearer than a shared import path between two disparate hook scripts.

**Anti-pattern:** DRY as dogma. Extracting because "it repeats" without asking whether the repetition shares meaning.

---

## 4. ERROR BOUNDARIES — CATCH AT SYSTEM EDGES, PROPAGATE ELSEWHERE

Errors are structural. Where you catch them determines how the system degrades under failure. The rule: catch at system boundaries (where the error leaves your control), propagate everywhere else (don't swallow mid-flow).

**Method:**
1. Identify the system boundaries: HTTP entry, background job worker, CLI tool, cron invocation, hook entry.
2. At each boundary, catch errors and translate them to the boundary's protocol (HTTP 5xx, log + exit, notify + fail the job).
3. Inside the system, let errors propagate. Don't wrap every call in try/except to "be safe" — that hides failure and masks bugs.
4. When propagation would lose context needed for the eventual catch, add context at the mid-layer (e.g., wrap-and-rethrow with "failed while processing contribution ${id}").

**Error categories and where they belong:**

| Category | Layer | Shape |
|---|---|---|
| User input invalid | Entry validation | 400, clear message, no log spam |
| Expected failure (e.g., not found) | Any | Typed result, not exception |
| Transient (network, db contention) | Retry at boundary | Exponential backoff, give up after N |
| Bug (assertion, invariant violated) | Boundary catch | 500, log with full context, alert |
| Catastrophic (OOM, corruption) | Process exit | Log + exit; let supervisor restart |

**Example:**
- `cc-persist-hook.py`'s `main()`: catches at the outermost layer, always exits 0 (never blocks CC). Logs failures to `~/.claude/cc-persist-hook.log`. Internal helpers propagate freely.
- Relay endpoints: each route is a boundary. Errors translate to HTTP 4xx/5xx at the route handler. Internal helpers like `getPool()` just throw.
- MCP server tool calls: each tool call handler is a boundary. Returns `{isError: true, content: [...]}` instead of raising.

**Anti-pattern:** try/except everywhere. Makes the code look safe, actually destroys your ability to debug.

---

## 5. FILE-FIRST PROCESSING — PERSIST ARTIFACTS BEFORE ACTING ON THEM

When receiving anything that's expensive to reproduce (a message, an upload, a scraped page, a user-submitted payload), land it to durable storage *before* starting any processing. Separate the acknowledgment of receipt from the execution of work.

**Method:**
1. At the entry point, validate minimum shape (it parses, required fields exist).
2. Write the artifact to durable storage (disk, object store, database).
3. Return acknowledgment to the sender.
4. Kick off processing as a separate step — either async in the same process, via job queue, or via cron.
5. Processing reads from the stored artifact, so it can be retried, inspected, re-run.

**Why:** if processing crashes mid-work, you haven't lost the input. The sender already got acknowledged, so they don't retry. You inspect the stored artifact and debug at leisure.

**Example:**
- Discord/Telegram bots: receive message → persist to `memory.messages` → return ack → n8n workflow (or relay) picks up and routes. If the processing crashes, the message is still in the DB.
- The learning journal: captured text lands in `memory.learning_journal` rows at hook time. Consolidation is a separate step that reads from the journal. If consolidation is broken for a week, the journal keeps accumulating without loss.
- Skill contributions: `/skill-manage` writes to disk + DB audit in one transaction, *then* returns. If a downstream consumer crashes, the skill file and audit row are both safe.

**Anti-pattern:** process-then-acknowledge. If processing fails, the sender retries and you duplicate work, or you lose the input entirely.

---

## 6. GRACEFUL SHUTDOWN — DRAIN BEFORE EXIT

Long-running services (relay, bots, workers) must handle SIGTERM correctly: stop accepting new work, drain in-flight work, close resources (DB pools, HTTP keep-alives), then exit. Brutal termination corrupts state.

**Method:**
1. Register SIGTERM + SIGINT handlers at process start.
2. On signal: set a `shuttingDown` flag that makes new-work handlers refuse (return 503 or similar).
3. Wait for in-flight work to finish with a bounded timeout.
4. Close persistent connections explicitly (`pool.end()`, `client.destroy()`).
5. Exit 0 when drained, or exit 1 + log if timeout expired.

**Example (relay pattern):**
```typescript
let shuttingDown = false;
process.on('SIGTERM', async () => {
  shuttingDown = true;
  await new Promise(r => setTimeout(r, 500));  // let in-flight finish
  await pool.end();
  process.exit(0);
});

app.use((req, res, next) => {
  if (shuttingDown) return res.status(503).send('shutting down');
  next();
});
```

**When to skip:** one-shot scripts, CLI tools that don't hold state. They don't need draining; they just need to not corrupt whatever they were writing. Use `finally:` blocks or atomic writes instead.

**Anti-pattern:** ignoring SIGTERM in containerized services. Docker sends SIGTERM then SIGKILL after 10s by default. Services that don't handle it corrupt any in-flight transaction.

---

## 7. REQUEST TRACING — PROPAGATE IDs ACROSS BOUNDARIES

Once work crosses a boundary (HTTP call, queue message, subprocess spawn, hook invocation), logs from the two sides become correlated only if they share an ID. Bake it in from the start; retrofitting tracing is brutal.

**Method:**
1. At the outermost entry point, generate a `traceId` (UUID). Attach to logs via structured context.
2. Pass the traceId through every boundary: as HTTP header (`x-trace-id`), as payload field (`traceId`), as env var to spawned subprocess.
3. At each boundary, extract the incoming traceId or generate a new one if none. Log both (parent + current) if generating new.
4. All logs within a given traceId are filterable as one request's journey.

**Example:**
- Relay `/run-agent` generates a traceId, logs it on every event, passes it into the spawned `claude` subprocess via payload.
- MCP server receives tool calls (no trace context from CC currently — future improvement), generates one per call.
- `/cc-health-check` generates a traceId for the research spawn, stores in `memory.cc_health_checks.research_traceId`, so the DB row can be joined against `memory.messages` rows with that trace later.

**When to skip:** truly one-shot scripts that don't cross any boundary and have < 10 lines of output. Adding traceIds is overhead without value.

**Anti-pattern:** ad-hoc tracing with different field names per service (`request_id`, `req_id`, `traceId`, `correlation_id`). Pick one name, use it everywhere.

---

## 8. TWO-MODE TOOLING — AUTOMATION + INTERACTIVE

System management tooling should exist in two complementary shapes: scripts / Makefiles for automation, and interactive menus / CLIs for humans. Neither replaces the other.

**Method:**
1. Build the automation layer first: scripts with flags (`--verify`, `--send`, `--since`). These are the truth.
2. Build the interactive layer on top: shell menu, TUI, CLI with prompts. Calls the automation layer.
3. When someone asks "how do I X?", point at the interactive layer. When a cron asks "how do I X?", point at the automation.

**Why:** automation gets called by cron/n8n/CI and must be stable, idempotent, non-interactive. Interactive wrappers let humans navigate without memorizing flags.

**Example:**
- `browser-harness-pin.sh`: automation (subcommands: status, check, pin, upgrade). Interactive use: just run it, read output.
- `cc-version-check.sh`: same shape.
- n8n's internal UI is the interactive layer for workflow management; `scripts/publish-workflows.ts` is the automation layer.

**Anti-pattern:** only interactive. Then cron can't call it without tty fakery. Only automation without docs: humans don't know what flags exist.

---

## 9. IDEMPOTENCY AT BOUNDARIES

Anything callable via network, cron, or user action should be idempotent: calling it twice with the same input should produce the same state as calling it once. This is load-bearing because networks retry, crons double-fire, users double-click.

**Method:**
1. At every boundary that mutates state, accept a client-supplied idempotency key OR derive one from the inputs.
2. Store (key → result) for a retention window. On repeat, return the stored result without re-running.
3. For pure inserts, use `ON CONFLICT DO NOTHING` or unique constraints.
4. For updates, consider whether the update is already idempotent (SET X = Y is, SET X = X + 1 is not).

**Example:**
- `/persist-cli-turn`: I didn't add idempotency on first pass. If Stop hook fires twice (retries, or CC quirk), the turn lands twice. Known gap; would add `ON CONFLICT (traceId, role)` or a content hash.
- `/skill-manage`: atomic write via tempfile + rename. Second call with same content is a no-op at the filesystem level, though it still logs a new audit row. Acceptable because the file state is the source of truth.
- browser-harness-pin.sh: `pin` rewrites the lockfile unconditionally. Safe because the lockfile is self-contained.

**Anti-pattern:** assuming "it'll only be called once." Cron drift, network retries, and user double-clicks all prove otherwise.

---

## 10. SCHEMA SYNC DISCIPLINE

Every DB migration must update `init.sql` in the same step as the live `docker exec` migration. Never defer.

**Why:** fresh rebuilds replay init.sql. If live-applied schema drifts from init.sql, a future `docker compose down -v` followed by `up` silently creates the old schema, and everything breaks in weird ways that surface days later.

**Method:**
1. Edit `init.sql` with the migration.
2. Apply the migration live: `docker exec agentco_postgres psql -U agentco -d agentco -f -` with the same statements.
3. Verify both: query the live DB for the new structure, confirm init.sql matches.

**Example:** the `memory.skill_contributions`, `memory.cc_health_checks`, and `memory.learning_journal` tables were all added this way. A fresh docker rebuild will produce the same schema the live system runs.

**Anti-pattern:** "I'll add it to init.sql later." Later doesn't come; the divergence bites.

---

## CONTRIBUTION SIGNALS

A learning belongs in BUILDING.md when the captured excerpt or turn shape matches:

- **Compose vs reinvent decisions** — I chose one path with a clear criterion that could generalize.
- **Integration-shape pivots** — I moved something from host to library to service (or vice versa) and it was the right call.
- **Extraction-or-keep moments** — I extracted (or explicitly did NOT extract) with reasoning worth preserving.
- **Error-boundary corrections** — a caught-too-late or swallowed-too-early error led to a placement rule.
- **File-first rescues** — a near-miss where only the persisted artifact saved the work.
- **SIGTERM incidents** — any graceful-shutdown learning from a real crash/corruption.
- **Traceability recoveries** — moments where a traceId (or its absence) was load-bearing for debugging.
- **Idempotency bugs** — a double-fire that caused real damage, and what fixed it.

**How to write a contribution:** lead with the structural shape (not the anecdote), show one concrete example, name the anti-pattern. See THINKING.md §Contribution Signals for the full style guide.

---

## RELATED SKILLS

- **THINKING.md** — decide what to build; BUILDING decides how.
- **PATTERNS.md** — code-level patterns (naming, proportionality, extraction depth). BUILDING is architectural; PATTERNS is line-level.
- **INFRA.md** — operational layer (Docker, secrets, Kamal). BUILDING chooses service vs library; INFRA handles the deploy of each.
- **DIAGNOSTICS.md** — when the build doesn't behave, DIAGNOSTICS isolates the failure.
