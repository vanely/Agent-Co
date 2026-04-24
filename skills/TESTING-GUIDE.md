# TESTING-GUIDE.md

> Testing is not verification. Testing is the only time you get a bird's eye view
> of your entire system — every entity relationship, every state transition, every
> boundary assumption — and systematically ask: "what breaks when I push here?"

When you build, you think in features. When you test, you think in systems. A
feature is "users can create proposals." A system is "when a catalog price changes,
which proposals are now stale, who needs to know, and does the notification reach
them across tenant boundaries, auth tiers, and lifecycle states?" Testing is where
you discover whether your features compose into a system that actually holds together.

This guide is the sixth member of the skill document family. It sits alongside
PATTERNS.md (reasoning), FRONTEND-GUIDE.md (client), BACKEND-GUIDE.md (server),
INFRA.md (infrastructure), and UI-DESIGN-GUIDE.md (design). Where those guides
help you build correctly, this one helps you discover what you missed — and
understand why you missed it.

Everything here comes from real testing. 610 tests across a multi-tenant SaaS
platform. 11 bugs found, 2 security vulnerabilities caught, 1 major architectural
decision surfaced. The bugs were the easy part. The real value was the map of the
system that testing forced us to draw.

---

## 1. The Three-Layer Methodology

Each layer reveals a different dimension of the system. The gaps between these
three views are where every bug lives.

**Layer 1 — API**: Direct HTTP requests. No browser. Proves the backend contract:
input shapes, status codes, auth boundaries, ownership checks, serialization.

**Layer 2 — UI**: Playwright drives the browser as a real user. Proves the frontend
correctly drives the backend: forms submit, modals close, redirects land, state
persists across page reloads.

**Layer 3 — DB**: After each UI action, query the database. Closes the loop:
user clicked → API processed → data persisted. Catches wrong column types, missing
audit records, tenant IDs not propagated, cascade side effects not firing.

**Execution order**: Layer 1 first (prove the API). Then Layer 2 + 3 together
(prove the UI drives the API and data lands in the DB). If Layer 1 fails, the bug
is in the backend — don't waste time debugging the frontend.

---

## 2. Test Architecture Decisions

**One serial block per file.** Multiple `describe.serial` blocks don't share
state predictably. `afterAll` can destroy data between blocks. One block per file.

**Unique data, no cleanup.** `uniqueEmail()` with timestamps. Never hardcode.
Never clean up in `afterAll` — unique IDs prevent collisions.

**Cookie jar for API tests.** Node's `fetch` doesn't persist cookies. Build a jar
that stores `Set-Cookie` headers and replays them. Simulates a browser session.

**Origin header.** Node's `fetch` doesn't send `Origin`. Auth services reject it.
Set `Origin` explicitly in every API test helper.

---

## 3. Testing as Systemic Discovery

Testing at the feature level asks "does this work?" Testing at the system level
asks "what did this break, what did this expose, and what does this assume that
might not be true tomorrow?"

### The starting point: systematic trace

Before anything creative, start mechanical. Pick any mutation in the system and
walk through this:

1. List every table it writes to (direct)
2. For each table, list every other entity that reads from it
3. For each reader, ask: "is the reader now looking at stale data?"
4. For each stale reader, ask: "what lifecycle state is the reader in?" — only some states care
5. For each affected reader, ask: "who needs to know?" — that's your notification
6. For each notification, ask: "can that person even see this?" — that's your tenant isolation check

This procedure is mechanical and exhaustive. It will find every cascade, every
stale-data risk, every notification gap for the mutation you're examining. Run it
on your five most important mutations and you'll have the skeleton of your test
suite.

But the procedure only finds problems shaped like "mutation → stale reader." It
won't find the security vulnerability where a join query skipped an ownership
check. It won't find the temporal bug where a session caches a field that changes
later. It won't find the composition bug where two features interact through
shared mutable state in ways neither anticipated.

That's where the procedure becomes a launching point for deeper thinking. The
following five mental models are what you reach for when the mechanical trace
runs out — when you need to see problems the procedure can't generate.

### Mental Model 1: The Ripple

The procedure above traces direct read/write relationships. The Ripple model goes
further — it asks you to feel the weight of a change propagating through layers
of indirection until it reaches surfaces you didn't design it to reach.

**How to think with it**: pick any write operation. Don't trace tables — trace
*consequences*. What does a user see differently? What does a notification say?
What does an external client (the portal) now display? What does a scheduled
worker now compute? The ripple isn't about database rows — it's about every
downstream experience that changes.

