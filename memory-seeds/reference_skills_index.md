---
name: Skills index
description: The lazy-discovery manifest for procedural methodologies. Bodies loaded on demand.
type: reference
---

**Location:** `$AGENT_CO_ROOT/context/SKILLS-INDEX.md`

**Contents:** XML `<available_skills>` manifest listing every registered skill with name, location, and description. Auto-loaded in the session context; bodies NOT loaded by default.

**Invocation:** when a task matches a skill, read its full body via Read tool. See the index file for the invocation bar ("if exactly one skill clearly applies…").

**Current skills shipped:**
- `thinking` — structural reasoning methodologies
- `building` — composition + integration
- `ideation` — option generation
- `diagnostics` — investigation
- `patterns` — code structural patterns
- `testing-guide` — three-layer testing
- `prototype-first` — build HTML/CSS before framework
- `pure-css-components` — internal component library
- `development-lifecycle` — planning/scaffolding/shipping
- `ui-design-guide` — design thinking
- `browser-harness` — external CDP tool (install separately)

**To extend:** drop a new `.md` in the `skills/` directory with YAML frontmatter (`name`, `description`), then add an `<skill>` entry to SKILLS-INDEX.md.
