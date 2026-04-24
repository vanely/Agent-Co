# Contributing to Agent Co

Thanks for considering a contribution. Agent Co is small and actively-developed; contributions are welcome at every scale — from typos to new LLM providers to entirely new capability clusters.

## Ground rules

1. **Open an issue first for non-trivial changes.** Describe the shape + main tradeoff. Keeps both of us from rework.
2. **One concern per PR.** If you're fixing a bug and refactoring, split the PR.
3. **Tests where they exist.** Run `npm test` in `agent-company/relay/` before submitting. No new test framework without discussion.
4. **Type-check your TypeScript.** `npm run build` in `relay/` and `mcp-server/` should be clean.
5. **No em-dashes in public copy.** The project's `skills/PUBLIC-WRITING.md` (if present) governs any user-facing text; in internal code + docs, em-dashes are fine.
6. **Match existing style.** Look at neighboring files before writing new ones. Prefer editing over creating where possible.

## Branch / PR workflow

1. Fork + clone
2. Create a branch: `git checkout -b fix/short-description` or `feat/short-description`
3. Commit in small logical chunks
4. Open a PR with:
   - One-sentence summary of what changed
   - The main tradeoff (if any)
   - How you tested it
   - Screenshots for UI changes

## What we love to see

### New LLM providers

If you add a provider:

1. Implement `LLMProvider` interface in `agent-company/relay/src/providers/your-provider.ts`
2. Register in `providers/index.ts`
3. Add the env var to `agent-company/.env.example`
4. Update the README comparison table
5. Ensure `run()` honors `opts.timeoutSeconds` and handles errors cleanly

### New skill docs

The four meta-skills (THINKING, BUILDING, IDEATION, DIAGNOSTICS) are the current methodology stack. Additional skills that would fit well:

- Security / threat modeling
- Data modeling / schema design
- Distributed systems reasoning
- Product thinking / spec writing
- Code review methodology

Follow the format of existing skill docs: YAML frontmatter, numbered sections, each with triggering conditions + method + example + anti-pattern. End with a `CONTRIBUTION SIGNALS` section describing what patterns in future work should trigger updates to this doc.

### New tools (agentco CLI subcommands)

Adding a new tool:

1. Add the subcommand handler to `bin/agentco`
2. If it needs relay support, add endpoints under `agent-company/relay/src/routes/`
3. Document in README + the CLI's own help output
4. Reuse the `relay_call` helper for HTTP

### New n8n workflows

Workflows live as JSON exports in `agent-company/workflows/`. If yours would be generally useful:

1. Remove any credential references (use environment references instead)
2. Test on a fresh n8n instance
3. Add a brief README section describing when/why to enable

### Cross-platform fixes

macOS + Linux parity is a stated goal. If you find a Linux-only assumption (systemd-specific command, `/proc` read, etc.), patches to make it portable are high-value. Windows / WSL support is lower-priority but welcome.

## Security

- Never commit secrets. `.env` is gitignored.
- Don't add endpoints that accept raw SQL, shell commands, or arbitrary file paths without validation.
- The dangerous-pattern scanner in `/skill-manage` is a living list — if you find a credential shape or destructive command that slips through, add a pattern.
- Report security vulnerabilities privately via GitHub Security Advisories rather than a public issue.

## Code style

- TypeScript: match the existing style (interface-first, no classes unless justified, functional helpers over OOP)
- Python: stdlib only where possible. Keep hooks lean (they fire frequently).
- Shell: `set -euo pipefail` at the top. Use `"${var:-default}"` for defaults.
- Markdown: ATX headers (`# foo` not `foo\n===`). Lists with `-`, not `*`.

## What we won't accept

- Contributions that add hard-coded paths to a specific user's system
- PRs that introduce new top-level dependencies without discussion (weight grows fast)
- Changes to the Learning Flywheel's three-phase architecture without a detailed rationale — the separation is load-bearing
- Removal of the human-approval gate on skill contributions — this is a safety layer, not a friction point

## Questions

Open an issue with the label `question`. For architectural discussions, tag it `design-discussion`.

---

Thanks for building with us.