A price change on a catalog item is a pebble. The ripple: price_history gets an
entry. Zone equipment references this item — those zones belong to projects —
those projects may have draft proposals — those proposals now have stale pricing.
But finalized proposals have snapshots — the ripple doesn't reach them. The ripple
also hits shared_infrastructure through a separate path. Missing either path means
silent stale data — the most dangerous class of bug, because nobody knows it's wrong.

**The creative extension**: this model works for any system. In e-commerce: a
product price change ripples to active carts, wishlists, saved-for-later,
subscription renewals, affiliate commission calculations. In healthcare: a patient
allergy update ripples to active prescriptions, pending lab orders, scheduled
procedures. The ripple model generates your test cases by asking "what's downstream?"

### Mental Model 2: The Negative Space

The most dangerous bugs are things that DON'T happen. The notification that doesn't
fire. The guard that doesn't block. The cascade that doesn't trigger. The field
that doesn't appear in the response.

**How to think with it**: for every feature, define what should NOT happen as
explicitly as what should. "Price change creates notification for draft proposals"
is the positive test. "Price change does NOT create notification for finalized
proposals" is the negative test. The negative test is more important — it proves
the system has boundaries, not just behavior.

This is how we found the `design.byProject` vulnerability. The positive test
("Tenant A sees their equipment") passed. The negative test ("Tenant B does NOT
see Tenant A's equipment") failed. We weren't testing a feature — we were testing
the absence of a leak.

**The creative extension**: in any system, list every action and then ask "who
should NOT be able to do this?" and "what should NOT change when this happens?"
Those questions generate tests that no happy-path-first approach would ever produce.

### Mental Model 3: The Time Machine

Your system has temporal assumptions everywhere. Data that was true when entity A
was created may not be true when entity B reads it. Sessions cache state from
sign-up time. Snapshots freeze prices at finalization time. Expiry dates set at
send time are checked at acceptance time.

**How to think with it**: for any piece of data, ask "when was this written?" and
"when is this read?" If there's a gap, ask "what could have changed in that gap?"

Session fields are written at sign-up and read on every request — anything that
changes after sign-up is stale. We found this twice: tenantId went stale after
tenant creation, role went stale after becoming owner. The time gap between
"session written" and "field changed" was invisible until we tested it.

**The creative extension**: anywhere you see caching, derived data, or snapshots,
ask "what happens if the source changes after the cache was written?" This applies
to CDN caches, materialized views, denormalized fields, JWT claims, localStorage —
any time data is copied from its source.

### Mental Model 4: The State Machine

Every entity with a status field is a state machine. The interesting bugs live at
the transitions, not in the states. What's allowed in state A but forbidden in
state B? What happens at the exact moment of transition? What if two transitions
try to happen simultaneously?

**How to think with it**: draw the state diagram. For each state, list every
operation that's valid. For each transition, list the preconditions and side effects.
Then test every cell: "operation X in state Y." The bugs are always in the cells
you assumed were blocked but never tested.

A proposal has 7 states. "Extend expiry" is valid in sent/viewed/expired but not
draft/finalized/accepted/voided. We found the finalized-not-sent edge case by
testing every cell — not by guessing which ones would fail.

**The creative extension**: even entities without explicit status fields have
implicit states. An order that hasn't been paid yet is in a different state than
one that has. A user who hasn't verified their email is in a different state.
Look for the implicit state machines and test their transitions.

### Mental Model 5: The Composition

Features work in isolation during development. They fail when composed. The catalog
works. The proposal works. But "change a catalog price while a proposal referencing
that item is in draft" — that's a composition question that neither feature
anticipated individually.

**How to think with it**: take any two features and ask "what happens when they
interact?" Pricing × versioning: does the new version recompute from current
prices or copy the old snapshot? Notifications × expiry: does an expiry warning
notification fire if the proposal has already been revised? Discontinuation ×
shared infrastructure: if a discontinued item is in both zone equipment and shared
infrastructure, does the notification deduplicate?

**The creative extension**: the number of feature compositions grows quadratically.
You can't test all of them. Prioritize by asking: "which compositions involve
shared mutable state?" A user's role and their tenant membership are shared state.
A catalog item's price and a proposal's draft status are shared state. Those
compositions are where the bugs live.

### Applying the models

These five models — ripple, negative space, time machine, state machine,
composition — are not a checklist. They're lenses. When you sit down to test a
subsystem, look through each lens for 30 seconds. The ripple lens will show you
cascading effects. The negative space lens will show you missing guards. The time
machine will show you staleness risks. The state machine will show you unguarded
transitions. The composition lens will show you cross-feature interactions.

The tests that come from this process aren't tests anyone could have written from
a spec. They're tests that only emerge when you see the system as an organism
instead of a collection of features.

---

## 4. Security Testing as a Discipline

The two vulnerabilities we caught weren't in auth middleware — they were in
business logic. A join query that forgot to check project ownership. An admin
middleware that trusted a stale session field. Security bugs don't announce
themselves. They hide in the code that "works fine" because nobody tested it
from the attacker's perspective.

### Think like the attacker, not the developer

The developer asks: "can the user do what they need to?" The attacker asks: "what
else can I do that nobody intended?" Every endpoint has an intended use and an
unintended surface. Testing the intended use is functional testing. Testing the
unintended surface is security testing.

**The shift**: when you look at an endpoint, don't think about the happy path
user. Think about the user who has a valid session for Tenant B but is manually
crafting requests with Tenant A's entity IDs. Think about the user who intercepts
a portal link and modifies the proposal ID. Think about the user who reads the
JavaScript bundle and finds internal route structures.

This isn't paranoia — it's the only way to find the class of bug that functional
testing will never surface.

### Every response is an information channel

An API response doesn't just return data — it communicates information to whoever
receives it. The question is: how much information does each response type reveal?

```
404 Not Found     — "I won't even tell you if this exists"
403 Forbidden     — "it exists, but you can't have it"
500 + stack trace — "here's my internal file structure"
200 + partial data — "here's the data with some fields hidden"
200 + full data    — "here's everything"
```

Each level reveals more. For cross-tenant access, 404 is the only acceptable
answer — 403 confirms the resource exists in another tenant, which is itself a
leak. For public endpoints, 500 with a stack trace reveals your framework,
file paths, and dependency versions.

**How to test this**: for every endpoint, call it as the wrong person and inspect
not just the status code but the response body. Does the error message contain
SQL fragments? Internal field names? File paths? Each of those is information
the caller shouldn't have.

### The boundary audit

Security is about boundaries. Every system has them:

- **Auth boundary**: authenticated vs anonymous
- **Tenant boundary**: Org A vs Org B
- **Role boundary**: admin vs regular user
- **Lifecycle boundary**: draft (mutable) vs finalized (locked)
- **Public boundary**: internal app vs public portal

For each boundary, ask: **"What is supposed to stay on each side, and how do
I prove it does?"**

The auth boundary matrix is one tool:

```
                   | No session | No tenant | Technician | Admin | Public
───────────────────┼────────────┼───────────┼────────────┼───────┼────────
client.list        |    401     |    403    |     ✓      |   ✓   |   —
admin.getMarkup    |    401     |    403    |    403     |   ✓   |   —
portal.getPublic   |     —      |     —     |     —      |   —   |   ✓
```

But the matrix only covers the auth boundary. The tenant boundary needs its own
audit: for every entity type, verify Tenant B gets 404 (not 403) on Tenant A's
resources. The lifecycle boundary needs its own: verify that finalized proposals
can't be re-finalized, accepted proposals can't be revised, expired proposals
can't be accepted.

### Data projection: test what ISN'T there

The most insidious security bug is returning a field you shouldn't. The endpoint
"works" — it returns data. But it returns `costPrice` alongside `sellPrice`, or
`internalNotes` alongside `executiveSummary`.

```typescript
const str = JSON.stringify(response)
expect(str).not.toContain('internalNotes')
expect(str).not.toContain('costPrice')
expect(str).not.toContain('priceSnapshot')
```

This test fails the moment a developer adds a sensitive field and forgets to
exclude it from the public projection. It's a safety net that catches the bug
before it reaches production.

**The deeper principle**: for any public or cross-boundary endpoint, define the
negative — the list of things that must never appear. Then test for their absence.
This is the negative space model applied to security.

### Ownership at the root, not the leaf

When a query traverses relationships (A → B → C → D), the security check must
happen at the root, not the leaf. If the root entity doesn't belong to the
tenant, nothing downstream should be accessible.

```typescript
// Verify ownership at the root, then query children
await verifyProjectOwnership(db, projectId, tenantId)
const equipment = await db.select().from(zoneEquipment)...
```

We missed this in one router. The zone router had the check; the design router,
written later, didn't. The join conditions looked like they'd filter correctly —
but they don't when the parent table isn't in the WHERE clause. The test caught
it; the code review missed it.

**The lesson**: don't trust implicit filtering through joins. Make ownership
verification explicit and mandatory. Write it first, before the business logic.

### Cross-tenant mutations fail silently

When Tenant B tries to modify Tenant A's notification:
`UPDATE ... WHERE tenant_id = B AND id = A's_notif_id` matches zero rows. No
error, no side effect, no information leaked. The attacker learns nothing — not
even whether the ID exists.

### Stale context is a security bug

Auth providers cache user fields at sign-up. Any field that changes later
(tenantId, role, permissions) becomes a security risk: the session says
"technician" but the database says "owner." Middleware that trusts the session
will reject a legitimate admin.

The fix is architectural: read mutable fields from DB on every request. But the
test is what enforces it: after every mutation that changes a user field, call
an endpoint that depends on it. If it fails, the context is stale.

### Public endpoints are a different threat model

Public endpoints don't have session context. They can't use `ctx.tenantId`. If
they need to create side effects (notifications), they must derive the tenant
from the entity being accessed — and that derivation itself needs testing.

They also need graceful failure: `{ success: false }`, not 500. And real-time
boundary checks: don't trust a status field that a worker updates hourly when
the acceptance is happening right now.

---

## 5. Data Integrity Patterns

**Empty string → null at the boundary.** Frontend forms send `""` for unfilled
number fields. Postgres rejects `""` for `numeric` columns. The API must coerce
at the boundary: `input.costPrice || null`. This is where the error handling
pattern says to catch — at the system boundary, before invalid data propagates
deeper into the stack.

**Soft delete vs hard delete.** The question is: "does anything reference this
entity after removal?" If a client is referenced by old proposals, deleting the
row breaks referential integrity and erases audit history — soft delete with
`deletedAt`. If a zone equipment selection is just the current design configuration,
and the meaningful record is captured in the proposal snapshot — hard delete. The
meaningful snapshot is the boundary between ephemeral state and permanent record.

**Discontinuation ≠ deletion.** Three distinct states for a catalog item: active
(normal), discontinued (visible but can't be added to new designs), deleted (hidden
from everything). Discontinuation is a business state — "this product exists but
we no longer sell it." Deletion is a data state — "hide this from the user." They
require different visibility rules: the equipment picker excludes discontinued,
the catalog management page shows them.

**Immutable snapshots lock selectively.** When a proposal is finalized, prices and
labor rates are frozen into JSONB snapshots. Subsequent catalog changes don't
affect the locked proposal. But narratives — the executive summary, scope
descriptions, terms — remain editable. The salesperson needs to adjust the story
even after the numbers are final. The principle: separate what's mutable from
what's immutable based on who needs to change it and when, not a blanket lock.

---

## 6. Status Lifecycle Patterns

**One-way transitions with guards.** Status changes are conditional (`if sent →
viewed`). Side effects (increment count, append log) happen every time. The
transition triggers once.

**Cascade to parent.** Proposal accepted → project accepted. Same mutation. The
project status tracks the lifecycle phase.

**Terminal state guards.** Accepted proposals can't be revised, extended, or
re-accepted. Guard explicitly.

**Expiry: check at the boundary.** Portal checks `expiresAt < now` before
acceptance — even if the status hasn't been updated to 'expired' by the worker.

**Revive pattern.** Extend an expired proposal → revives to 'sent'. Explicit
rollback with guards: only sent/viewed/expired can be extended.

---

## 7. Notification & Cascade Patterns

**Inline triggers, for now.** Start synchronous. Move to async (BullMQ) when
latency matters. For < 100/day, inline is fine.

**Graph traversal.** Price change → which proposals affected? Check both paths:
`item → zone_equipment → zone → project → proposal` AND
`item → shared_infrastructure → project → proposal`. Missing a path = silent stale data.

**First-occurrence guard.** Only notify on first view (status === 'sent'). Don't
spam on repeated events.

**Lifecycle-aware.** Cascades only fire for draft proposals. Finalized have locked
snapshots. Accepted are done.

**Two categories.** Cascade (action required) vs Activity (awareness). UI
distinguishes with badges.

---

## 8. Versioning & Supersession

**Void + create.** Revise voids v1, creates v2 as draft. Narratives copy; price
snapshots don't. Old versions preserved for audit.

**Redirect superseded.** Voided proposal in portal → `{ redirect: true, latestProposalId }`.
Don't 404 — the URL might be bookmarked.

**Pipeline excludes voided.** Aggregation views show current state. Stats computed
from non-voided only.

---

## 9. Edge Cases Worth Testing Every Time

These categories surfaced real bugs. Test them in every project:

1. **Empty state**: zero data → empty array (API), empty state component (UI)
2. **Unicode round-trip**: Japanese, accented chars, emoji → stored and returned
3. **SQL injection**: `'; DROP TABLE x; --` in search → no crash, table intact
4. **Concurrent writes**: 5 simultaneous creates → unique IDs, no corruption
5. **Bulk operations**: 100+ items → completes without timeout
6. **Auth boundaries**: every tier tested with the wrong caller
7. **Cross-tenant access**: every entity type → 404, not 403
8. **Stale session fields**: mutate user field → immediately test dependent endpoint

---

## 10. The Testing Mindset

### You are mapping the system, not checking boxes

A test for `catalog.update` traces the blast radius across six subsystems: price
history, draft proposals, notifications, badge count, finalized immunity. If you
finish a test section without understanding the system better, you tested the
wrong things.

### Follow the surprise

When a test fails, ask: "instance or pattern?" The stale session role bug was the
second occurrence of stale-session. The first should have triggered an audit of
every session-derived field. Testing caught the second because it systematically
tested what the first fix should have audited.

### Check the API logs first

UI test "not working"? The form submitted fine. The API returned 500 because empty
strings hit Postgres. The browser is the last place to look.

### Document the gap

The sidebar linked to `/notifications` but the route didn't exist. That's not a
bug — it's a design artifact. Document it. It tells the next developer exactly
what's missing and why.

### Verify the math

BOM total isn't just "is it a number." Verify: extended = qty × sell. Subtotals =
sum of extended. Tax = taxable × rate%. A function returning 42 would pass
`typeof === 'number'`.

### The test suite is the most honest documentation

610 tests is a complete specification of system behavior in executable assertions.
`§12.4 — Price change → NO cascade (proposal accepted)` teaches a business rule
not written anywhere else. Tests can't lie — they run.

---

## 11. Proportionality — What NOT to Test

**Test seams, not surfaces.** A function adding two numbers needs no test. A
function assembling data from 4 tables, applying a tax rate, and writing to a
fifth — that does. Complexity is in connections.

**Don't test the framework.** React renders. Postgres stores. Test YOUR logic
on top of them.

**One test per decision.** Three `if` branches → three tests. Not ten tests
exercising the happy path with slightly different inputs.

**80/20 on boundaries.** API endpoints, auth middleware, tenant isolation, public
endpoints, lifecycle transitions get 80% of effort. Internal logic gets 20% — only
when complex enough to get wrong.

---

## 12. How This Guide Connects to the Others

**PATTERNS.md**: The error boundary pattern (catch at boundaries, propagate
internally) maps to where we test. The conflict resolution cascade (blast radius
first) maps to which tests we write first.

**BACKEND-GUIDE.md**: The four-tier auth model becomes the auth boundary matrix.
Graceful shutdown connects to how public endpoints fail without crashing.

**FRONTEND-GUIDE.md**: Prototype-first means UI exists before tests. Tests verify
the spec, not drive it.

**UI-DESIGN-GUIDE.md**: The stranger test applies to test names. `§12.4 — Price
change → NO cascade (proposal accepted)` passes. `test_case_47` doesn't.

---

## Appendix: Bug Catalog

| # | Bug | Layer | Category |
|---|-----|-------|----------|
| 1 | `zone_assessments.completed_by_id` uuid→text | L3 | Auth ID type |
| 2 | `price_history.changed_by` uuid→text | L1 | Auth ID type |
| 3 | `labor_rates.created_by` uuid→text | L1 | Auth ID type |
| 4 | `labor_overrides.created_by` uuid→text | L1 | Auth ID type |
| 5 | `proposals.created_by_id` uuid→text | L1 | Auth ID type |
| 6 | `cascade_notifications.acknowledged_by` uuid→text | L1 | Auth ID type |
| 7 | Empty string prices → Postgres crash | L2 | Boundary validation |
| 8 | `design.byProject` missing tenant check | L1 | Security |
| 9 | Admin middleware stale session role | L1 | Stale session |
| 10 | Better Auth endpoint `get-session` not `session` | L1 | Third-party API |
| 11 | Better Auth requires `Origin` from Node fetch | L1 | Third-party API |
