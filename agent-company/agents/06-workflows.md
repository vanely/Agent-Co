# Agent 06 — n8n Workflow JSON Files

## What You Own

You generate all n8n workflow JSON files in `workflows/`.
These files can be imported directly into n8n via the UI or CLI.

## Preconditions

- Agent 01 complete (`workflows/` directory exists)

Verify:
```bash
ls ~/agent-company/workflows/ && echo "OK" || echo "FAIL — run agent 01 first"
```

## Done Condition

All 7 workflow JSON files exist and are valid JSON:

```bash
for f in ~/agent-company/workflows/*.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('valid:', '$f')"
done
```

---

## Important: n8n Workflow JSON Format

n8n workflows are exported as JSON with this top-level structure:

```json
{
  "name": "Workflow Name",
  "nodes": [...],
  "connections": {...},
  "settings": {
    "executionOrder": "v1"
  },
  "staticData": null
}
```

Each node has:
- `id`: unique string (use short UUIDs or descriptive IDs)
- `name`: display name
- `type`: n8n node type string (e.g., `n8n-nodes-base.scheduleTrigger`)
- `typeVersion`: integer
- `position`: [x, y] coordinates for canvas layout
- `parameters`: node-specific config

Connections link node outputs to node inputs:
```json
"connections": {
  "Source Node Name": {
    "main": [[{"node": "Target Node Name", "type": "main", "index": 0}]]
  }
}
```

---

## Step 1 — Write 01-lead-scraper-orchestrator.json

Write `~/agent-company/workflows/01-lead-scraper-orchestrator.json`:

```json
{
  "name": "01 - Lead Scraper Orchestrator",
  "nodes": [
    {
      "id": "trigger-schedule",
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1,
      "position": [240, 300],
      "parameters": {
        "rule": {
          "interval": [{"field": "cronExpression", "expression": "0 6 * * *"}]
        }
      }
    },
    {
      "id": "get-pending-jobs",
      "name": "Get Pending Scrape Jobs",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [460, 300],
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT * FROM memory.scrape_state WHERE completed = false AND (last_run IS NULL OR last_run < NOW() - INTERVAL '24 hours') ORDER BY last_run ASC NULLS FIRST LIMIT 10",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "split-batches",
      "name": "Split Into Jobs",
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [680, 300],
      "parameters": {"batchSize": 1, "options": {}}
    },
    {
      "id": "route-by-source",
      "name": "Route By Source",
      "type": "n8n-nodes-base.switch",
      "typeVersion": 3,
      "position": [900, 300],
      "parameters": {
        "mode": "rules",
        "rules": {
          "values": [
            {
              "conditions": {
                "options": {"caseSensitive": true, "leftValue": "", "typeValidation": "strict"},
                "combinator": "and",
                "conditions": [{"leftValue": "={{ $json.source }}", "rightValue": "google_maps", "operator": {"type": "string", "operation": "equals"}}]
              },
              "renameOutput": true,
              "outputKey": "google_maps"
            },
            {
              "conditions": {
                "options": {"caseSensitive": true, "leftValue": "", "typeValidation": "strict"},
                "combinator": "and",
                "conditions": [{"leftValue": "={{ $json.source }}", "rightValue": "yelp", "operator": {"type": "string", "operation": "equals"}}]
              },
              "renameOutput": true,
              "outputKey": "yelp"
            }
          ]
        },
        "options": {}
      }
    },
    {
      "id": "run-google-maps",
      "name": "Run Google Maps Scraper",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [1120, 220],
      "parameters": {
        "source": "localFile",
        "workflowPath": "=/workflows/02-scrape-google-maps.json",
        "options": {}
      }
    },
    {
      "id": "run-yelp",
      "name": "Run Yelp Scraper",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [1120, 420],
      "parameters": {
        "source": "localFile",
        "workflowPath": "=/workflows/03-scrape-yelp.json",
        "options": {}
      }
    },
    {
      "id": "update-last-run",
      "name": "Update Last Run",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [1340, 300],
      "parameters": {
        "operation": "executeQuery",
        "query": "UPDATE memory.scrape_state SET last_run = NOW() WHERE source = '{{ $json.source }}' AND query = '{{ $json.query }}'",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    }
  ],
  "connections": {
    "Schedule Trigger": {"main": [[{"node": "Get Pending Scrape Jobs", "type": "main", "index": 0}]]},
    "Get Pending Scrape Jobs": {"main": [[{"node": "Split Into Jobs", "type": "main", "index": 0}]]},
    "Split Into Jobs": {"main": [[{"node": "Route By Source", "type": "main", "index": 0}]]},
    "Route By Source": {
      "main": [
        [{"node": "Run Google Maps Scraper", "type": "main", "index": 0}],
        [{"node": "Run Yelp Scraper", "type": "main", "index": 0}]
      ]
    },
    "Run Google Maps Scraper": {"main": [[{"node": "Update Last Run", "type": "main", "index": 0}]]},
    "Run Yelp Scraper": {"main": [[{"node": "Update Last Run", "type": "main", "index": 0}]]}
  },
  "settings": {"executionOrder": "v1", "errorWorkflow": "09-error-handler"},
  "staticData": null
}
```

