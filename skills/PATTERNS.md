# CODE DESIGN & ARCHITECTURE PATTERNS
## Reference for Claude Code — How to Think About Code in Any Codebase

This document defines the design thinking that governs how we build. It is not a
style guide — it is a set of reasoning patterns. Each section teaches a way of
evaluating tradeoffs so you can make the right call in situations this document
does not explicitly cover.

Read this before writing or modifying any code, config, or script.
These are not suggestions — they are the expected defaults.

---

## 0. THE CORE PRINCIPLE

> Optimize for the human reader, not the machine reader.

The primary consumer of this code is a human who needs to:
- Quickly understand what a file does
- Audit whether it is correct
- Trust it without running it

An LLM can update ten files atomically. A human cannot read ten files simultaneously.
Every structural decision should make the human's job easier, even if it creates
more files or apparent repetition.

---

## 1. PROPORTIONALITY — MATCH PATTERN WEIGHT TO PROBLEM SIZE

Not every pattern should be applied at full weight everywhere. Before applying
any rule in this document, ask: **does the permanence and complexity of this code
justify the rigor?**

Scale up rigor when:
- The code is a shared module imported by many consumers
- The code governs a core domain model (schema, types, auth)
- The code will be debugged under time pressure during an incident
- The code will outlive the person who wrote it

Scale down rigor when:
- The code is a one-off script, migration, or throwaway tool
- The code has exactly one consumer and lives next to it
- Adding structure would create indirection that slows comprehension

| Situation | Rigor level |
|-----------|-------------|
| One-off migration script | Inline comments, no abstraction needed |
| Single-use utility function | Simple, direct, no extraction |
| Shared business logic used in 3+ places | Extract, name clearly, document |
| Core domain model (schema, types) | Strict: single source, fully typed, documented |
| Config file read by humans | Explicit over implicit, comment non-obvious values |
| Interactive dev script | Readable menu, clear prompts, forgiving input |

**The test:** would a competent developer unfamiliar with this codebase understand
this code in under 60 seconds? If yes, it is sufficiently clear. If no, it needs
either simplification or better comments.

Every section below inherits this principle. When a section says "apply strictly"
or "apply loosely," it is calibrating against this scale.

---

## 2. SINGLE RESPONSIBILITY — ONE JOB PER FILE

Every file should have one clearly stated job. If you cannot describe a file's
purpose in a single short sentence, it is doing too much.

**Apply strictly when:**
- The file is a script, handler, processor, or worker
- The file will be read during debugging or incident response
- The file will be audited for correctness by a human

**Apply loosely when:**
- The file is a type definition barrel (re-exporting is fine to co-locate)
- The file is a test that naturally covers multiple scenarios of one unit
- Splitting would create two files that cannot be understood independently

### Examples

```
# Good — each file has one job, name describes it completely
scripts/containers/
  services.conf          # declares what services exist (data only)
  start-menu.sh          # interactive start menu
  stop-menu.sh           # interactive stop menu
  restart-menu.sh        # interactive restart menu
  log-menu.sh            # interactive log viewer
  clean-menu.sh          # interactive wipe menu

# Bad — one file doing five jobs
scripts/containers/
  manage.sh              # start? stop? restart? which part do I read?
```

```
# Good — one handler per domain concern
src/routers/
  workspace.ts           # workspace CRUD procedures
  member.ts              # member management procedures
  billing.ts             # billing procedures

# Bad — grouped by operation type instead of domain
src/routers/
  queries.ts             # all queries from all domains
  mutations.ts           # all mutations from all domains
```

---

## 3. SHARED DATA SOURCES — CENTRALIZE FACTS, NOT LOGIC

When the same *data* (not logic) appears in multiple files, extract it to a single
source of truth. Leave the logic in each file that uses it.

This is the key distinction:
- **Data duplication** = bad (one change should propagate everywhere automatically)
- **Logic duplication** = acceptable (each file owns its behavior explicitly)

Extracting shared logic creates coupling. Now two modules change together and break
together. Duplicated logic in two files that each own their behavior is often more
maintainable than a shared helper that neither fully owns.

### The cascade pattern

```
config/
  services.conf          # single source: what services exist, their names
  |  sourced by
  start-menu.sh          # uses SERVICES and CONTAINERS, owns start logic
  stop-menu.sh           # uses SERVICES and CONTAINERS, owns stop logic
  restart-menu.sh        # uses SERVICES and CONTAINERS, owns restart logic
```

