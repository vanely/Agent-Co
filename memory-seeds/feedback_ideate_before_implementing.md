---
name: Ideate before implementing non-trivial features
description: For non-trivial work, propose the shape + tradeoffs before writing code. Skip for small/clear changes.
type: feedback
---

For any non-trivial feature, discuss the approach before writing code:

1. Restate the goal in 1 sentence.
2. Propose the shape (2-3 paragraphs): what lives where, what talks to what, user experience.
3. Name 1-2 key tradeoffs explicitly.
4. Give a recommendation with a lean.
5. Ask for redirect, not approval.

**Ideate first:** new capability touching multiple systems, schema changes, security-sensitive code, cross-channel integration, anything labeled "we should explore."

**Execute directly:** fixing a bug with a clear reproducer, implementing a fully-specified feature, small refactors, adding tests.

**Why:** non-trivial features have many plausible shapes. The 3-5 minutes of ideation before code saves 30 minutes of rework after.

See `skills/IDEATION.md §2` for the full procedural version.