---

## Step 2 — Write 02-scrape-google-maps.json

Write `~/agent-company/workflows/02-scrape-google-maps.json`:

```json
{
  "name": "02 - Scrape Google Maps",
  "nodes": [
    {
      "id": "sub-trigger",
      "name": "Sub-workflow Trigger",
      "type": "n8n-nodes-base.executeWorkflowTrigger",
      "typeVersion": 1,
      "position": [240, 300],
      "parameters": {}
    },
    {
      "id": "run-scraper",
      "name": "Run Scraper Script",
      "type": "n8n-nodes-base.executeCommand",
      "typeVersion": 1,
      "position": [460, 300],
      "parameters": {
        "command": "node /scripts/dist/lead-scraper/google-maps.js --query \"{{ $json.query }}\" --location \"{{ $json.location ?? 'United States' }}\" --page {{ $json.page ?? 0 }}"
      }
    },
    {
      "id": "parse-output",
      "name": "Parse Scraper Output",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [680, 300],
      "parameters": {
        "jsCode": "const raw = $input.first().json.stdout;\nif (!raw || raw.trim() === '') return [];\ntry {\n  const leads = JSON.parse(raw);\n  if (!Array.isArray(leads)) return [];\n  return leads.map(l => ({ json: l }));\n} catch (e) {\n  throw new Error('Scraper output is not valid JSON: ' + raw.slice(0, 200));\n}"
      }
    },
    {
      "id": "remove-dupes",
      "name": "Remove Duplicates",
      "type": "n8n-nodes-base.removeDuplicates",
      "typeVersion": 1,
      "position": [900, 300],
      "parameters": {
        "compare": "selectedFields",
        "fieldsToCompare": {"fields": [{"fieldName": "dedup_hash"}]},
        "options": {}
      }
    },
    {
      "id": "upsert-leads",
      "name": "Upsert Into Postgres",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [1120, 300],
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO leads.contacts (business_name, email, phone, website, address, city, state, category, rating, review_count, raw_data, dedup_hash, status) VALUES ('{{ $json.business_name }}', {{ $json.email ? \"'\" + $json.email + \"'\" : 'NULL' }}, {{ $json.phone ? \"'\" + $json.phone + \"'\" : 'NULL' }}, {{ $json.website ? \"'\" + $json.website + \"'\" : 'NULL' }}, {{ $json.address ? \"'\" + $json.address + \"'\" : 'NULL' }}, {{ $json.city ? \"'\" + $json.city + \"'\" : 'NULL' }}, {{ $json.state ? \"'\" + $json.state + \"'\" : 'NULL' }}, {{ $json.category ? \"'\" + $json.category + \"'\" : 'NULL' }}, {{ $json.rating ?? 'NULL' }}, {{ $json.review_count ?? 'NULL' }}, '{{ JSON.stringify($json.raw_data ?? {}) }}'::jsonb, '{{ $json.dedup_hash }}', 'new') ON CONFLICT (dedup_hash) DO NOTHING",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    }
  ],
  "connections": {
    "Sub-workflow Trigger": {"main": [[{"node": "Run Scraper Script", "type": "main", "index": 0}]]},
    "Run Scraper Script": {"main": [[{"node": "Parse Scraper Output", "type": "main", "index": 0}]]},
    "Parse Scraper Output": {"main": [[{"node": "Remove Duplicates", "type": "main", "index": 0}]]},
    "Remove Duplicates": {"main": [[{"node": "Upsert Into Postgres", "type": "main", "index": 0}]]}
  },
  "settings": {"executionOrder": "v1"},
  "staticData": null
}
```

