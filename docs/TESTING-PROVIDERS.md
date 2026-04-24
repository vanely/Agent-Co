# Testing LLM Providers For Free

Agent Co abstracts over 4 LLM backends, but you don't need to pay for any of them to test. This doc is the recipe for each free path.

---

## TL;DR

1. **First test**: Ollama. Fully local, zero cost, no signup.
2. **API-shape test**: Groq (OpenAI-compatible). Free tier, fast, no credit card required.
3. **Production-shape test**: burn Anthropic free credits sparingly.

---

## Option 1: Ollama (fully local, free forever)

Best for: correctness testing, offline development, privacy-sensitive work.

### Install

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

### Pull a capable model

```bash
ollama pull llama3.1:8b          # fast, smaller
ollama pull qwen2.5-coder:14b    # good for code + reasoning
ollama pull llama3.1:70b         # heaviest; needs ~40GB RAM
```

### Start the daemon

Ollama usually runs as a background service after install. Verify:

```bash
curl http://localhost:11434/api/tags
# should return JSON list of pulled models
```

### Configure Agent Co

In `agent-company/.env`:
```
LLM_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
LLM_MODEL=llama3.1:8b
```

### Verify

```bash
bin/agentco rebuild
bin/agentco health
curl -sS -H "Authorization: Bearer $(grep RELAY_SECRET agent-company/.env | cut -d= -f2-)" \
  -X POST http://localhost:3456/run-agent \
  -H 'Content-Type: application/json' \
  -d '{"task":"respond with exactly: ollama-ok","timeoutSeconds":30}'
```

**Note:** Ollama models are capable but noticeably weaker than Claude/GPT-4 class models for complex multi-step reasoning. Use for smoke tests + simple flows; expect some tasks to need a stronger model.

---

## Option 2: Groq (OpenAI-compatible, generous free tier)

Best for: fast iteration, OpenAI-compatible shape testing.

### Sign up

https://console.groq.com/ — email signup, no credit card.

### Get API key

Console → API Keys → Create new → copy `gsk_...`

### Configure Agent Co

```
LLM_PROVIDER=openai-api
OPENAI_API_KEY=gsk_your_key_here
OPENAI_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile   # or llama-3.1-8b-instant for speed
```

### Verify

```bash
bin/agentco rebuild
curl -sS -X POST https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"hi"}]}'
```

Groq's free tier is extremely generous for testing. Rate limits apply but you'll rarely hit them during development.

---

## Option 3: Together AI

Same shape as Groq — sign up at https://api.together.ai/, grab key, use `OPENAI_BASE_URL=https://api.together.xyz/v1`.

Free tier includes several models. Models like `meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo` work well.

---

## Option 4: Fireworks AI

Same shape — https://fireworks.ai/, `OPENAI_BASE_URL=https://api.fireworks.ai/inference/v1`.

---

## Option 5: Anthropic API free credits

New accounts get ~$5 in credits on signup — enough for hundreds of test requests.

### Get credits

https://console.anthropic.com/ → Billing → Claim free credits.

### Configure

```
LLM_PROVIDER=anthropic-api
ANTHROPIC_API_KEY=sk-ant-api...
LLM_MODEL=claude-haiku-4-5    # cheapest; save credits for later
```

### Verify

```bash
curl -sS https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}'
```

Haiku is the most credit-efficient model. Save Opus for production-shape testing.

---

## Option 6: OpenAI free tier

Sometimes OpenAI offers free trial credits (varies). Same shape as openai-api with base URL `https://api.openai.com/v1`. Check https://platform.openai.com/ for current promotions.

---

## What to test

Regardless of provider, these smoke tests cover the most important paths:

1. **Basic request** — `/run-agent` with a 1-line prompt, expect a non-empty response
2. **Session persistence** — CLI turn → query `memory.messages` → turn landed
3. **Skill management** — POST a skill via `/skill-manage`, verify file lands + audit row created
4. **Discord/Telegram fan-out** — `bin/agentco notify all "test"`, verify both channels receive
5. **Learning Flywheel** — multi-turn session, `bin/agentco learning pending` shows captured signals
6. **MCP tool** — from a Claude Code CLI session rooted in the install dir, invoke an MCP tool

The non-LLM paths (persistence, skill validation, notifications, hooks) are provider-agnostic; they'll pass regardless. The LLM-quality paths (research spawns, agentic consolidation) vary by model — weaker models will produce shallower consolidation briefs.

---

## Cost expectations for full production use

Rough per-1M-tokens guesses as of 2026-04 (confirm current pricing):

| Provider | Input | Output | Notes |
|---|---|---|---|
| Claude CLI | free | free | via your subscription |
| Claude Opus | $15 | $75 | most capable, most expensive |
| Claude Haiku | $0.80 | $4 | great balance for most ops |
| GPT-4o | $5 | $15 | |
| Groq Llama 70B | free tier | free tier | then ~$0.5/$0.8 |
| Ollama | free (your compute) | free | no network cost |

Plan accordingly: most of Agent Co's day-to-day agent work (consolidation, persistence, small tasks) is Haiku-class. Heavy reasoning (architectural discussions, research spawns) warrants Opus.
