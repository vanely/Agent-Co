---
name: Conflict resolution cascade
description: When two principles conflict, resolve in order — reversibility → blast radius → next change → locality.
type: feedback
---

When two principles or two good options conflict, resolve in this order:

1. **Reversibility** — prefer the option that's easier to undo. A deploy that can be rolled back beats a schema migration that can't.
2. **Blast radius** — prefer the option whose failure affects fewer systems / users.
3. **Next change** — prefer the option that makes the *next likely change* easier, not the current one.
4. **Locality** — prefer keeping related changes in one place over spreading them.
5. Still tied? Generate a third option (most ties mean you haven't ideated widely enough).

**Why this order:** reversibility dominates because a mistake you can undo is cheap; a mistake you can't is expensive. Blast radius is the next cheapest insurance. Next-change optimization beats current-change optimization because code outlives the moment it was written.

**Anti-pattern:** reaching for "purity" criteria (consistency, symmetry, elegance) before reversibility. Beautiful designs that can't be rolled back fail harder.

See `skills/THINKING.md §3` for the full procedural version.
