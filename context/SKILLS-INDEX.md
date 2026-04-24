# Skills Index — Lazy Discovery Reference

**Status:** live (OpenClaw XML format). Referenced from root `CLAUDE.md`.

---

## 1. The pattern

This file is a compact XML index of every skill available in this Agent Co install. The index enters the session context as a cheap manifest: just `<name>`, `<location>`, and `<description>` per skill. The full skill body is NOT loaded until a specific skill applies to a specific task — at which point, read the relevant SKILL.md directly.

This is the OpenClaw lazy-skill-discovery pattern, using OpenClaw's XML tag names (`<available_skills>`, `<skill>`, `<name>`, `<location>`, `<description>`) for interop and ecosystem legibility. It lets the library scale to 20+, 50+, 100+ skills without prompt-death.

Locations are relative to `$AGENT_CO_ROOT` (the install directory). The one exception is `browser-harness`, which is an external tool and resolves via its own installed path.

---

## 2. How to use this index

**When scanning the index:**
- Read descriptions, not bodies
- Note which skills might apply to the current task
- Do not try to work from descriptions alone — they are summaries, not the methodology

**When a skill clearly applies:**
- Read the canonical SKILL.md body via the Read tool using the path inside the skill's `<location>` tag
- Apply the methodology described there

**When in doubt whether a skill applies:**
- Err on the side of reading the full SKILL.md. The read cost is a few hundred tokens; the cost of shipping without the skill's patterns can be much higher.

**Invocation bar:** *"Before replying: scan `<available_skills>` entries. If exactly one skill clearly applies: read its SKILL.md and follow it. If multiple could apply: choose the most specific one. If none clearly apply: do not read any SKILL.md."*

---

## 3. The index

<available_skills>
  <skill>
    <name>thinking</name>
    <location>skills/THINKING.md</location>
    <description>Procedural methodologies for non-obvious problems: structural diagnostics (tensions as signals about missing layers), dependency direction, conflict resolution cascade (reversibility → blast radius → next change → locality), root-cause vs symptom via five-why ladder, data-lifecycle tracing, edge-case rigor, recursive self-questioning against the end goal. Load when a task is ambiguous, a fix isn't landing, or a design choice feels stuck. Foundation skill; BUILDING / IDEATION / DIAGNOSTICS compose on it.</description>
  </skill>
  <skill>
    <name>building</name>
    <location>skills/BUILDING.md</location>
    <description>Procedural methodology for shipping the right shape once thinking is clear: reinvent-vs-compose decision, integration shape evaluation (host vs library vs service), extraction criteria, error-boundary placement, file-first processing, graceful shutdown, request tracing, two-mode tooling, idempotency at boundaries, schema-sync discipline. Load when multiple implementation shapes are plausible, adding a new capability, extracting or consolidating, crossing a system boundary.</description>
  </skill>
  <skill>
    <name>ideation</name>
    <location>skills/IDEATION.md</location>
    <description>Procedural methodology for generating and selecting among options: creative problem-solving first, ideate-before-implementing, predict-before-flagging, ripple analysis post-change, autonomous direction, limitless-by-design stance, naming the main tradeoff up front, proportionality, second-order effects. Load when the problem is open-ended, stuck between plausible approaches, or direction-setting is half the work.</description>
  </skill>
  <skill>
    <name>diagnostics</name>
    <location>skills/DIAGNOSTICS.md</location>
    <description>Procedural methodology for investigation when the problem isn't yet understood: name the symptom precisely, reproduce before diagnosing, bisect the difference, follow control flow to silence, read traces backward, profile before optimizing, incident runbooks, trace IDs across system boundaries, postmortem-not-blamestorm. Load when a bug is silent, intermittent, or cross-system.</description>
  </skill>
  <skill>
    <name>patterns</name>
    <location>skills/PATTERNS.md</location>
    <description>Structural code-organization patterns: when to extract, dependency direction rules, error boundary placement, tool ownership lanes, cognitive-load-based refactoring. Load when making decisions about where code belongs or how to structure a new module.</description>
  </skill>
  <skill>
    <name>testing-guide</name>
    <location>skills/TESTING-GUIDE.md</location>
    <description>Three-layer testing methodology: integration-first, schema-boundary, full-UI-interaction. Load when writing tests or evaluating whether existing tests cover what matters.</description>
  </skill>
  <skill>
    <name>prototype-first</name>
    <location>skills/PROTOTYPE-FIRST.md</location>
    <description>Build the full UI as HTML/CSS/JS prototype before writing framework code. Load when starting greenfield frontend work, major redesigns, or complex multi-page flows. The prototype serves as design review, component spec, and translation blueprint.</description>
  </skill>
  <skill>
    <name>pure-css-components</name>
    <location>skills/PURE-CSS-COMPONENTS.md</location>
    <description>Internal component library pattern using TSX + CSS Modules, no external UI frameworks. Load when deciding component architecture or evaluating whether to adopt an external UI library.</description>
  </skill>
  <skill>
    <name>development-lifecycle</name>
    <location>skills/DEVELOPMENT-LIFECYCLE.md</location>
    <description>End-to-end development lifecycle patterns (planning, scaffolding, shipping, maintenance). Load when starting a new project, evaluating project health, or proposing a lifecycle-level refactor.</description>
  </skill>
  <skill>
    <name>ui-design-guide</name>
    <location>skills/UI-DESIGN-GUIDE.md</location>
    <description>Design thinking framework: the three questions, restraint, typography, accessibility, self-critique tests. Load before making visual-design decisions for tool/product frontends.</description>
  </skill>
  <skill>
    <name>browser-harness</name>
    <location>$HOME/Projects/browser-harness/SKILL.md</location>
    <description>Direct browser control via CDP (Chrome DevTools Protocol). Load when the task requires automating, scraping, testing, or interacting with web pages. Connects to the user's running Chrome. External tool; install via `uv tool install -e .` from a clone of https://github.com/browser-use/browser-harness. Invoke as `browser-harness &lt;&lt;'PY' ... PY` from Bash. One-time setup: chrome://inspect/#remote-debugging must be enabled on user's Chrome.</description>
  </skill>
</available_skills>

---

## 4. Adding your own skills

Put new skill files under `skills/` (or anywhere — just update the `<location>` tag).

Follow the existing shape:
- YAML frontmatter with `name` and `description`
- Body structured as numbered sections with procedural methodology
- A "Contribution signals" section at the end describes when the Learning Flywheel should propose updates to this skill

Write or patch skills via the `/skill-manage` endpoint (validation + atomic write + audit log) or directly via the filesystem. The relay's `POST /skill-manage` validator enforces size caps, frontmatter requirements, and a dangerous-pattern scan (no embedded credentials, no destructive shell commands).

---

## 5. What this index is NOT

- Not the skill library itself. The skills live at `skills/*.md` (or wherever `<location>` points).
- Not the source of truth for skill content. If this index disagrees with a canonical SKILL.md, the canonical wins and the index needs updating.
- Not the memory index. Memory files are at `~/.claude/projects/<slug>/memory/`. Skills and memories serve different purposes — skills are reusable procedural methodology, memories are accumulated declarative specifics.
