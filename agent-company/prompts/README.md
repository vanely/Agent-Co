# Prompt Templates

Prompt text for n8n workflows that invoke Claude via the relay. Extracted from embedded JavaScript inside n8n Code nodes so the prompts are:

- Versionable (git history of prompt changes)
- Testable (run the prompt outside n8n to iterate quickly)
- Reviewable (readable markdown, not string-concatenated JS)

## Template format

Each template is a markdown file. Variable substitution uses **`{{variable_name}}`** syntax. The n8n Code node reads the file via `require('fs').readFileSync()`, substitutes placeholders from the workflow context, and passes the result to the relay.

Example:
```markdown
You are researching {{business_name}}.

Location: {{city}}, {{state}}
```

Code node:
```javascript
const fs = require('fs');
const template = fs.readFileSync('/home/node/prompts/lead-researcher-cold-email.md', 'utf-8');
const lead = $('One At A Time').item.json;
const prompt = template
  .replace(/\{\{business_name\}\}/g, lead.business_name)
  .replace(/\{\{city\}\}/g, lead.city)
  .replace(/\{\{state\}\}/g, lead.state);
return [{ json: { prompt, lead_id: lead.id } }];
```

## Current templates

| File | Used by | Purpose |
|---|---|---|
| `lead-researcher-cold-email.md` | workflow 06 (`Build Claude Prompt` node) | First-touch cold-email draft for a lead |
| `follow-up.md` | workflow 08 (`Build Follow-up Prompt` node) | Follow-up email referencing a prior send |

## Workflow → n8n mount path

The n8n container at `agent-company/docker-compose.yml` mounts `agent-company/` into the container. Inside the container, the prompts directory is at a mounted path.

**When editing an n8n Code node to reference a prompt file:** confirm the container's view of the path. In current setup, the scripts directory is mounted, so the in-container path is `/scripts/...`; prompts follow the same convention. If the prompts mount isn't set up yet, add a volume mount entry for `./prompts:/home/node/prompts:ro` in docker-compose.yml before touching the Code nodes.

## When to add a new template

- New workflow that invokes Claude → prompt lives here, not inline
- Existing prompt needs a meaningful tweak → edit the .md file, not the workflow JSON
- A/B testing variants → create `-v2.md` sibling file, A/B via workflow branch