---

## Step 3 — Write 05-lead-validation.json

Write `~/agent-company/workflows/05-lead-validation.json`:

```json
{
  "name": "05 - Lead Validation",
  "nodes": [
    {
      "id": "schedule",
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1,
      "position": [240, 300],
      "parameters": {
        "rule": {"interval": [{"field": "cronExpression", "expression": "0 * * * *"}]}
      }
    },
    {
      "id": "get-unvalidated",
      "name": "Get Unvalidated Leads",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [460, 300],
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT id, business_name, email, website, phone FROM leads.contacts WHERE is_valid IS NULL ORDER BY created_at ASC LIMIT 50",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "check-any",
      "name": "Any Leads To Validate?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [680, 300],
      "parameters": {
        "conditions": {
          "options": {"caseSensitive": true, "leftValue": "", "typeValidation": "strict"},
          "combinator": "and",
          "conditions": [{"leftValue": "={{ $input.all().length }}", "rightValue": 0, "operator": {"type": "number", "operation": "gt"}}]
        },
        "options": {}
      }
    },
    {
      "id": "batch-leads",
      "name": "Batch Leads",
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [900, 220],
      "parameters": {"batchSize": 10, "options": {}}
    },
    {
      "id": "run-validator",
      "name": "Run Validator Script",
      "type": "n8n-nodes-base.executeCommand",
      "typeVersion": 1,
      "position": [1120, 220],
      "parameters": {
        "command": "node /scripts/dist/validators/lead-validator.js --input '{{ JSON.stringify($input.all().map(i => i.json)) }}'"
      }
    },
    {
      "id": "parse-results",
      "name": "Parse Validation Results",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1340, 220],
      "parameters": {
        "jsCode": "const raw = $input.first().json.stdout;\nconst results = JSON.parse(raw);\nreturn results.map(r => ({ json: r }));"
      }
    },
    {
      "id": "update-leads",
      "name": "Update Lead Validation",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [1560, 220],
      "parameters": {
        "operation": "executeQuery",
        "query": "UPDATE leads.contacts SET is_valid = {{ $json.is_valid }}, validation_score = {{ $json.validation_score }}, status = CASE WHEN {{ $json.is_valid }} THEN 'validated' ELSE 'invalid' END, updated_at = NOW() WHERE id = '{{ $json.id }}'::uuid",
        "options": {"queryBatching": "independently"}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "no-op",
      "name": "Nothing To Validate",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [900, 420],
      "parameters": {}
    }
  ],
  "connections": {
    "Schedule Trigger": {"main": [[{"node": "Get Unvalidated Leads", "type": "main", "index": 0}]]},
    "Get Unvalidated Leads": {"main": [[{"node": "Any Leads To Validate?", "type": "main", "index": 0}]]},
    "Any Leads To Validate?": {
      "main": [
        [{"node": "Batch Leads", "type": "main", "index": 0}],
        [{"node": "Nothing To Validate", "type": "main", "index": 0}]
      ]
    },
    "Batch Leads": {"main": [[{"node": "Run Validator Script", "type": "main", "index": 0}]]},
    "Run Validator Script": {"main": [[{"node": "Parse Validation Results", "type": "main", "index": 0}]]},
    "Parse Validation Results": {"main": [[{"node": "Update Lead Validation", "type": "main", "index": 0}]]}
  },
  "settings": {"executionOrder": "v1", "errorWorkflow": "09-error-handler"},
  "staticData": null
}
```

---

## Step 4 — Write 06-lead-researcher.json

Write `~/agent-company/workflows/06-lead-researcher.json`:

