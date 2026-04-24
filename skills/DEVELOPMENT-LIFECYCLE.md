# DEVELOPMENT LIFECYCLE — The Orchestrator

> This is not a reference document. This is a mission protocol. When you read
> this, work begins. Each phase has its own task doc, its own skills, and its
> own definition of done. You move through them in order. Work continues across
> as many sessions as needed — each picks up from the last phase handoff. The
> commitment is to the process, not to a single sitting.

---

## How This Document Works

This is the only skill loaded at the start of a project. It orchestrates
everything else. The technical skill docs (PATTERNS.md, FRONTEND-GUIDE.md,
BACKEND-GUIDE.md, INFRA.md, UI-DESIGN-GUIDE.md, PROTOTYPE-FIRST.md,
PURE-CSS-COMPONENTS.md, TESTING-GUIDE.md) are loaded just-in-time when
a phase requires them. This prevents context pollution — you never carry
thousands of lines of irrelevant guidance while doing focused work.

**Skill docs location:** project `skills/` directory. All skill docs
live alongside the code they govern.

**What this doc replaces:** loading all skills at session start. Instead,
this single doc governs the entire lifecycle. Skills are pulled in only
when the current phase needs them.

---

## The REACT Loop — How to Think at Every Step

Every task in every phase is executed through this loop. It is not a
checklist — it is a thinking discipline that ensures reasoning happens
before action and observation happens after.

```
READ    → Read the next unchecked task from the phase's task doc
REASON  → Before acting, think:
            - Why does this task matter in the context of the system?
            - What could go wrong? What assumptions am I making?
            - What are the ripple effects if this succeeds?
            - What mental models apply? (ripple, negative space,
              time machine, state machine, composition)
DECOMPOSE → Break the task into subtasks using the built-in task system.
            Every task pulled from a task doc gets decomposed into
            trackable subtasks. This makes progress visible, prevents
            losing track of steps during execution, and creates a
            record of what was done within each task.
            - Create subtasks with clear subjects and descriptions
            - Set dependencies between subtasks where they exist
            - Mark each subtask in_progress → completed as you go
ACT     → Execute each subtask through the task system.
            - Delegate to sub-agents for independent parallel subtasks
            - One subtask at a time, full quality
OBSERVE → After the task's subtasks are complete, assess:
            - Did it work as expected? What was surprising?
            - What did I learn that the task doc didn't anticipate?
            - Does this learning apply beyond this task?
            - Capture learnings to memory immediately
MARK    → Check the task off in the phase's task doc. Move to next task.
```

**The task system is not optional.** Every task from the task doc gets
decomposed into subtasks tracked by the built-in task system. The task doc
is the macro plan (what needs to happen this phase). The task system is the
micro execution (how each item gets done, step by step, with progress
tracking). Skipping decomposition leads to tasks that "feel done" but have
gaps — the subtask checklist is what prevents that.

**REASON is where quality comes from.** A session that skips REASON and
jumps to ACT will produce code that works but doesn't hold together as a
system. The five minutes spent reasoning about ripple effects, auth
boundaries, and lifecycle states before writing a line of code prevents
the hours spent debugging cascading failures later.

**OBSERVE is where growth comes from.** Every task teaches something. A
session that marks a task done without observing what happened misses the
pattern that would prevent the next bug. Capture learnings to memory as
they happen — Phase 8 synthesizes, but raw capture is continuous.

---

## Context Management — The Backbone

Context retention is what allows the final product to come together as
high-quality, coherent work rather than a collection of disconnected features.
This operates at three scales:

### Scale 1: The Phase (managed by this doc)

Each phase loads specific skills and produces a specific task doc. When a
phase completes, its handoff summary captures what was done, what was
decided, and what was discovered. A new session reads the handoff to
resume without ramp-up.

### Scale 2: The Section (managed by the task doc)

Each phase's task doc is organized into sections. At the start of each
section, re-read the relevant portion of the loaded skill doc to keep
the principles fresh. Don't rely on what you remember from the phase
start — context degrades across many tasks. Re-inject it.

```
Section start → Re-read relevant skill doc section
  Task → REACT loop
  Task → REACT loop
  Task → REACT loop
Section complete → Next section → Re-read relevant section
```

### Scale 3: The Task (managed by the REACT loop)

Each task gets the full REASON → ACT → OBSERVE cycle. Never read ahead
in the task doc — the doc holds the plan so your active context stays
narrow and sharp.

### Re-Anchor Between Tasks