```bash
# services.conf — data only, no logic, no functions
# This file answers: "what services does this project manage?"

declare -A SERVICES=(
  ["api"]="api"
  ["worker"]="financial-worker"
  ["postgres"]="postgres"
  ["redis"]="redis"
)

declare -A CONTAINERS=(
  ["api"]="myapp-api-dev"
  ["worker"]="myapp-financial-worker-dev"
  ["postgres"]="myapp-postgres-dev"
  ["redis"]="myapp-redis-dev"
)

COMPOSE_FILE="docker-compose.dev.yml"
```

```bash
# start-menu.sh — sources the data, owns the start logic
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/services.conf"

# ... start logic using $SERVICES and $CONTAINERS ...
```

The same pattern in TypeScript:

```typescript
// src/db/schema/index.ts — data: table definitions
export * from './user'
export * from './workspace'
export * from './member'

// src/routers/workspace.ts — logic: uses table definitions
import { workspaces } from '../db/schema'
// owns its own query logic — does not share query functions with other routers
```

---

## 4. NAMING — THE NAME IS THE FIRST LINE OF DOCUMENTATION

A file or function name should make its purpose obvious without opening it.
The goal is not to follow a format — it is to eliminate the need for the reader
to open the file to understand its role.

### Decision framework

Ask: "If someone sees this name in a directory listing or import statement, do
they know what it does without clicking into it?"

- If yes: the name is good regardless of format.
- If no: rename it, even if the current name follows a convention.

### File naming

**Apply strictly when:**
- Files live in a flat directory with siblings (the name is the only differentiator)
- Files are entry points that users invoke directly

**Apply loosely when:**
- Files live in a deeply nested path that already provides context
  (`src/billing/stripe/webhook-handler.ts` — the path does most of the naming)

```bash
# Bad — ambiguous
run.sh
manage.sh
utils.sh

# Good — unambiguous
start-menu.sh
restart-containers.sh
seed-database.sh

# Also good — lifecycle hooks are a known convention, not noun-action
on-deploy.sh
pre-commit.sh
```

### Symbol naming

- Function names are verbs: `createWorkspace`, `queueInviteEmail`, `validateSession`
- Boolean variables start with `is`, `has`, `can`, `should`
- Constants are SCREAMING_SNAKE_CASE

```typescript
// Bad — name doesn't say what it does
const handler = async (ctx) => { ... }

// Good — name is the documentation
const createWorkspace = protectedProcedure
  .input(CreateWorkspaceSchema)
  .mutation(async ({ ctx, input }) => { ... })
```

```typescript
// Constants — comment the unit, context, or derivation
const MAX_POOL_CONNECTIONS = 20    // (CPU cores x 2) + I/O slots. 3 replicas x 20 = 60 < PG default (100)
const SESSION_TTL_MS = 86_400_000  // 24 hours
const COMPACTION_THRESHOLD = 15000 // tokens — triggers context reload when session drops below this
```

### When names get too long

If a descriptive name becomes unwieldy (`validate-workspace-member-invitation-limit.ts`),
the problem is not the naming convention — the file is doing too much, or it lives
in the wrong directory. Move it deeper (`workspace/validate-invite-limit.ts`) so the
path carries context the name doesn't need to repeat.

---

## 5. COMMENTS — WHY, NOT WHAT

Code describes what happens. Comments explain why it happens.

**Always comment:**
- Non-obvious decisions ("why this value?", "why this order?")
- Security-relevant behaviour
- Known limitations or gotchas
- Magic numbers, timeouts, thresholds
- Constraints imposed by external systems ("Stripe requires X before Y")

**Never comment:**
- What the next line obviously does
- Type information already in the signature
- Temporary state ("TODO: fix later" with no context)

```typescript
// Bad — restates the code
// Set pool max to 20
const pool = new Pool({ max: 20 })

// Good — explains the reasoning
// max: (CPU cores x 2) + I/O slots. For a 2-core container = 10.
// Three API replicas x 10 = 30 total connections, within Postgres default (100).
const pool = new Pool({ max: 20 })
```

```bash
# Bad — obvious
echo "Starting containers..."

# Good — explains context
# Build before up so image cache is warm — avoids a cold-start timeout
# on the health check (postgres takes ~8s on first volume init)
docker compose build && docker compose up -d
```

```typescript
// Good — explains a constraint that is not obvious from the code
// argon2id only: argon2i is vulnerable to side-channel attacks,
// argon2d is vulnerable to GPU attacks. id is the hybrid OWASP recommends.
const hash = await argon2.hash(password, { type: argon2.argon2id })
```

