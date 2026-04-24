# Lead Storage Architecture — Pocket's Research-to-Database Pipeline

## Overview

When Pocket conducts lead research (via Discord or automated workflows), he produces
rich business intelligence that needs to be stored, deduplicated, and made queryable.
This system gives him a structured endpoint to store leads, a robust schema to
standardize the data, and a skill file that teaches him the format and workflow.

---

## Data Layer

### Extended table: `leads.contacts`

The existing `leads.contacts` table is extended with new columns for business
intelligence, outreach templates, and research artifacts. Existing FK relationships
to `outreach.emails` and `crm.companies` are preserved. Column renames improve
clarity.

#### Column renames (existing → new)

| Old name | New name | Reason |
|----------|----------|--------|
| `contact_name` | `owner_name` | Clarity — this is the decision maker |
| `phone` | `phone_number` | Consistency |
| `rating` | `average_rating` | Descriptive |
| `review_count` | `total_reviews` | Descriptive |
| `validation_score` | `lead_score` | Reflects Pocket's holistic assessment, not just validation |
| `is_valid` | *(dropped)* | Replaced by `status` lifecycle and `lead_score` |

#### New columns

```sql
-- Identity
owner_email             TEXT            -- direct email for decision maker
decision_maker_title    TEXT            -- "Owner", "Marketing Director", etc.

-- Contact preferences
preferred_contact_method TEXT           -- 'email' | 'phone' | 'linkedin' | 'in_person'
best_time_to_contact    TEXT            -- derived from hours + industry norms

-- Online presence
google_places_url       TEXT
yelp_url                TEXT
linkedin_url            TEXT
social_media            JSONB           -- {instagram, facebook, twitter, tiktok}
online_presence_score   INTEGER         -- 0-100 (Pocket's assessment)

-- Business intelligence
industry                TEXT            -- more specific than category
employee_list           JSONB           -- [{name, role}]
employee_count          INTEGER
year_established        INTEGER
hours_of_operation      TEXT
tech_stack              TEXT            -- tools/platforms the business uses
revenue_estimate        TEXT
founder_story           TEXT            -- how/why the business started
recent_news             JSONB           -- [{headline, date, url}]
competitors             JSONB           -- [{name, website, differentiator}]
pain_points             JSONB           -- ["no online booking", "weak SEO"]
ideal_service           TEXT            -- what we'd offer this business
tags                    TEXT[]          -- flexible tagging for filtering
referral_source         TEXT

-- Research
research_notes          JSONB           -- {depth, confidence, sources[], methodology, researched_at}
source_csv              TEXT            -- which CSV batch this came from

-- Outreach
email_templates         JSONB           -- [{subject, body, approach}]
call_scripts            JSONB           -- [{opening, pitch, objection_handling}]
last_contacted_at       TIMESTAMPTZ
```

#### Status lifecycle

```
new → researched → not_contacted → contacted_interested → contacted_uninterested → converted → lost
```

- `new` — just scraped or imported, minimal data
- `researched` — Pocket has done deep research, all intelligence fields populated
- `not_contacted` — research complete, outreach templates crafted, ready to send
- `contacted_interested` — responded positively
- `contacted_uninterested` — responded negatively or no fit
- `converted` — became a customer
- `lost` — dropped out of pipeline

#### Deduplication

`dedup_hash` = MD5 of `lower(business_name || '|' || city || '|' || state)`

This catches:
- Same business imported from different sources (Google Maps, Yelp, CSV)
- Re-researched businesses from different sessions
- Slight variations in name casing

When a duplicate is detected on insert, the endpoint merges based on a `mode` flag:

- **`mode: "fill"`** (default) — new non-null fields fill in null fields only.
  Existing data is preserved. Use for supplementing partial records.
- **`mode: "update"`** — new non-null fields overwrite existing fields.
  Use when Pocket has intentionally re-researched with better data.

For JSONB array fields (`email_templates`, `call_scripts`, `employee_list`,
`recent_news`, `competitors`, `pain_points`):
- `fill` mode: concatenates arrays, deduplicates by first key (subject for
  templates, name for employees/competitors, headline for news)
- `update` mode: replaces the entire array with the new data

