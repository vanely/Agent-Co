import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getPool } from '../config/db';
import { extractError } from '../helpers/errors';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';

// Canonical skill library root. Fleet-wide skills live here; agent contributions
// land here. Resolution order:
//   1. SKILL_LIBRARY_ROOT env var (explicit override)
//   2. $AGENT_CO_ROOT/skills/ (relative to install)
//   3. $HOME/agent-co/skills/ (default install path)
const SKILL_LIBRARY_ROOT = process.env.SKILL_LIBRARY_ROOT
  ?? (process.env.AGENT_CO_ROOT ? join(process.env.AGENT_CO_ROOT, 'skills') : null)
  ?? join(homedir(), 'agent-co', 'skills');

// Size cap adapted from OpenClaw/Hermes defaults. Skills over this are almost
// certainly either accidentally including generated code, or crossing from
// "methodology" into "data dump."
const MAX_SKILL_BYTES = 256 * 1024;

// Patterns we refuse to accept in a skill body. Expanded over time — see
// memory/feedback_skill_manage_dangerous_patterns.md for the living list
// and the discipline behind extending it.
const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
  // Generic credential-shape assignments
  [/\b(API_KEY|APIKEY|SECRET_KEY|PRIVATE_KEY|ACCESS_TOKEN|BEARER_TOKEN|PASSWORD|PASSWD)\s*=\s*['"]?[A-Za-z0-9_\-]{16,}/i, 'looks like an embedded credential'],
  // Destructive shell
  [/\brm\s+-rf\s+\/(?!tmp|var\/tmp)/i, 'contains destructive rm -rf at filesystem root'],
  [/\bcurl[^|]*\|\s*(bash|sh|zsh|fish)\b/i, 'contains unreviewed curl-to-shell pipe'],
  [/\bwget[^|]*\|\s*(bash|sh|zsh|fish)\b/i, 'contains unreviewed wget-to-shell pipe'],
  // Private-key markers
  [/-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, 'contains embedded private key material'],
  [/-----BEGIN CERTIFICATE-----/, 'contains embedded X.509 certificate'],
  // Cloud provider keys
  [/AKIA[0-9A-Z]{16}/, 'looks like an AWS access key id'],
  [/aws_secret_access_key\s*=\s*['"]?[A-Za-z0-9/+=]{40}/i, 'looks like an AWS secret access key'],
  // Source-control tokens
  [/ghp_[A-Za-z0-9]{36}/, 'looks like a GitHub personal access token'],
  [/ghs_[A-Za-z0-9]{36}/, 'looks like a GitHub app installation token'],
  [/gho_[A-Za-z0-9]{36}/, 'looks like a GitHub OAuth token'],
  [/glpat-[A-Za-z0-9_\-]{20,}/, 'looks like a GitLab personal access token'],
  // LLM provider keys
  [/sk-ant-api\d{2}-[A-Za-z0-9_\-]{40,}/, 'looks like an Anthropic API key'],
  [/sk-[A-Za-z0-9]{48}/, 'looks like an OpenAI-style API key'],
  [/sk-proj-[A-Za-z0-9_\-]{40,}/, 'looks like an OpenAI project key'],
  // Payment providers
  [/sk_(live|test)_[0-9A-Za-z]{24,}/, 'looks like a Stripe secret key'],
  [/rk_(live|test)_[0-9A-Za-z]{24,}/, 'looks like a Stripe restricted key'],
  // Chat/messaging
  [/xox[abpors]-\d+-\d+-[A-Za-z0-9]+/, 'looks like a Slack API token'],
  // Cloud/ops
  [/dop_v1_[A-Fa-f0-9]{64}/, 'looks like a DigitalOcean API token'],
  // Google service account markers
  [/"private_key_id":\s*"[a-f0-9]{40}"/i, 'looks like a Google service account key fragment'],
  [/"type":\s*"service_account"/i, 'looks like a Google service account JSON'],
];

// Allowed patch modes. 'full' is the default — replaces the whole file body.
// The others allow narrower edits so specialists don't have to round-trip a
// 600-line skill just to add a paragraph.
type PatchMode = 'full' | 'section-replace' | 'append' | 'prepend';
const VALID_MODES: PatchMode[] = ['full', 'section-replace', 'append', 'prepend'];

interface ValidationResult {
  ok: boolean;
  notes: string[];
  errors: string[];
}

function validateSkill(content: string): ValidationResult {
  const result: ValidationResult = { ok: true, notes: [], errors: [] };

  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_BYTES) {
    result.errors.push(`skill exceeds ${MAX_SKILL_BYTES} bytes`);
    result.ok = false;
  }

  if (!content.startsWith('---\n')) {
    result.errors.push('missing YAML frontmatter (must start with ---\\n)');
    result.ok = false;
    return result;
  }

  const close = content.indexOf('\n---\n', 4);
  if (close === -1) {
    result.errors.push('YAML frontmatter never closes (no trailing ---)');
    result.ok = false;
    return result;
  }

  const frontmatter = content.slice(4, close);
  if (!/^name:\s*\S/m.test(frontmatter)) {
    result.errors.push('frontmatter missing required `name` field');
    result.ok = false;
  }
  if (!/^description:\s*\S/m.test(frontmatter)) {
    result.errors.push('frontmatter missing required `description` field');
    result.ok = false;
  }

  for (const [pattern, label] of DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      result.errors.push(`blocked: ${label}`);
      result.ok = false;
    }
  }

  const body = content.slice(close + 5).trim();
  if (body.length < 20) {
    result.notes.push('body is very short; skill may be a stub');
  }

  return result;
}

function canonicalizeSkillName(name: string): string | null {
  const trimmed = String(name || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,64}$/.test(trimmed)) return null;
  return trimmed.toUpperCase() + '.md';
}

