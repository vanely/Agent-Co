export const SESSION_NAME = 'agent-co';
export const FALLBACK_CONTEXT_MESSAGES = 40;
export const COMPACTION_THRESHOLD = 15000;
export const CONTEXT_REFRESH_INTERVAL = 20; // re-read core skills every N messages to prevent context decay

export const CORE_SKILLS = [
  '~/.agent-co/workspace/context/core/identity.md',
  '~/.agent-co/workspace/context/core/co-founder.md',
  '~/.agent-co/workspace/context/core/problem-solver.md',
  '~/.agent-co/workspace/context/core/learning-capture.md',
  '~/.agent-co/workspace/context/core/memory-recall.md',
  '~/.agent-co/workspace/context/core/technical-awareness.md',
  '~/.agent-co/workspace/context/core/lead-management.md',
  '~/.agent-co/workspace/context/core/context-anchor.md',
  '~/.agent-co/workspace/context/self-build/self-architecture.md',
  '~/.agent-co/workspace/memory/decisions.md',
];

// Technical guides are no longer loaded at session start.
// technical-awareness.md (in CORE_SKILLS) points to DEVELOPMENT-LIFECYCLE.md,
// which handles JIT loading of individual guides when each phase needs them.
// This prevents context pollution from 7,000+ lines of guides loaded at once.