```json
{
  "name": "06 - Lead Researcher (Claude Code)",
  "nodes": [
    {
      "id": "schedule",
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1,
      "position": [240, 300],
      "parameters": {
        "rule": {"interval": [{"field": "cronExpression", "expression": "0 9,15 * * 1-5"}]}
      }
    },
    {
      "id": "check-relay",
      "name": "Check Relay Health",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [460, 300],
      "parameters": {
        "method": "GET",
        "url": "={{ $env.CLAUDE_RELAY_URL }}/health",
        "options": {}
      }
    },
    {
      "id": "relay-up",
      "name": "Relay Up?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [680, 300],
      "parameters": {
        "conditions": {
          "options": {"caseSensitive": true},
          "combinator": "and",
          "conditions": [{"leftValue": "={{ $json.status }}", "rightValue": "ok", "operator": {"type": "string", "operation": "equals"}}]
        },
        "options": {}
      }
    },
    {
      "id": "relay-down-error",
      "name": "Relay Not Running",
      "type": "n8n-nodes-base.stopAndError",
      "typeVersion": 1,
      "position": [900, 420],
      "parameters": {
        "errorMessage": "Claude relay is not running. Start it: cd ~/agent-company/relay && npm run dev"
      }
    },
    {
      "id": "get-leads",
      "name": "Get Research Queue",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [900, 220],
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT id, business_name, email, website, city, state, category, contact_name, rating, review_count FROM leads.contacts WHERE is_valid = true AND status = 'validated' AND validation_score >= 70 ORDER BY validation_score DESC LIMIT 20",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "check-queue",
      "name": "Any Leads To Research?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [1120, 220],
      "parameters": {
        "conditions": {
          "options": {},
          "combinator": "and",
          "conditions": [{"leftValue": "={{ $input.all().length }}", "rightValue": 0, "operator": {"type": "number", "operation": "gt"}}]
        },
        "options": {}
      }
    },
    {
      "id": "split-one",
      "name": "One At A Time",
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [1340, 140],
      "parameters": {"batchSize": 1, "options": {}}
    },
    {
      "id": "log-start",
      "name": "Log Task Start",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [1560, 140],
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO memory.task_log (agent_id, workflow_name, task, input, status) VALUES ('email-writer', 'lead-researcher', 'research_and_draft', '{{ JSON.stringify($json) }}'::jsonb, 'running') RETURNING id AS task_log_id",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "build-prompt",
      "name": "Build Claude Prompt",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1780, 140],
      "parameters": {
        "jsCode": "const lead = $('One At A Time').item.json;\nconst taskLogId = $('Log Task Start').item.json.task_log_id;\n\nconst prompt = `You are researching a business to write a personalized cold email.\\n\\nBusiness details:\\n- Name: ${lead.business_name}\\n- Website: ${lead.website || 'not available'}\\n- Category: ${lead.category || 'fitness/wellness'}\\n- Location: ${lead.city}, ${lead.state}\\n- Contact: ${lead.contact_name || 'unknown'}\\n- Rating: ${lead.rating} (${lead.review_count} reviews)\\n\\nInstructions:\\n1. If a website URL is available, use your web access to visit it and understand what they do.\\n2. Identify one specific and concrete pain point this type of business commonly faces.\\n3. Write a short cold email that addresses that pain point directly.\\n4. Keep the email under 150 words. Be specific, not generic.\\n\\nOutput ONLY valid JSON with no markdown, no code fences, no explanation outside the JSON:\\n{\\n  \"subject\": \"email subject line\",\\n  \"body\": \"email body text (plain text, no HTML)\",\\n  \"pain_point\": \"one sentence describing the pain point addressed\",\\n  \"reasoning\": \"why this angle was chosen\"\\n}`;\n\nreturn [{ json: {\n  prompt,\n  lead_id: lead.id,\n  to_email: lead.email,\n  task_log_id: taskLogId\n}}];"
      }
    },
    {
      "id": "call-claude",
      "name": "Call Claude Via Relay",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [2000, 140],
      "parameters": {
        "method": "POST",
        "url": "={{ $env.CLAUDE_RELAY_URL }}/run-agent",
        "sendHeaders": true,
        "headerParameters": {"parameters": [{"name": "Content-Type", "value": "application/json"}]},
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"task\": {{ JSON.stringify($json.prompt) }},\n  \"timeoutSeconds\": 180\n}",
        "options": {}
      }
    },
    {
      "id": "parse-claude",
      "name": "Parse Claude Output",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2220, 140],
      "parameters": {
        "jsCode": "const result = $input.first().json;\nif (!result.success) {\n  throw new Error('Claude relay error: ' + result.error);\n}\nconst clean = result.output\n  .replace(/^```json\\s*/i, '')\n  .replace(/^```\\s*/i, '')\n  .replace(/```\\s*$/i, '')\n  .trim();\ntry {\n  const draft = JSON.parse(clean);\n  return [{ json: {\n    ...draft,\n    lead_id: $('Build Claude Prompt').item.json.lead_id,\n    to_email: $('Build Claude Prompt').item.json.to_email,\n    task_log_id: $('Build Claude Prompt').item.json.task_log_id\n  }}];\n} catch (e) {\n  throw new Error('Claude output is not valid JSON: ' + clean.slice(0, 300));\n}"
      }
    },
    {
      "id": "insert-draft",
      "name": "Insert Email Draft",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [2440, 140],
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO outreach.emails (lead_id, to_email, subject, body, status) VALUES ('{{ $json.lead_id }}'::uuid, '{{ $json.to_email }}', '{{ $json.subject }}', '{{ $json.body }}', 'pending')",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "update-lead-status",
      "name": "Mark Lead Researched",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [2660, 140],
      "parameters": {
        "operation": "executeQuery",
        "query": "UPDATE leads.contacts SET status = 'researched', updated_at = NOW() WHERE id = '{{ $json.lead_id }}'::uuid",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "log-complete",
      "name": "Log Task Complete",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [2880, 140],
      "parameters": {
        "operation": "executeQuery",
        "query": "UPDATE memory.task_log SET status = 'success', output = '{{ JSON.stringify($json) }}'::jsonb, completed_at = NOW(), duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000 WHERE id = '{{ $json.task_log_id }}'::uuid",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "no-op-2",
      "name": "Nothing To Research",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [1340, 320],
      "parameters": {}
    }
  ],
  "connections": {
    "Schedule Trigger": {"main": [[{"node": "Check Relay Health", "type": "main", "index": 0}]]},
    "Check Relay Health": {"main": [[{"node": "Relay Up?", "type": "main", "index": 0}]]},
    "Relay Up?": {
      "main": [
        [{"node": "Get Research Queue", "type": "main", "index": 0}],
        [{"node": "Relay Not Running", "type": "main", "index": 0}]
      ]
    },
    "Get Research Queue": {"main": [[{"node": "Any Leads To Research?", "type": "main", "index": 0}]]},
    "Any Leads To Research?": {
      "main": [
        [{"node": "One At A Time", "type": "main", "index": 0}],
        [{"node": "Nothing To Research", "type": "main", "index": 0}]
      ]
    },
    "One At A Time": {"main": [[{"node": "Log Task Start", "type": "main", "index": 0}]]},
    "Log Task Start": {"main": [[{"node": "Build Claude Prompt", "type": "main", "index": 0}]]},
    "Build Claude Prompt": {"main": [[{"node": "Call Claude Via Relay", "type": "main", "index": 0}]]},
    "Call Claude Via Relay": {"main": [[{"node": "Parse Claude Output", "type": "main", "index": 0}]]},
    "Parse Claude Output": {"main": [[{"node": "Insert Email Draft", "type": "main", "index": 0}]]},
    "Insert Email Draft": {"main": [[{"node": "Mark Lead Researched", "type": "main", "index": 0}]]},
    "Mark Lead Researched": {"main": [[{"node": "Log Task Complete", "type": "main", "index": 0}]]}
  },
  "settings": {"executionOrder": "v1", "errorWorkflow": "09-error-handler"},
  "staticData": null
}
```

---

## Step 5 — Write 07-email-dispatch.json

Write `~/agent-company/workflows/07-email-dispatch.json`:

```json
{
  "name": "07 - Email Dispatch",
  "nodes": [
    {
      "id": "schedule",
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1,
      "position": [240, 300],
      "parameters": {
        "rule": {"interval": [{"field": "cronExpression", "expression": "0 9,14 * * 1-5"}]}
      }
    },
    {
      "id": "daily-count",
      "name": "Check Daily Send Count",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [460, 300],
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT COUNT(*)::int AS sent_today FROM outreach.emails WHERE status = 'sent' AND DATE(sent_at) = CURRENT_DATE",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "under-limit",
      "name": "Under Daily Limit?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [680, 300],
      "parameters": {
        "conditions": {
          "options": {},
          "combinator": "and",
          "conditions": [{"leftValue": "={{ $json.sent_today }}", "rightValue": 100, "operator": {"type": "number", "operation": "lt"}}]
        },
        "options": {}
      }
    },
    {
      "id": "limit-reached",
      "name": "Daily Limit Reached",
      "type": "n8n-nodes-base.stopAndError",
      "typeVersion": 1,
      "position": [900, 420],
      "parameters": {"errorMessage": "Daily email send limit of 100 reached."}
    },
    {
      "id": "get-pending",
      "name": "Get Pending Emails",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [900, 220],
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT e.id, e.lead_id, e.to_email, e.subject, e.body, c.business_name, c.contact_name FROM outreach.emails e JOIN leads.contacts c ON e.lead_id = c.id WHERE e.status = 'pending' ORDER BY e.created_at ASC LIMIT {{ 100 - $('Check Daily Send Count').item.json.sent_today }}",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "batch-send",
      "name": "Batch By 10",
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [1120, 220],
      "parameters": {"batchSize": 10, "options": {}}
    },
    {
      "id": "send-email",
      "name": "Send Email",
      "type": "n8n-nodes-base.sendEmail",
      "typeVersion": 2,
      "position": [1340, 220],
      "parameters": {
        "fromEmail": "={{ $env.SMTP_USER }}",
        "toEmail": "={{ $json.to_email }}",
        "subject": "={{ $json.subject }}",
        "emailType": "text",
        "message": "={{ $json.body }}",
        "options": {}
      },
      "credentials": {"smtp": {"id": "smtp-main", "name": "AgentCo SMTP"}}
    },
    {
      "id": "rate-limit",
      "name": "Wait 30s",
      "type": "n8n-nodes-base.wait",
      "typeVersion": 1,
      "position": [1560, 220],
      "parameters": {"amount": 30, "unit": "seconds"}
    },
    {
      "id": "mark-sent",
      "name": "Mark Sent In DB",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [1780, 220],
      "parameters": {
        "operation": "executeQuery",
        "query": "UPDATE outreach.emails SET status = 'sent', sent_at = NOW() WHERE id = '{{ $json.id }}'::uuid;\nUPDATE leads.contacts SET status = 'contacted', updated_at = NOW() WHERE id = '{{ $json.lead_id }}'::uuid;",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    }
  ],
  "connections": {
    "Schedule Trigger": {"main": [[{"node": "Check Daily Send Count", "type": "main", "index": 0}]]},
    "Check Daily Send Count": {"main": [[{"node": "Under Daily Limit?", "type": "main", "index": 0}]]},
    "Under Daily Limit?": {
      "main": [
        [{"node": "Get Pending Emails", "type": "main", "index": 0}],
        [{"node": "Daily Limit Reached", "type": "main", "index": 0}]
      ]
    },
    "Get Pending Emails": {"main": [[{"node": "Batch By 10", "type": "main", "index": 0}]]},
    "Batch By 10": {"main": [[{"node": "Send Email", "type": "main", "index": 0}]]},
    "Send Email": {"main": [[{"node": "Wait 30s", "type": "main", "index": 0}]]},
    "Wait 30s": {"main": [[{"node": "Mark Sent In DB", "type": "main", "index": 0}]]}
  },
  "settings": {"executionOrder": "v1", "errorWorkflow": "09-error-handler"},
  "staticData": null
}
```

---

## Step 6 — Write 08-followup-sequencer.json

Write `~/agent-company/workflows/08-followup-sequencer.json`:

```json
{
  "name": "08 - Follow-up Sequencer",
  "nodes": [
    {
      "id": "schedule",
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1,
      "position": [240, 300],
      "parameters": {
        "rule": {"interval": [{"field": "cronExpression", "expression": "0 8 * * 1-5"}]}
      }
    },
    {
      "id": "get-followups",
      "name": "Get Due Follow-ups",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [460, 300],
      "parameters": {
        "operation": "executeQuery",
        "query": "SELECT e.id AS email_id, e.lead_id, e.subject AS original_subject, e.body AS original_body, e.sequence_step, c.email, c.business_name, c.contact_name FROM outreach.emails e JOIN leads.contacts c ON e.lead_id = c.id WHERE e.status = 'sent' AND e.sequence_step < 3 AND e.next_followup_at <= NOW() AND c.status NOT IN ('replied', 'converted', 'unsubscribed')",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "check-any",
      "name": "Any Follow-ups Due?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [680, 300],
      "parameters": {
        "conditions": {
          "options": {},
          "combinator": "and",
          "conditions": [{"leftValue": "={{ $input.all().length }}", "rightValue": 0, "operator": {"type": "number", "operation": "gt"}}]
        },
        "options": {}
      }
    },
    {
      "id": "split-one",
      "name": "One At A Time",
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [900, 220],
      "parameters": {"batchSize": 1, "options": {}}
    },
    {
      "id": "build-prompt",
      "name": "Build Follow-up Prompt",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1120, 220],
      "parameters": {
        "jsCode": "const item = $input.first().json;\nconst stepLabels = ['second', 'third', 'final'];\nconst label = stepLabels[item.sequence_step - 1] ?? 'follow-up';\n\nconst prompt = `Write a ${label} follow-up email.\\n\\nOriginal email sent to ${item.business_name}:\\nSubject: ${item.original_subject}\\nBody: ${item.original_body}\\n\\nInstructions:\\n- Reference the original email briefly\\n- Add a different angle or value point — do not repeat what was already said\\n- Keep it under 80 words\\n- This is follow-up ${item.sequence_step + 1} of 3\\n\\nOutput ONLY valid JSON:\\n{\\n  \"subject\": \"Re: ${item.original_subject}\",\\n  \"body\": \"follow-up email body text\"\\n}`;\n\nreturn [{ json: { prompt, ...item } }];"
      }
    },
    {
      "id": "call-claude",
      "name": "Call Claude Via Relay",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [1340, 220],
      "parameters": {
        "method": "POST",
        "url": "={{ $env.CLAUDE_RELAY_URL }}/run-agent",
        "sendHeaders": true,
        "headerParameters": {"parameters": [{"name": "Content-Type", "value": "application/json"}]},
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\"task\": {{ JSON.stringify($json.prompt) }}, \"timeoutSeconds\": 120}",
        "options": {}
      }
    },
    {
      "id": "parse-output",
      "name": "Parse Follow-up Draft",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1560, 220],
      "parameters": {
        "jsCode": "const result = $input.first().json;\nif (!result.success) throw new Error('Claude error: ' + result.error);\nconst clean = result.output.replace(/^```json\\s*/i,'').replace(/^```\\s*/i,'').replace(/```\\s*$/i,'').trim();\nconst draft = JSON.parse(clean);\nreturn [{ json: { ...draft, lead_id: $('Build Follow-up Prompt').item.json.lead_id, email: $('Build Follow-up Prompt').item.json.email, sequence_step: $('Build Follow-up Prompt').item.json.sequence_step }}];"
      }
    },
    {
      "id": "insert-followup",
      "name": "Insert Follow-up Email",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [1780, 220],
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO outreach.emails (lead_id, to_email, subject, body, status, sequence_step, next_followup_at) VALUES ('{{ $json.lead_id }}'::uuid, '{{ $json.email }}', '{{ $json.subject }}', '{{ $json.body }}', 'pending', {{ $json.sequence_step + 1 }}, NOW() + INTERVAL '7 days')",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "no-op",
      "name": "No Follow-ups Due",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [900, 420],
      "parameters": {}
    }
  ],
  "connections": {
    "Schedule Trigger": {"main": [[{"node": "Get Due Follow-ups", "type": "main", "index": 0}]]},
    "Get Due Follow-ups": {"main": [[{"node": "Any Follow-ups Due?", "type": "main", "index": 0}]]},
    "Any Follow-ups Due?": {
      "main": [
        [{"node": "One At A Time", "type": "main", "index": 0}],
        [{"node": "No Follow-ups Due", "type": "main", "index": 0}]
      ]
    },
    "One At A Time": {"main": [[{"node": "Build Follow-up Prompt", "type": "main", "index": 0}]]},
    "Build Follow-up Prompt": {"main": [[{"node": "Call Claude Via Relay", "type": "main", "index": 0}]]},
    "Call Claude Via Relay": {"main": [[{"node": "Parse Follow-up Draft", "type": "main", "index": 0}]]},
    "Parse Follow-up Draft": {"main": [[{"node": "Insert Follow-up Email", "type": "main", "index": 0}]]}
  },
  "settings": {"executionOrder": "v1", "errorWorkflow": "09-error-handler"},
  "staticData": null
}
```

---

## Step 7 — Write 09-error-handler.json

Write `~/agent-company/workflows/09-error-handler.json`:

```json
{
  "name": "09 - Global Error Handler",
  "nodes": [
    {
      "id": "error-trigger",
      "name": "Error Trigger",
      "type": "n8n-nodes-base.errorTrigger",
      "typeVersion": 1,
      "position": [240, 300],
      "parameters": {}
    },
    {
      "id": "format-error",
      "name": "Format Error",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [460, 300],
      "parameters": {
        "jsCode": "const err = $input.first().json;\nreturn [{ json: {\n  workflow_name: err.workflow?.name ?? 'unknown',\n  node_name: err.execution?.lastNodeExecuted ?? 'unknown',\n  error_message: err.execution?.error?.message ?? 'No message',\n  execution_id: err.execution?.id ?? 'unknown',\n  timestamp: new Date().toISOString()\n}}];"
      }
    },
    {
      "id": "log-error",
      "name": "Log Error To DB",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2,
      "position": [680, 300],
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO memory.task_log (agent_id, workflow_name, task, status, error_msg) VALUES ('system', '{{ $json.workflow_name }}', '{{ $json.node_name }}', 'failed', '{{ $json.error_message }}')",
        "options": {}
      },
      "credentials": {"postgres": {"id": "postgres-main", "name": "AgentCo Postgres"}}
    },
    {
      "id": "alert-email",
      "name": "Email Alert",
      "type": "n8n-nodes-base.sendEmail",
      "typeVersion": 2,
      "position": [900, 300],
      "parameters": {
        "fromEmail": "={{ $env.SMTP_USER }}",
        "toEmail": "={{ $env.SMTP_USER }}",
        "subject": "=[AgentCo] Workflow failure: {{ $json.workflow_name }}",
        "emailType": "text",
        "message": "=Workflow: {{ $json.workflow_name }}\nNode: {{ $json.node_name }}\nError: {{ $json.error_message }}\nTime: {{ $json.timestamp }}\nExecution ID: {{ $json.execution_id }}",
        "options": {}
      },
      "credentials": {"smtp": {"id": "smtp-main", "name": "AgentCo SMTP"}}
    }
  ],
  "connections": {
    "Error Trigger": {"main": [[{"node": "Format Error", "type": "main", "index": 0}]]},
    "Format Error": {"main": [[{"node": "Log Error To DB", "type": "main", "index": 0}]]},
    "Log Error To DB": {"main": [[{"node": "Email Alert", "type": "main", "index": 0}]]}
  },
  "settings": {"executionOrder": "v1"},
  "staticData": null
}
```

---

## Step 8 — Validate All JSON Files

```bash
echo "Validating workflow JSON files..."
ALL_VALID=true
for f in ~/agent-company/workflows/*.json; do
  RESULT=$(node -e "
    try {
      JSON.parse(require('fs').readFileSync('$f','utf8'));
      console.log('valid');
    } catch(e) {
      console.log('INVALID: ' + e.message);
    }
  ")
  echo "  $f: $RESULT"
  [[ "$RESULT" != "valid" ]] && ALL_VALID=false
done
$ALL_VALID && echo "All workflow files are valid JSON" || echo "ERROR: some files are invalid"
```

---

## Step 9 — Update BUILD_STATE.md

```bash
sed -i.bak 's/- \[ \] 06-workflows/- [x] 06-workflows/' ~/agent-company/BUILD_STATE.md
rm ~/agent-company/BUILD_STATE.md.bak 2>/dev/null || true
```

Return to `agents/00-coordinator.md` and proceed to Agent 07.