---

## 6. FUNCTION EXTRACTION — REDUCE COGNITIVE LOAD, NOT LINE COUNT

The goal of extracting a function is not to make the parent shorter. It is to
give a block of logic a name that saves the reader from reading the implementation.

**Extract when:**
- The block has a clear name that communicates intent better than the code itself
- The reader benefits from *not* seeing the implementation inline
- The block is reused (even twice justifies extraction)
- The block handles a concern the parent should not know about (e.g., auth check)

**Do not extract when:**
- The function body is a simple linear flow that reads top-to-bottom
- The extraction would force the reader to jump to another file to understand the parent
- The only benefit is a shorter function — length is a symptom, not the disease
- The "helper" would have one caller and a name that just restates the code

### Examples

```typescript
// This 15-line function is fine — it reads linearly and every line matters
export const inviteMember = protectedProcedure
  .input(InviteSchema)
  .mutation(async ({ ctx, input }) => {
    const workspace = await ctx.db.query.workspaces.findFirst({
      where: eq(workspaces.id, input.workspaceId),
    })
    if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' })
    if (workspace.ownerId !== ctx.session.user.id) throw new TRPCError({ code: 'FORBIDDEN' })

    const memberCount = await ctx.db.select({ count: count() }).from(members)
      .where(eq(members.workspaceId, workspace.id))
    if (memberCount[0].count >= workspace.plan.memberLimit)
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Member limit reached' })

    const [invite] = await ctx.db.insert(invites).values({ ... }).returning()
    await emailQueue.add('send-invite', { inviteId: invite.id })
    return { success: true, inviteId: invite.id }
  })
```

```typescript
// But if the auth/validation block is complex or reused, extraction helps
export const inviteMember = protectedProcedure
  .input(InviteSchema)
  .mutation(async ({ ctx, input }) => {
    const workspace = await assertWorkspaceOwner(ctx, input.workspaceId)
    await assertUnderMemberLimit(ctx, workspace)
    const invite = await createInviteRecord(ctx, input)
    await queueInviteEmail(invite, ctx.session.user)
    return { success: true, inviteId: invite.id }
  })
// Good here because: assertWorkspaceOwner is reused across 6 endpoints,
// and "assert" tells the reader it throws — no need to read the implementation.
```

**The test:** after extraction, can the reader understand the parent function
*without* reading the extracted function? If the name communicates enough, extract.
If the reader will immediately jump to the definition, the extraction added a hop
without reducing cognitive load.

---

## 7. CONFIGURATION FILES — SIGNAL OVER NOISE

Config files should make non-obvious choices visible and let obvious defaults
remain implicit. The reader should be able to scan a config and immediately spot
the decisions that matter.

**Be explicit about:**
- Values that affect behavior in non-obvious ways
- Values that differ from common expectations
- Values that were chosen deliberately (especially security, performance, timeouts)
- Healthchecks, restart policies, resource limits

**Let defaults stand when:**
- The default matches universal expectations and adding it creates clutter
- The config framework documents defaults well and developers know them
- Listing the default obscures the 3 lines that actually matter among 30

```yaml
# Bad — relies on knowing Docker defaults for important behavior
services:
  postgres:
    image: postgres:16-alpine

# Good — states intent where it matters
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s  # first init takes longer due to volume setup
```

```typescript
// Bad — 30 explicit options, only 3 matter
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,       // this is default with bundler resolution
    "skipLibCheck": true,           // this is default
    "forceConsistentCasingInFileNames": true, // this is default under strict
    // ... 20 more lines of defaults
  }
}

// Good — only the decisions that matter are visible
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,    // arr[0] is T | undefined, not T
    "exactOptionalPropertyTypes": true,  // optional props cannot be set to undefined
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

---

## 8. ERROR HANDLING — CATCH AT BOUNDARIES, PROPAGATE EVERYWHERE ELSE

Errors should be handled at system boundaries and propagated through internal code.
The goal is to have exactly one place that decides what to do about each category
of failure.

### Where to catch

| Boundary | Responsibility |
|----------|---------------|
| Route handler / API endpoint | Translate to HTTP status + user-facing message |
| Queue worker / job processor | Log, retry or dead-letter, emit monitoring event |
| CLI script entry point | Print actionable message, set exit code |
| External service call (fetch, SDK) | Wrap with context, re-throw or return result type |

### Where NOT to catch

- Inside business logic functions — let errors propagate to the boundary
- Inside utility/helper functions — the caller knows the context, the helper doesn't
- "Just in case" catches that swallow errors and return null or a default value

```typescript
// Bad — catches internally, caller has no idea something failed
async function getUser(id: string): Promise<User | null> {
  try {
    return await db.query.users.findFirst({ where: eq(users.id, id) })
  } catch {
    return null  // was it not found, or did the database crash?
  }
}