For `tags` (TEXT array): always merged (union of old + new), never overwritten.

---

## Relay Endpoint

### `POST /store-leads`

Accepts a single lead or an array. The `mode` field controls merge behavior
on duplicates.

```json
{
  "mode": "fill",
  "leads": [
    {
      "business_name": "Sunrise Yoga Studio",
      "owner_name": "Maria Chen",
      "decision_maker_title": "Owner & Lead Instructor",
      "email": "info@sunriseyoga.com",
      "owner_email": "maria@sunriseyoga.com",
      "phone_number": "555-0142",
      "website": "https://sunriseyoga.com",
      "address": "123 Main St",
      "city": "Austin",
      "state": "TX",
      "google_places_url": "https://maps.google.com/...",
      "yelp_url": "https://yelp.com/biz/...",
      "linkedin_url": "https://linkedin.com/company/...",
      "social_media": {"instagram": "@sunriseyogaatx", "facebook": "sunriseyogastudio"},
      "average_rating": 4.7,
      "total_reviews": 234,
      "online_presence_score": 65,
      "industry": "Boutique Fitness",
      "category": "Yoga Studio",
      "employee_list": [
        {"name": "Maria Chen", "role": "Owner"},
        {"name": "Jake Torres", "role": "Instructor"},
        {"name": "Aisha Patel", "role": "Front Desk Manager"}
      ],
      "employee_count": 8,
      "year_established": 2019,
      "hours_of_operation": "Mon-Fri 6am-8pm, Sat-Sun 8am-2pm",
      "tech_stack": "Mindbody for scheduling, Squarespace website, no CRM visible",
      "revenue_estimate": "$300K-500K annually",
      "founder_story": "Maria left a corporate marketing career in 2019 to open her own studio after 15 years of personal practice",
      "recent_news": [
        {"headline": "Expanded to second location", "date": "2025-11", "url": "https://..."}
      ],
      "competitors": [
        {"name": "Core Power Yoga", "website": "https://corepoweryoga.com", "differentiator": "franchise, less personal"},
        {"name": "Yoga Pod", "website": "https://yogapod.com", "differentiator": "hot yoga focus"}
      ],
      "pain_points": ["No online booking visible on website", "Weak Google Business profile", "No email capture on site"],
      "ideal_service": "Website redesign with integrated booking + SEO optimization for local search",
      "tags": ["owner-operated", "expansion-mode", "tech-underserved", "high-reviews"],
      "preferred_contact_method": "email",
      "best_time_to_contact": "Weekday mornings before 10am (before classes start)",
      "lead_score": 85,
      "research_notes": {"depth": "full", "confidence": "high", "sources": ["google", "yelp", "linkedin", "website"], "methodology": "manual deep research via web search + site audit", "researched_at": "2026-03-31"},
      "email_templates": [
        {
          "subject": "Quick thought on Sunrise Yoga's online booking",
          "body": "Hi Maria — I noticed Sunrise Yoga has incredible reviews (4.7 stars!) but your website doesn't have integrated online booking. I've helped studios like yours increase class bookings by 40% with a simple website upgrade...",
          "approach": "pain-point-specific, compliment-first"
        },
        {
          "subject": "Congrats on the second location!",
          "body": "Hi Maria — saw the news about your expansion. That's a huge milestone. With two locations, having a strong online presence becomes even more important...",
          "approach": "news-hook, growth-oriented"
        }
      ],
      "call_scripts": [
        {
          "opening": "Hi Maria, this is [name] — I'm a local web developer and I've been a fan of Sunrise Yoga. I had a quick idea about your website that might help with bookings.",
          "pitch": "I noticed your site doesn't have integrated booking — students have to call or use Mindbody separately. I've helped studios bring booking right into their website, which typically increases signups by 30-40%.",
          "objection_handling": "Totally understand — the Mindbody integration is actually seamless, we'd just embed it into your existing site. No workflow changes for your team."
        }
      ]
    }
  ],
  "source": "pocket-research",
  "channelId": "1487197981970268201"
}
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "total": 1,
    "inserted": 1,
    "updated": 0,
    "duplicates": 0
  },
  "leads": [
    {"business_name": "Sunrise Yoga Studio", "action": "inserted", "id": "uuid..."}
  ]
}
```

