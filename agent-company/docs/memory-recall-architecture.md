# Memory Recall Architecture — Pocket's Long-Term Memory Search

## Overview

When Pocket's session context gets compacted, he loses detailed recall of earlier
conversations. This system gives him the ability to search his own conversation
history using Postgres full-text search, triggered by a skill file that teaches
him when and how to reach for his memories.

---

## Data Layer

### New table: `memory.messages`

Replaces the JSONB `transcript` array in `memory.conversations`. Single source
of truth for all conversation messages — supports both sequential replay and
indexed full-text search.

```sql
CREATE TABLE memory.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      TEXT NOT NULL,
  seq             SERIAL,                    -- auto-increment for ordering
  discord_msg_id  TEXT,                      -- Discord snowflake for continuity + dedup
  role            TEXT NOT NULL,             -- 'user' | 'assistant'
  content         TEXT NOT NULL,             -- raw message
  search_vector   TSVECTOR                  -- auto-generated, indexed
      GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  username        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX messages_search_idx ON memory.messages USING GIN (search_vector);
CREATE INDEX messages_channel_seq_idx ON memory.messages (channel_id, seq DESC);
CREATE INDEX messages_channel_role_idx ON memory.messages (channel_id, role);
```

The `search_vector` column is a **generated column** — Postgres computes it
automatically on INSERT from the `content` field using English stemming and
stop word removal. No triggers, no background process, no extraction calls.

### Migration from JSONB transcript

The `memory.conversations` table's `transcript` JSONB column is deprecated.
All code that previously read/wrote to the transcript array is migrated to
use `memory.messages` instead.

The `memory.conversations` table still exists for session metadata:
- `channel_id`, `claude_session_id`, `session_active`
- `message_count`, `context_reloaded`, `last_token_count`
- `last_user`, `created_at`, `updated_at`

The `transcript` column is dropped.

---

## Search Endpoint

### `POST /search-memory`

```json
{
  "query": "session resume UUID approach",
  "channelId": "1487197981970268201",
  "limit": 2
}
```

**Behavior**:
1. Full-text search on `memory.messages` where `role = 'assistant'`
   (Pocket's responses contain the implementations and decisions)
2. Scoped to `channelId` if provided
3. Returns the top `limit` matches ranked by `ts_rank` relevance score
4. For each match, also returns the message before and after it (by `seq`)
   to provide conversational context around the hit

**Response**:
```json
{
  "results": [
    {
      "match": {
        "seq": 142,
        "role": "assistant",
        "content": "I'll scan for customTitle:pocket in the JSONL files...",
        "rank": 0.89,
        "created_at": "2026-03-29T15:02:00Z"
      },
      "before": {
        "seq": 141,
        "role": "user",
        "content": "can we find the pocket session by name instead?",
        "username": "discord_username"
      },
      "after": {
        "seq": 143,
        "role": "user",
        "content": "this is the kind of creative problem solving I want",
        "username": "discord_username"
      }
    }
  ]
}
```

Each result is a 3-message window: the question that prompted the approach,
the approach itself (the match), and the reaction/follow-up.

---

## Skill File

Loaded in the preamble with other core skills. Teaches Pocket when and how
to search his own memory.

**Location**: `~/.agent-co/workspace/context/core/memory-recall.md`

**Trigger phrases**: "remember when", "like we did before", "that approach
from earlier", "use the same", "reference from", or any time Pocket can't
recall something the user is clearly referencing.

**Behavior**:
1. Pocket detects he can't recall what the user is referencing
2. Uses `curl localhost:3456/search-memory` with keywords extracted from
   the user's message
3. Reads the 3-message windows returned
4. Synthesizes the context into his response naturally
5. If results don't match, asks the user for clarification

---

## Relay Changes

### Write path (replaces `appendToTranscript`)

After each successful Claude call:
```sql
INSERT INTO memory.messages (channel_id, discord_msg_id, role, content, username)
VALUES ($channelId, $discordMsgId, 'user', $userMessage, $username);

INSERT INTO memory.messages (channel_id, role, content)
VALUES ($channelId, 'assistant', $claudeResponse);
```

`search_vector` is computed automatically by Postgres.

Increment `message_count` in `memory.conversations` as before.

### Read path (replaces `buildTranscriptContext`)

For the fallback path (transcript injection when session can't be resumed):
```sql
SELECT role, content, username
FROM memory.messages
WHERE channel_id = $channelId
ORDER BY seq DESC
LIMIT 40;  -- last 20 turns (user + assistant)
```

Reverse the results for chronological order before injecting as context.

### Search path (new endpoint)

```sql
SELECT
  m.seq, m.role, m.content, m.username, m.created_at,
  ts_rank(m.search_vector, websearch_to_tsquery('english', $query)) AS rank
FROM memory.messages m
WHERE m.channel_id = $channelId
  AND m.role = 'assistant'
  AND m.search_vector @@ websearch_to_tsquery('english', $query)
ORDER BY rank DESC
LIMIT $limit;
```

For each match, fetch the surrounding context:
```sql
SELECT seq, role, content, username, created_at
FROM memory.messages
WHERE channel_id = $channelId
  AND seq BETWEEN ($matchSeq - 1) AND ($matchSeq + 1)
ORDER BY seq;
```

---

## What We're Not Doing (Yet)

- **No Claude extraction calls** — Postgres `to_tsvector('english', ...)` handles
  stemming and stop words natively. Zero extra cost per message.
- **No vector embeddings** — pgvector stays available for tier 2 if full-text
  search proves insufficient for semantic recall.
- **No summary generation** — raw content search. The user's descriptive style
  provides enough natural keywords for matching.
- **Only assistant messages searched** — the user's messages are questions;
  Pocket's responses contain the implementations, decisions, and approaches
  that need to be recalled.

---

## Implementation Order

1. Create `memory.messages` table with generated `search_vector` column and indexes
2. Update `init.sql` for fresh installs
3. Migrate relay: replace `appendToTranscript` with INSERT to `memory.messages`
4. Migrate relay: replace `buildTranscriptContext` with SELECT from `memory.messages`
5. Add `POST /search-memory` endpoint to relay
6. Drop `transcript` JSONB column from `memory.conversations`
7. Create the memory-recall skill file
8. Add skill to preamble core skills list in workflow 10
9. Test: send messages, verify they appear in `memory.messages` with search vectors
10. Test: search endpoint returns relevant results with surrounding context
11. Test: Pocket uses the skill to recall past conversations after compaction