// Good — let the boundary handle it
async function getUser(id: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) })
  // throws on DB error (boundary catches), returns undefined on not-found
}
```

### Error messages — actionable, not descriptive

Every error message should tell the reader what to do, not just what went wrong.

```typescript
// Bad — describes the problem, offers no path forward
throw new Error('Missing environment variable')

// Good — tells the reader exactly what to fix
throw new Error(
  'DATABASE_URL is not set. Add it to .env (see .env.example for the format).'
)
```

```bash
# Bad
echo "Error: failed"

# Good
echo "ERROR: postgres container not healthy after 30s."
echo "  Check logs: make logs-postgres"
echo "  Common cause: port 5433 already in use (lsof -i :5433)"
```

---

## 9. SCHEMA AND TYPES — SINGLE SOURCE, INFERRED EVERYWHERE

Define a shape once. Derive all representations from it. Never hand-write a type,
interface, or validation schema that restates something already defined elsewhere.

### Identify the source of truth

Before writing types, ask: **where does this shape originate?**

| Origin | Source of truth | Derive from |
|--------|----------------|-------------|
| Your database | Schema definition (Drizzle, Prisma, init.sql) | Infer TS types from schema |
| External API you consume | Their OpenAPI spec or SDK types | Import, don't redefine |
| Your own API contract | Your Zod/validation schema | Infer types from validators |
| Shared config | The config file itself | Parse and validate at startup |

### When to decouple from the source

Not everything should be a direct inference. Decouple when:
- The external shape includes 40 fields and your code uses 3 (pick/omit a subset)
- The internal model should remain stable even if the external API changes
- The database schema contains implementation details (audit columns, soft-delete flags)
  that domain logic should not see

```typescript
// Source of truth: database schema
export const workspaces = pgTable('workspaces', {
  id:   uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  plan: planEnum('plan').default('free').notNull(),
})

// Infer — never hand-write these
export type Workspace    = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert

// Validation schema for user input — also the source of truth for its shape
export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
})
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>
```

```typescript
// Decoupled — API response shape is intentionally different from DB row
// Why: DB row has internal fields (dedup_hash, search_vector) the client should never see
type LeadResponse = Pick<Lead, 'id' | 'business_name' | 'city' | 'state' | 'lead_score' | 'status'>
```

---

## 10. DEPENDENCY DIRECTION — FLOW DOWNWARD, NEVER SIDEWAYS

Code should form a directed acyclic graph. Dependencies flow from specific
(routes, handlers, scripts) down to general (utilities, config, types). Peers
at the same level should never import from each other.

### The layer rule

```
Routes / Handlers / Entry Points    (specific — depends on everything below)
        |
  Business Logic / Services         (domain — depends on data + utilities)
        |
  Data Access / Schema              (data — depends on config + utilities)
        |
  Config / Constants / Types        (general — depends on nothing)
```

- A route can import from business logic, data access, and config. Fine.
- A business logic module importing from another business logic module: **warning.**
  If two domain modules depend on each other, they are one module or one needs extraction.
- A utility importing from a route: **never.** The dependency is upside down.

### In practice

```
# Good — clear direction
src/routes/leads.ts       → imports from src/helpers/leads.ts, src/db/schema.ts
src/helpers/leads.ts      → imports from src/db/schema.ts, src/lib/events.ts
src/lib/events.ts         → imports from src/config/db.ts
src/config/db.ts          → imports nothing from src/

