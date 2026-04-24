---
name: Memory and skills are separated kinds of persisted knowledge
description: Memory holds declarative facts (what is true); skills hold procedural workflows (how to do). Mixing them creates the "re-read as directives" problem.
type: feedback
---

Two different surfaces persist knowledge across sessions. They must not mix.

- **Memory = declarative facts.** "I prefer concise summaries." "The LLC filing fee is $520." Auto-loaded every session via `MEMORY.md` index.
- **Skills = procedural workflows.** "How to build a prototype before React." "How to run three-layer testing." Lazy-loaded via `SKILLS-INDEX.md` XML manifest; bodies pulled only when a skill matches.

**Rule of thumb:** knowledge *about* something → memory. Knowledge of *how to do* something → skill.

**Why:** mixing causes the "re-read as directives" problem — facts dropped into a skill body get interpreted as instructions in future sessions.

**How to apply at write time:**
- Fact, preference, reference, project status → memory entry (pick the right type prefix).
- Step-by-step process → skill doc under `skills/` with YAML frontmatter.
- If the knowledge feels like both: decompose. Fact in memory, procedure in a skill that references the fact.

**How to apply at read time:** use the surface that matches. Don't pull a skill to answer "what's my budget?" (that's memory). Don't grep memory for "how do I run tests?" (that's the testing skill).