### `GET /leads`

Query leads with optional filters:
```
GET /leads?status=researched&city=Austin&minScore=70&limit=20
```

Returns leads sorted by `lead_score` descending.

### `GET /leads/:id`

Full detail for a single lead.

---

## CSV Storage

When Pocket creates a lead list, the raw CSV is also saved as an artifact:

**Location:** `~/.agent-co/workspace/research/leads/`
**Naming:** `{date}_{source}_{query}.csv` (e.g., `2026-03-31_pocket-research_austin-yoga-studios.csv`)

The endpoint accepts an optional `csvContent` field — a raw CSV string that
gets written to disk before parsing into the database. If not provided, only
the structured `leads` array is processed.

---

## Skill File

**Location:** `~/.agent-co/workspace/context/core/lead-management.md`

Teaches Pocket:
- The full schema and what each field means
- How to call `POST /store-leads` with properly structured data
- Single lead: `{"leads": [{...}]}` — same endpoint, array of one
- Batch: `{"leads": [{...}, {...}], "csvContent": "..."}` — multiple + CSV artifact
- That deduplication is automatic — he doesn't need to check first
- The expected format for JSONB fields (employee_list, email_templates, etc.)
- To save CSV artifacts to `~/.agent-co/workspace/research/leads/`
- The `mode` flag: `"fill"` for new research, `"update"` for corrections
- That the business-guides skills contain the research methodology
- The status lifecycle and when to use each status
- To always populate `research_notes.researched_at` with the current date

### Lead Score Rubric (included in skill file)

| Score | Meaning | Criteria |
|-------|---------|----------|
| 90-100 | **Exceptional fit** | Clear pain point we can solve, owner-operated, tech-underserved, high reviews, growth signals, contactable |
| 70-89 | **Strong fit** | Multiple pain points, good reviews, identifiable decision maker, reasonable contact path |
| 50-69 | **Moderate fit** | Some pain points but unclear if they'd pay, or hard to reach decision maker |
| 30-49 | **Weak fit** | Generic business, no clear pain point, or saturated market |
| 0-29 | **Poor fit** | No identifiable need, bad reviews suggesting deeper problems, or unreachable |

Pocket should score honestly. A database of 20 leads scored 80+ is worth more
than 200 leads scored generously.

### Downstream unlocks (noted in skill file)

Once leads are stored with `email_templates` and `call_scripts`, the outreach
workflows (07-Email Dispatch, 08-Follow-up Sequencer) can pull directly from
the lead record. Pocket should note this in his research_notes when templates
are ready for automated dispatch.

---

## Migration

### SQL changes to `leads.contacts`

```sql
-- Rename existing columns for clarity
ALTER TABLE leads.contacts RENAME COLUMN contact_name TO owner_name;
ALTER TABLE leads.contacts RENAME COLUMN phone TO phone_number;
ALTER TABLE leads.contacts RENAME COLUMN rating TO average_rating;
ALTER TABLE leads.contacts RENAME COLUMN review_count TO total_reviews;
ALTER TABLE leads.contacts RENAME COLUMN validation_score TO lead_score;

-- Drop replaced column
ALTER TABLE leads.contacts DROP COLUMN IF EXISTS is_valid;

-- Add new columns
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS decision_maker_title TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS best_time_to_contact TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS google_places_url TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS yelp_url TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS social_media JSONB;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS online_presence_score INTEGER;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS employee_list JSONB;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS employee_count INTEGER;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS year_established INTEGER;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS hours_of_operation TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS tech_stack TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS revenue_estimate TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS founder_story TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS recent_news JSONB;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS competitors JSONB;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS pain_points JSONB;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS ideal_service TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS referral_source TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS research_notes JSONB;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS source_csv TEXT;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS email_templates JSONB;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS call_scripts JSONB;
ALTER TABLE leads.contacts ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

-- Update dedup_hash to use new formula if needed
-- (existing hash uses email+business_name, new uses business_name+city+state)

-- Add new indexes
CREATE INDEX IF NOT EXISTS leads_contacts_industry_idx ON leads.contacts(industry);
CREATE INDEX IF NOT EXISTS leads_contacts_city_state_idx ON leads.contacts(city, state);
CREATE INDEX IF NOT EXISTS leads_contacts_lead_score_idx ON leads.contacts(lead_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS leads_contacts_tags_idx ON leads.contacts USING GIN (tags);
```