# Bad — circular dependency hiding behind the file system
src/routes/leads.ts       → imports from src/routes/monitoring.ts
src/routes/monitoring.ts  → imports from src/routes/leads.ts
# Fix: extract the shared concern into a lower layer
```

**Apply strictly when:**
- The project has more than ~10 source files
- Multiple people or agents work on different modules

**Apply loosely when:**
- It is a single-file script or a project with 3 files total
- Test files (tests can import from anywhere — they are consumers, not dependencies)

---

## 11. TESTING PHILOSOPHY — VERIFY BEHAVIOR, NOT IMPLEMENTATION

The core principle: tests should verify what the code does for its consumers,
not how it does it internally. A test that breaks when you refactor internals
(without changing behavior) costs more than it saves.

**The refactor test**: after writing a test, ask: "If I rewrote the implementation
completely but kept the same inputs and outputs, would this test still pass?"
If no, the test is coupled to implementation details.

**What not to test**: private helper functions (test through the public consumer),
mock call assertions (that's testing wiring), framework behavior (the framework works).

For the complete testing methodology — three-layer testing (API → UI → DB),
systemic discovery through mental models, security testing as a discipline,
and how testing reveals architectural gaps — see **TESTING-GUIDE.md**.

---

## 12. RESOLVING PRINCIPLE CONFLICTS

When two principles in this document point in opposite directions, that tension
is not ambiguity — it is a **diagnostic signal**. The conflict is telling you
something about the structure of the problem that neither principle alone would
surface. The resolution is rarely "pick one." It is almost always "the conflict
reveals a boundary drawn in the wrong place."

### Reading the signal

Every conflict follows the same pattern: you are trying to apply two principles
to a structure that does not cleanly support either. The fix is to change the
structure, not to weaken a principle.

| Conflict | What it signals | Resolution |
|----------|----------------|------------|
| **Single responsibility vs dependency direction** — splitting a file creates a lateral import between peers | The two halves are actually one concern, or there is a shared concept that belongs in a lower layer | Extract the shared concept downward. If nothing can be extracted, the file is one unit — don't split it |
| **Function extraction vs cognitive load** — naming a block would help, but the reader must now jump to another file | The extracted function is at the wrong abstraction level — it is either too granular (restates the code) or too distant (lives in the wrong file) | Co-locate. Extract to a named function *in the same file*. If it is reused across files, it belongs in a shared layer, not a peer |
| **Explicit config vs signal-to-noise** — an important setting drowns among 20 defaults | The config has no visual hierarchy | Group by importance: non-obvious decisions at the top with comments, standard settings below. Or split into `config.defaults.ts` and `config.overrides.ts` |
| **Type inference vs decoupling** — inferring from the DB schema couples the API response to internal structure | This is a real boundary between two systems | Define the external contract separately. The internal schema is one source of truth, the API contract is another. A mapping layer between them is the correct cost |
| **Data centralization vs locality** — sharing a config file forces distant modules to depend on each other | The data is at the wrong granularity — it bundles things that don't change together | Split the shared data by change frequency. Services that always change together share a config. Services that change independently own their own data |
| **Single responsibility vs proportionality** — splitting a 60-line script into 3 files feels like overhead for a one-off tool | The code is temporary and has one consumer | Proportionality wins. Keep it in one file with clear section comments. The test: will anyone other than the author ever read this? If no, optimize for writing speed |
| **Testing behavior vs testing integration** — testing the observable behavior requires standing up a database, but a unit test with mocks would be faster | The code has a genuine boundary between logic and I/O | Separate the pure logic from the I/O. Unit test the logic, integration test the I/O boundary. If they cannot be separated, the function is doing too much |

### The resolution cascade

When the table above doesn't cover your specific case, apply these tiebreakers in
order. Stop at the first one that gives a clear answer:

**1. Reversibility** — Which option is easier to undo?
   Splitting a file later is easy. Untangling a premature abstraction is hard.
   Duplicating logic is easy to collapse later. A shared helper that six modules
   depend on is hard to remove. **Default to the reversible option.**

**2. Blast radius** — Which option affects fewer other files when it changes?
   If option A means editing 1 file and option B means editing 4 files, option A
   wins even if it is less "pure." The goal is to contain the impact of future
   changes, not to satisfy a principle in isolation.

**3. The next change test** — Imagine the single most likely next change to this
   code. Which option makes that change a 1-file edit instead of a 3-file edit?
   Design for the change that is actually coming, not for a hypothetical
   abstraction that might never be needed.

**4. Locality** — When still tied after the above: keep things closer together.
   The cost of a hop (jumping to another file, another layer, another abstraction)
   is almost always higher than the cost of a slightly longer file or a small
   amount of duplication. Co-location is the default. Distance requires justification.

### Worked example

> You are building a relay server. The `/run-agent` route handler does: validate input,
> look up a session, check token counts, spawn a CLI process, parse output, store
> messages, and emit monitoring events. It is 120 lines.
>
> **Single responsibility** says: split into smaller pieces.
> **Cognitive load** says: a developer debugging a failed request wants to read one
> file top-to-bottom without jumping around.
>
> **Read the signal:** The conflict tells you the handler has a clear linear flow
> (good) but multiple concerns tangled in sequence (bad). The answer is not "split
> into 6 files" or "leave as 120 lines."
>
> **Resolution:** Extract the concerns that have independent names and are reused
> (`findPocketSessionUUID`, `getSessionTokenCount`, `buildTranscriptContext`)
> into a helpers layer. Leave the orchestration — the sequence of steps — in the
> handler. The handler reads like a recipe: "look up session, check tokens, spawn
> claude, store messages." Each step has a name. The handler is 40 lines. The helpers
> are individually testable. No lateral imports. No jumping between peer files.
>
> **Which tiebreaker resolved it?** Next change test. The most likely change is
> adding a new step to the request lifecycle (e.g., a new monitoring event).
> That change should be a 1-line addition to the handler, not a multi-file refactor.

### When to stop resolving and ask

If after applying the resolution cascade you still have two options that feel
equally weighted, you have found a **genuine design decision** — not a pattern
application problem. These are rare, and they are exactly the moments where
ideation with your partner matters more than unilateral action.

Signals that you are at a genuine design decision, not a resolvable conflict:
- The "next change test" gives different answers depending on which future you
  predict, and both futures are equally likely
- The blast radius is identical for both options
- The reversibility cost is high in both directions (e.g., choosing between two
  database schemas, neither of which migrates cleanly to the other)

At this point, present both options with the tradeoffs articulated. The right
answer depends on context that lives outside this document — business priorities,
timeline, who else will touch this code, and what is already in motion.

---

## 13. WHEN WRITING FOR ANY CODEBASE — THE DECISION TREE

These are the defaults. Use this as a rapid decision framework, not a checklist.

### Before creating a file
1. Can I describe its job in one sentence? If not, I am about to create a multi-job file.
   Split first, then write.
2. Does this data or logic already exist somewhere? If the data exists, import it.
   If similar logic exists, check whether extracting shared logic creates helpful
   abstraction or harmful coupling. Default to duplication over wrong abstraction.

### Before writing a function
3. Will the reader understand the parent better if this block has a name?
   If the name communicates more than the code, extract. If not, leave it inline.
4. Am I catching an error here or should it propagate to the boundary?
   Internal code propagates. Boundaries catch and translate.

### Before writing a type or schema
5. Where does this shape originate? Write the definition at the origin.
   Derive everything downstream. Never hand-write what can be inferred.

### Before adding config
6. Would a reader unfamiliar with this tool be surprised by this setting?
   If yes, make it explicit and comment why. If no, let the default stand.

### Before committing
7. Does every file I touched still have one clear job?
8. Would someone debugging this at 2am understand what each file does from its name?
9. Are my error messages telling the reader what to do, not just what went wrong?
10. Is the rigor level proportional to how permanent and shared this code is?

### When two principles conflict
11. Read the signal — the conflict is diagnostic, not ambiguous. What structural
    issue is it revealing?
12. Check the resolution table (Section 12) for the specific conflict pair.
13. If not in the table, apply the cascade: reversibility → blast radius →
    next change test → locality.
14. If still tied: this is a genuine design decision. Present both options with
    tradeoffs. Do not pick one silently.

---

## THE UNDERLYING MENTAL MODEL

All of the above patterns share a single reasoning framework:

**1. Who is the reader?** A human under time pressure — possibly you, months from now,
   having forgotten the context.

**2. What do they need?** To understand one thing at a time, verify it is correct,
   and move to the next thing. Not to hold a mental model of the whole system.

**3. What helps them?** Files with one job. Names that eliminate guesswork.
   Comments that explain decisions. Errors that say what to do. Types that cannot
   drift from their source. Dependencies that flow in one direction.

**4. What hurts them?** Files that do multiple things. Abstractions that require
   reading the implementation. Shared logic that couples unrelated modules.
   Errors that describe symptoms. Types that are manually kept in sync.

**5. What do I do when the answer isn't clear?** Recognize the conflict as
   a signal. Check reversibility, blast radius, and the next likely change.
   Default to the option that keeps things local and easy to undo. If genuinely
   tied, surface the tradeoff — the cost of a short conversation is always lower
   than the cost of the wrong structural decision baked into the codebase.

Every decision in this codebase should move toward (3) and away from (4).
When principles conflict, the resolution cascade (Section 12) resolves them.
When the cascade itself is inconclusive, that is the signal to ideate, not to guess.