Before each new task:
1. Re-read the current section of the task doc (where am I, what's next)
2. Re-read the most recently changed files (what state is the code in)
3. If attention feels scattered, re-read this document

### Phase Handoff

When a phase completes, decorate its task doc with a completion summary:

```markdown
<!-- PHASE COMPLETE: YYYY-MM-DD
  Summary: [what was built/accomplished]
  Key decisions: [architectural choices made]
  Discoveries: [things found that affect future phases]
  Artifacts: [files created, routes added, tables migrated]
  Next phase: [which phase comes next]
-->
```

A new session reads this document, finds the current phase, reads its task
doc's handoff, and picks up exactly where work left off.

---

## The Universal Phase Rhythm

Every phase follows this rhythm:

```
1. Create the task doc → tasks/{phase-name}.md
   (Task docs are created when the phase BEGINS, never earlier.
   You can't plan a phase accurately until the previous phase is done.)
2. Validate the task doc (second pass)
   — What's missing? What edge cases? What dependencies between tasks?
   — This second pass is where the task doc becomes a plan, not a list.
3. Load the relevant skill doc(s) for this phase
   — Read the full doc at phase start
   — Re-read relevant sections at each task doc section boundary
4. Execute the REACT loop for each task
5. Capture learnings to memory continuously (not just at the end)
6. Write the phase completion summary
7. Move to the next phase
```

**The task doc IS the phase gate.** All boxes checked = phase done.

---

## The Re-Entry Assessment

Phases are sequential, but discoveries aren't. When a later phase surfaces
a problem from an earlier phase, assess the depth before acting.

### Three questions, in order:

**1. "What broke?"** — the symptom.

This gives you the immediate fix. If it's a code change that doesn't
require rethinking any design decisions, it's **Level 1 — fix within the
current phase.** Add it to the current task doc. Fix it. Move on.

**2. "Why did it break?"** — the cause.

Could this same cause produce bugs elsewhere? If yes, you're looking at a
missing *pattern*, not a missing line. This is **Level 2 — design gap.**
Load the relevant skill doc, understand the principle, fix all instances,
then return to the current phase. Log the fix AND the pattern in the task
doc. Capture the pattern to memory for Phase 8.

**3. "What does this tell us about the system?"** — the implication.

This isn't fixable within the current phase. It's a new body of work. This
is **Level 3 — architectural discovery.** Create `tasks/{discovery-name}.md`
documenting the problem and proposed approach. Continue the current phase.
Address the discovery in a future cycle.

### The depth-check principle

Most problems look like Level 1 on first glance. The assessment forces all
three questions every time — even when the first answer feels sufficient.
A missing WHERE clause (Level 1) might reveal a missing ownership pattern
across all routers (Level 2) which might reveal that your security model
makes assumptions about join filtering that aren't true (Level 3). The
problem reveals its true depth through the questions.

---

## Phase 1 — Research, Validation & Specification

**Goal:** Transform a product idea into a hardened technical specification
that can be built without ambiguity.

**Skills to load:** PATTERNS.md

**Task doc:** `tasks/01-research-spec.md` (created when Phase 1 begins)

### How this phase starts:

This phase is collaborative. The human brings domain knowledge — the
competitive landscape, the customer, the industry constraints, the vision.
The session brings structural analysis — architecture patterns, data
modeling, technical tradeoffs, edge case identification.

**Start by asking what the human already knows.** Don't web-search for
things the human can tell you directly. Ask about: the target user, the
competitive landscape, the core problem being solved, any existing work
or research, technical constraints, and non-negotiable requirements.

### What happens:

- Collaborative research — domain, competitors, user needs, constraints
- Functional specification — what the product does, for whom, why
- Technical specification — architecture, stack, data model, API surface,
  auth model, lifecycle states
- Harden both specs using PATTERNS.md reasoning — proportionality, single
  responsibility, dependency direction applied to the proposed architecture
- Define the entity relationship model and lifecycle states
- Identify seed data needs (reference data, templates, fixtures)

### Quality gate:

- [ ] Functional spec answers "what" and "why" for every feature
- [ ] Technical spec answers "how" with tradeoff reasoning
- [ ] Data model defined with relationships and lifecycle states
- [ ] Architecture decisions documented
- [ ] Seed data requirements identified

---

## Phase 2 — Task Planning & Context Structure

**Goal:** Create the context management foundation for the project — the
task doc structure, project directories, and anchor protocol.

**Skills to load:** (this document's context management section is sufficient)

**Task doc:** `tasks/02-task-planning.md` (created when Phase 2 begins)

### What happens:

- Create the master implementation checklist from the spec
- Set up the project directory structure
- Set up this orchestrator doc and context anchor in the project root
- Create ONLY the Phase 3 task doc (next phase). Future phase task docs
  are created when those phases begin — you can't plan Phase 7 accurately
  when you haven't built the system yet.

### Quality gate:

- [ ] Master checklist exists covering all spec items
- [ ] Project directory structure matches the spec
- [ ] Phase 3 task doc created and validated
- [ ] Context management files in project root

---

## Phase 3 — Frontend Prototype

> **Conditional phase.** Skip if the project has no UI (API-only, CLI, infra).

**Goal:** Build the complete UI as an HTML/CSS/JS prototype — every page,
every state, every interaction. No framework. Pure control.

**Skills to load:** UI-DESIGN-GUIDE.md, PROTOTYPE-FIRST.md

**Task doc:** `tasks/03-prototype.md` (created when Phase 3 begins)

### What happens:

- Build every page as standalone HTML with CSS and vanilla JS
- Implement every visual state: empty, loading, populated, error
- Implement responsive layouts (desktop, tablet, mobile)
- Define the design token system (CSS custom properties)
- Build the component inventory
- Annotate with `[REACT]`, `[API]`, `[STATE]` comments marking where
  framework code will connect

### Why prototype first:

The prototype IS the spec made visible. In raw HTML/CSS/JS, every decision
is exposed — no framework magic, no component library abstractions. You see
exactly what the user sees. The prototype becomes the source of truth for
routes (each HTML file = a route), components (each reusable pattern),
and API calls (each `[API]` annotation = a tRPC procedure).

New routes and interactions will emerge during prototype construction that
weren't in the original spec. This is expected — the prototype is a
continuously growing discovery process. Capture everything.

### Quality gate:

- [ ] Every page from the spec has a prototype file
- [ ] Every state represented (empty, loading, populated, error)
- [ ] Responsive at 390px, 768px, 1280px
- [ ] Design tokens defined in CSS variables
- [ ] Component inventory documented
- [ ] Annotations present for framework translation

---

## Phase 4 — Infrastructure & Containers

> **Conditional phase.** Adapt scope based on project type (Docker, serverless,
> static hosting, etc.).

**Goal:** Build the runtime environment. Everything needed to run the
application locally.

**Skills to load:** INFRA.md

**Task doc:** `tasks/04-infrastructure.md` (created when Phase 4 begins)

### What happens:

- Create `compose.yml` with service profiles
- Set up databases with schema migrations
- Set up caching/queue infrastructure (Redis, etc.)
- Create base Dockerfiles (multi-stage: dev + production)
- Configure health checks on all services
- Set up environment variable management
- Verify: full stack starts healthy

### Quality gate:

- [ ] `docker compose up` → all infrastructure services healthy
- [ ] Health endpoint returns ok
- [ ] Database migrations run cleanly
- [ ] Seed data loads without errors
- [ ] `.env.example` documents every required variable

---

## Phase 5 — Frontend & Backend Implementation

**Goal:** Translate the prototype and specification into production code.
Every route, every component, every API endpoint.

**Skills to load:** FRONTEND-GUIDE.md, BACKEND-GUIDE.md, PATTERNS.md,
PURE-CSS-COMPONENTS.md (if building internal component library)

**Task doc:** `tasks/05-implementation.md` (created when Phase 5 begins)

### What happens:

- Build the database schema (from the spec's data model)
- Build API endpoints for every procedure in the spec
- Build frontend routes and components, translating from the prototype
- Build the component library (internal CSS Modules, no external UI framework)
- Wire authentication and session management
- Seed reference data
- Connect frontend to backend

### The prototype is the source of truth:

Every HTML file → a route. Every reusable pattern → a component. Every
`[API]` annotation → an API procedure. Every `[STATE]` annotation → a
state management decision. The prototype told you what to build. This
phase is translation, not invention.

### Container creation:

Once frontend and backend are buildable, create their Docker containers
and add them to `compose.yml`. Verify both services start healthy inside
Docker with hot reload for development.

### Quality gate:

- [ ] Every route from the prototype exists in the application
- [ ] Every API procedure from the spec is implemented
- [ ] Auth flow works end-to-end
- [ ] Frontend and backend containers in compose.yml
- [ ] `docker compose --profile app up` → all services healthy
- [ ] Application navigable end-to-end in browser

---

## Phase 6 — Validation Pass

**Goal:** Systematically find every gap between the specification/prototype
and the running application.

**Skills to load:** (spec + prototype as reference — no new skill doc)

**Task doc:** `tasks/06-validation.md` (created when Phase 6 begins)

### What happens:

- Walk through every prototype page side-by-side with the running app
- Document every missing feature, incomplete interaction, or visual gap
- Walk through every API endpoint in the spec — implemented? Edge cases?
- Check: does every nav link resolve to an existing route?
- Check: are inline creation flows available where users would expect them?
- Create tasks for every gap and execute them

### How to verify route completeness:

Routes live in multiple sources — the spec lists them, the prototype HTML
files represent them, the `[REACT]` annotations reference them, and the
implementation creates them. Cross-reference all four sources. The gaps
are routes that exist in one source but not the implementation.

### Quality gate:

- [ ] Every prototype page compared against the running app
- [ ] Every API endpoint verified as implemented
- [ ] All gaps documented, tasked, and completed

---

## Phase 7 — Systematic Testing

**Goal:** Apply three-layer testing to every endpoint and user flow.
Discover edge cases, missing logic, security vulnerabilities, and
cascading effects across the entire system.

**Skills to load:** TESTING-GUIDE.md

**Task doc:** `tasks/07-testing.md` (the master smoke test — created when
Phase 7 begins)

### What happens:

**First: create the master smoke test document.** Map every API endpoint
and every UI flow into a test plan structured by the three-layer
methodology:
- Layer 1 (API): every happy path, sad path, auth boundary
- Layer 2 (UI): every user flow driven through the browser
- Layer 3 (DB): every mutation verified in the database

**Then: execute section by section.** For each section, create tasks,
write the tests, run them, fix what breaks, check off the section.

**Apply the REACT loop with the five mental models:**

- REASON with **The Ripple**: what cascades from this mutation?
- REASON with **The Negative Space**: what should NOT happen?
- REASON with **The Time Machine**: what goes stale between write and read?
- REASON with **The State Machine**: what's valid in each lifecycle state?
- REASON with **The Composition**: what breaks when features interact?

**Apply the re-entry assessment** when bugs surface. Most are Level 1.
Some are Level 2 (load a skill, fix the pattern). Occasionally Level 3
(document for future work).

**Capture learnings continuously** — every bug found, every pattern
discovered, every architectural insight goes to memory immediately.
Don't wait for Phase 8.

### Quality gate:

- [ ] Every API endpoint has Layer 1 tests (happy + sad)
- [ ] Every user flow has Layer 2 tests (browser-driven)
- [ ] Every mutation has Layer 3 verification (DB state)
- [ ] Tenant isolation verified across all entity types
- [ ] Auth boundaries verified at every tier
- [ ] Security testing applied (data projection, ownership, error leakage)
- [ ] All tests passing
- [ ] Testing findings captured to memory

---

## Phase 8 — Learning Capture & Skill Refinement

**Goal:** Synthesize everything learned into reusable knowledge. Update
the skill docs. Document the system for future maintainers.

**Skills to load:** (all docs as reference for updating)

**Task doc:** `tasks/08-learning-capture.md` (created when Phase 8 begins)

### What happens:

- Review all memory entries created during the project — extract patterns
  that apply beyond this specific system
- Update the relevant skill docs with new patterns discovered
- Document architectural decisions for future maintainers
- Create task docs for any Level 3 discoveries from Phase 7
- Write the project README with setup and run instructions
- Archive completed phase task docs

### Quality gate:

- [ ] Learnings synthesized into skill doc updates
- [ ] Skill docs updated where new patterns were discovered
- [ ] Level 3 discoveries have their own task docs
- [ ] README with setup instructions
- [ ] All phase task docs have completion summaries

---

## The Skill Map

| Phase | Skills loaded | Conditional? |
|-------|-------------|-------------|
| 1. Research & Spec | PATTERNS.md | No — always |
| 2. Task Planning | (this doc is sufficient) | No — always |
| 3. Prototype | UI-DESIGN-GUIDE.md, PROTOTYPE-FIRST.md | Yes — UI projects only |
| 4. Infrastructure | INFRA.md | Yes — adapt to project type |
| 5. Implementation | FRONTEND-GUIDE.md, BACKEND-GUIDE.md, PATTERNS.md, PURE-CSS-COMPONENTS.md | No — always (adapt skill set) |
| 6. Validation | (spec + prototype as reference) | No — always |
| 7. Testing | TESTING-GUIDE.md | No — always |
| 8. Learning | (all docs as reference) | No — always |

---

## Starting a Project

When you are told to read this document:

1. **Check for existing work.** Look for phase task docs in `tasks/`. If
   they exist, a previous session started this project. Read the most
   recent task doc's completion summary to find the current phase and
   pick up from there.

2. **If this is a new project, begin Phase 1 — collaboratively.** Don't
   start building. Start asking. The human has domain knowledge, competitive
   intelligence, and a vision. Your job is to draw it out, structure it,
   and stress-test it. Ask about: the target user, the problem being solved,
   the competitive landscape, existing research, technical constraints, and
   what success looks like.

3. **Load the skills for the current phase.** Read the full skill doc at
   phase start. Re-read relevant sections at each task doc section boundary.

4. **Execute the REACT loop** for every task. Reason before acting. Observe
   after acting. Capture learnings as they happen.

5. **Use agent delegation** for independent parallel work within a phase.
   Multiple sub-agents can build non-dependent components simultaneously.

6. **When a phase completes**, write the handoff summary and move to the
   next phase. Continue until Phase 8 is done.