### Dedup hash migration

The existing `dedup_hash` formula is `md5(lower(email || business_name))`.
The new formula is `md5(lower(business_name || '|' || city || '|' || state))`.

This is more robust — many leads don't have emails at initial scrape time.
The migration should update existing hashes:

```sql
UPDATE leads.contacts
SET dedup_hash = md5(lower(business_name || '|' || COALESCE(city, '') || '|' || COALESCE(state, '')))
WHERE business_name IS NOT NULL;
```

---

## Relay Changes

### New endpoint: `POST /store-leads`

1. Accept `{ leads, mode?, source, channelId, csvContent? }`
2. Validate: each lead must have `business_name` at minimum
3. If `csvContent` provided, write CSV to `~/.agent-co/workspace/research/leads/`
4. For each lead (independently — one failure doesn't block others):
   a. Compute `dedup_hash = md5(lower(business_name + '|' + city + '|' + state))`
   b. Truncate `employee_list` to 10 entries if longer
   c. Use `INSERT ... ON CONFLICT (dedup_hash) DO UPDATE` (atomic upsert):
      - `mode: "fill"` — `SET col = COALESCE(leads.contacts.col, EXCLUDED.col)` for scalars,
        array concat + dedup for JSONB arrays, union for tags
      - `mode: "update"` — `SET col = COALESCE(EXCLUDED.col, leads.contacts.col)` for scalars,
        replace for JSONB arrays
   d. Track action per lead: `inserted` | `updated`
5. Create/update `leads.sources` entry for tracking
6. Return summary with per-lead actions and any per-lead errors

### New endpoint: `GET /leads`

Query with filters: `status`, `city`, `state`, `industry`, `minScore`, `tags`, `limit`.
Returns leads sorted by `lead_score` DESC.

### New endpoint: `GET /leads/:id`

Full detail for a single lead by UUID.

---

## Implementation Order

1. Backup database
2. Run migration SQL (rename columns, add new columns, add indexes, status migration)
3. Update `init.sql` for fresh installs (full schema with new column names)
4. Update TypeScript scripts for renamed columns:
   - `scripts/validators/lead-validator.ts` — `is_valid` → `status`, `validation_score` → `lead_score`
   - `scripts/lead-scraper/google-maps.ts` — `review_count` → `total_reviews`
5. Rebuild scripts: `cd scripts && npm run build`
6. Update workflow JSON files for renamed columns:
   - `02-scrape-google-maps.json` — INSERT column names
   - `05-lead-validation.json` — SELECT/UPDATE column names
   - `06-lead-researcher.json` — SELECT column names, WHERE clause
   - `07-email-dispatch.json` — JOIN column names
   - `08-followup-sequencer.json` — JOIN column names
7. Add `POST /store-leads` endpoint to relay (with upsert, mode flag, CSV storage)
8. Add `GET /leads` and `GET /leads/:id` endpoints to relay
9. Create lead-management skill file at `~/.agent-co/workspace/context/core/lead-management.md`
10. Add skill to core preamble in workflow 10
11. Add skill to compaction reload list in relay
12. Build relay, restart, reload workflows
13. Test: store a lead via endpoint, verify dedup, query back
14. Test: store duplicate with mode=fill, verify merge behavior
15. Test: store duplicate with mode=update, verify overwrite behavior
16. Test: GET /leads with filters
17. Test: Pocket uses the skill to store leads from Discord

---

## Edge Cases

- **Missing city/state**: dedup hash uses `COALESCE(city, '') || COALESCE(state, '')`.
  Two businesses with the same name but no location info will collide — acceptable,
  as ambiguous leads should be reviewed.
- **Employee list cap**: Keep at most 10 employees — the top decision makers and
  key contacts. No need for the full org chart. The endpoint truncates to 10 on
  insert. The CSV should also cap at 10 per row. The skill instructs Pocket to
  prioritize owners, managers, and department heads.
- **Duplicate email_templates on merge**: In `fill` mode, templates are concatenated
  then deduplicated by `subject` field. In `update` mode, the array is replaced entirely.
- **CSV format spec**: The skill gives Pocket exact CSV column headers that map
  to database fields. Required headers: `business_name,city,state`. All others
  optional. JSONB fields (employee_list, email_templates, etc.) are stored as
  JSON strings within the CSV cell. The endpoint parses them on ingestion. Example:
  ```
  business_name,city,state,owner_name,email,phone_number,website,lead_score,tags
  "Sunrise Yoga","Austin","TX","Maria Chen","info@sunriseyoga.com","555-0142","https://sunriseyoga.com",85,"owner-operated,high-reviews"
  ```
  Tags are comma-separated within the cell (no brackets). JSONB fields use valid
  JSON strings (the endpoint parses them). Non-JSONB fields are plain text.
- **Null lead_score**: When Pocket doesn't have enough info to score, `lead_score`
  is null. The query endpoint handles `NULLS LAST` in sort order.
- **Tag-based queries**: The `TEXT[]` type with GIN index supports `@>` (contains)
  queries: `WHERE tags @> ARRAY['high-value']`.
- **Single lead vs batch**: Endpoint accepts both. `{"leads": [{...}]}` for one,
  `{"leads": [{...}, {...}]}` for many. The relay normalizes internally.
- **Re-research with mode=update**: When Pocket intentionally re-researches a
  business, he sends `mode: "update"` to overwrite stale data. The `research_notes`
  field should always include `researched_at` so data freshness is traceable.
- **business_name variations**: "Sunrise Yoga Studio" vs "Sunrise Yoga" produce
  different hashes. Pocket should be consistent in naming. The skill file instructs
  him to use the full official business name from Google Places or the website.
- **Column renames ripple across codebase**: Verified impact — the renames affect:
  - `scripts/validators/lead-validator.ts` — references `is_valid`, `validation_score`
  - `scripts/lead-scraper/google-maps.ts` — references `review_count`
  - `workflows/02-scrape-google-maps.json` — INSERT uses `phone`, `rating`, `review_count`
  - `workflows/05-lead-validation.json` — SELECT/UPDATE uses `is_valid`, `validation_score`
  - `workflows/06-lead-researcher.json` — SELECT uses `contact_name`, `rating`, `review_count`, `is_valid`, `validation_score`
  - `workflows/07-email-dispatch.json` — JOIN uses `contact_name`
  - `workflows/08-followup-sequencer.json` — JOIN uses `contact_name`
  All of these must be updated as part of the migration. Implementation order:
  run SQL renames → update TypeScript scripts → rebuild scripts → update workflow
  JSONs → re-import workflows.
- **FK constraints**: `outreach.emails` and `crm.companies` reference `leads.contacts(id)`.
  Column renames don't affect FKs (they reference the column object, not the name).
  The `is_valid` column is referenced in workflows 05 and 06 as a WHERE filter —
  these queries must be updated to use `status` and `lead_score` instead before
  the column is dropped.
- **Status value migration**: Existing leads with `status = 'validated'` need mapping
  to the new lifecycle. `'validated'` → `'researched'` (or `'not_contacted'` if
  outreach templates exist). `'invalid'` → `'lost'`. Add to migration SQL:
  ```sql
  UPDATE leads.contacts SET status = 'researched' WHERE status = 'validated';
  UPDATE leads.contacts SET status = 'lost' WHERE status = 'invalid';
  ```
- **Concurrent writes**: Two calls to `POST /store-leads` with the same business
  could race on the dedup check. Use `INSERT ... ON CONFLICT (dedup_hash) DO UPDATE`
  (upsert) instead of separate SELECT + INSERT/UPDATE to make it atomic.
- **Large batch performance**: Inserting 100+ leads in a single request should use
  a transaction. If one lead fails validation (missing business_name), the others
  should still succeed. Process each lead independently, collect results, report
  per-lead status in the response.
- **Relay request size**: A batch of 50 richly-populated leads with templates could
  be 500KB+. The relay already has `express.json({ limit: '10mb' })` so this is fine,
  but Pocket should be aware that very large batches may timeout. The skill should
  recommend batches of 20-30 leads max per call.