function atomicWrite(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o644 });
    renameSync(tmp, filePath);
  } catch (err) {
    if (existsSync(tmp)) { try { unlinkSync(tmp); } catch {} }
    throw err;
  }
}

// ---------- Patch-mode composers -------------------------------------------
//
// Each composer takes the existing full file content + the patch payload
// and returns the proposed new full content. Validation runs on the result,
// not on the fragment the caller supplied — so "valid patch" always means
// "the result is a valid skill."

/**
 * Replace a single H2 section in place. The section is identified by the H2
 * header text (exact match). Replaces from the matching `## <title>` line to
 * the line before the next `## ` header (or EOF). Errors if the header is
 * not found or is found more than once (ambiguity is safer to surface than
 * silently guess).
 *
 * Caller's `content` should include its own `## <new title>` header so the
 * section is self-describing. If the header changes, future patches should
 * target the new title.
 */
function composeSectionReplace(
  original: string,
  sectionTitle: string,
  newSectionBody: string,
): { ok: true; content: string } | { ok: false; error: string } {
  if (!sectionTitle || typeof sectionTitle !== 'string') {
    return { ok: false, error: 'section-replace requires sectionTitle' };
  }

  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerRe = new RegExp(`^##\\s+${escaped}\\s*$`, 'gm');
  const matches = [...original.matchAll(headerRe)];

  if (matches.length === 0) {
    return { ok: false, error: `no H2 section titled "${sectionTitle}" found in existing skill` };
  }
  if (matches.length > 1) {
    return { ok: false, error: `multiple (${matches.length}) H2 sections titled "${sectionTitle}" — ambiguous` };
  }

  const startIdx = matches[0].index!;
  // Find the next H2 or EOF
  const afterHeader = original.slice(startIdx + matches[0][0].length);
  const nextH2 = afterHeader.search(/\n##\s+\S/);
  const endIdx = nextH2 === -1 ? original.length : startIdx + matches[0][0].length + nextH2 + 1; // +1 to keep the newline

  // Normalize the new section body so it ends with a single newline
  let replacement = newSectionBody.replace(/\n+$/, '') + '\n';
  // If the existing section ended with a double-newline before the next H2,
  // preserve that spacing so the document stays readable.
  if (endIdx < original.length && original.slice(endIdx - 2, endIdx) === '\n\n') {
    replacement = replacement.replace(/\n$/, '\n\n');
  }

  const composed = original.slice(0, startIdx) + replacement + original.slice(endIdx);
  return { ok: true, content: composed };
}

/** Append content to the end of the skill body (before trailing whitespace). */
function composeAppend(original: string, appendBody: string): { ok: true; content: string } {
  const trimmedOriginal = original.replace(/\n+$/, '');
  const cleanAppend = appendBody.replace(/^\n+/, '').replace(/\n+$/, '');
  return { ok: true, content: `${trimmedOriginal}\n\n${cleanAppend}\n` };
}

/**
 * Prepend content immediately after the YAML frontmatter (before the first
 * body character). Useful for adding a short "update history" or deprecation
 * banner at the top of a skill.
 */
function composePrepend(original: string, prependBody: string): { ok: true; content: string } | { ok: false; error: string } {
  if (!original.startsWith('---\n')) return { ok: false, error: 'original has no frontmatter; cannot prepend cleanly' };
  const close = original.indexOf('\n---\n', 4);
  if (close === -1) return { ok: false, error: 'original frontmatter unclosed' };

  const frontmatterEnd = close + 5; // past the "\n---\n"
  const cleanPrepend = prependBody.replace(/^\n+/, '').replace(/\n+$/, '');
  const composed = `${original.slice(0, frontmatterEnd)}\n${cleanPrepend}\n\n${original.slice(frontmatterEnd).replace(/^\n+/, '')}`;
  return { ok: true, content: composed };
}

export function createSkillsRouter(): Router {
  const router = Router();

  /**
   * POST /skill-manage — agent-proposed skill create or patch.
   *
   * Pattern borrowed from Hermes (see docs/context-architecture/hermes-deepdive/
   * 02-skills-and-self-improvement.md). Specialists propose a skill via the
   * `**PROPOSED SKILL UPDATE:** ...` marker in their response; Pocket reviews
   * and calls this endpoint.
   *
   * Body:
   *   action:       'create' | 'patch'
   *   skillName:    kebab-case name; file lands as <SKILL_LIBRARY_ROOT>/<UPPER>.md
   *   mode:         'full' (default) | 'section-replace' | 'append' | 'prepend'
   *                 — only meaningful when action=patch; creates always use 'full'.
   *   content:      for full: entire file content including frontmatter
   *                 for section-replace: the new section body (with its own ## header)
   *                 for append/prepend: the fragment to add
   *   sectionTitle: required when mode='section-replace' — the H2 header text to target
   *   proposedBy:   agent id (e.g. 'kazi', 'tafiti', 'pocket')
   *   taskContext:  short description of what task triggered the proposal
   *
   * Returns:
   *   { ok: true, path, contributionId, validation, mode }
   *   { ok: false, errors, validation? }
   */
  router.post('/skill-manage', authMiddleware, async (req: Request, res: Response) => {
    const { action, skillName, content, proposedBy, taskContext, sectionTitle } = req.body ?? {};
    const mode: PatchMode = (req.body?.mode ?? 'full') as PatchMode;

    // Input validation
    if (action !== 'create' && action !== 'patch') {
      res.status(400).json({ ok: false, errors: ['action must be "create" or "patch"'] });
      return;
    }
    if (!VALID_MODES.includes(mode)) {
      res.status(400).json({ ok: false, errors: [`mode must be one of: ${VALID_MODES.join(', ')}`] });
      return;
    }
    if (action === 'create' && mode !== 'full') {
      res.status(400).json({ ok: false, errors: ['action=create always uses mode=full (new files have nothing to patch)'] });
      return;
    }
    const filename = canonicalizeSkillName(skillName);
    if (!filename) {
      res.status(400).json({ ok: false, errors: ['skillName must be kebab-case [a-z][a-z0-9-]{1,64}'] });
      return;
    }
    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ ok: false, errors: ['content is required'] });
      return;
    }

    const skillPath = resolve(SKILL_LIBRARY_ROOT, filename);
    if (!skillPath.startsWith(resolve(SKILL_LIBRARY_ROOT) + '/')) {
      res.status(400).json({ ok: false, errors: ['skill path escapes library root'] });
      return;
    }

    // Read body_before if patching
    let bodyBefore: string | null = null;
    if (action === 'patch') {
      if (!existsSync(skillPath)) {
        res.status(404).json({ ok: false, errors: [`patch action but skill does not exist at ${skillPath}; use action=create`] });
        return;
      }
      try {
        bodyBefore = readFileSync(skillPath, 'utf8');
      } catch (err: any) {
        res.status(500).json({ ok: false, errors: [`failed to read existing skill: ${err.message}`] });
        return;
      }
    } else {
      if (existsSync(skillPath)) {
        res.status(409).json({ ok: false, errors: [`skill already exists at ${skillPath}; use action=patch to update`] });
        return;
      }
    }

    // Compose the full content based on mode. For 'full', content IS the result.
    // For section-replace / append / prepend, we build the result from existing + fragment.
    let finalContent: string;
    if (action === 'create' || mode === 'full') {
      finalContent = content;
    } else if (mode === 'section-replace') {
      const r = composeSectionReplace(bodyBefore!, sectionTitle, content);
      if (!r.ok) {
        res.status(400).json({ ok: false, errors: [r.error] });
        return;
      }
      finalContent = r.content;
    } else if (mode === 'append') {
      const r = composeAppend(bodyBefore!, content);
      finalContent = r.content;
    } else if (mode === 'prepend') {
      const r = composePrepend(bodyBefore!, content);
      if (!r.ok) {
        res.status(400).json({ ok: false, errors: [r.error] });
        return;
      }
      finalContent = r.content;
    } else {
      res.status(400).json({ ok: false, errors: [`unreachable: mode ${mode}`] });
      return;
    }

    // Validate the *composed* result, not just the fragment. This catches cases
    // where an append happens to land a credential, or a section-replace
    // strips out required frontmatter-dependent references.
    const validation = validateSkill(finalContent);
    if (!validation.ok) {
      res.status(400).json({ ok: false, errors: validation.errors, validation });
      return;
    }

    // Atomic write
    try {
      atomicWrite(skillPath, finalContent);
    } catch (err: any) {
      res.status(500).json({ ok: false, errors: [`write failed: ${err.message}`] });
      return;
    }

    // Audit log
    let contributionId: string | null = null;
    try {
      const db = getPool();
      if (db) {
        const row = await db.query<{ id: string }>(
          `INSERT INTO memory.skill_contributions
             (action, skill_name, proposed_by, body_before, body_after, validation_notes, task_context)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            `${action}:${mode}`,
            filename.replace(/\.md$/, '').toLowerCase(),
            proposedBy ?? 'unknown',
            bodyBefore,
            finalContent,
            validation.notes.length ? validation.notes.join('; ') : null,
            taskContext ?? null,
          ],
        );
        contributionId = row.rows[0]?.id ?? null;
      }
    } catch (err: any) {
      console.warn(`[skill-manage] audit log failed: ${err.message}`);
    }

    res.json({
      ok: true,
      path: skillPath,
      contributionId,
      mode,
      action,
      validation,
    });
  });

  /**
   * GET /skill-contributions — list recent agent-proposed contributions.
   */
  router.get('/skill-contributions', authMiddleware, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
    try {
      const rows = await db.query(
        `SELECT id, proposed_at, action, skill_name, proposed_by, status, task_context
         FROM memory.skill_contributions
         ORDER BY proposed_at DESC
         LIMIT $1`,
        [limit],
      );
      res.json({ contributions: rows.rows });
    } catch (err: unknown) {
      res.status(500).json({ error: extractError(err) });
    }
  });

  return router;
}
