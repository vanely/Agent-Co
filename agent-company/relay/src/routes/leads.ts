import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { homedir } from 'os';
import { authMiddleware, dashboardAuth } from '../middleware/auth';
import { getPool } from '../config/db';
import { emitEvent } from '../lib/events';
import { extractError } from '../helpers/errors';

const execAsync = promisify(exec);

export function createLeadsRouter(): Router {
  const router = Router();

  // POST /store-leads
  router.post('/store-leads', authMiddleware, async (req: Request, res: Response) => {
    const { leads = [], mode = 'fill', source = 'pocket-research', csvContent } = req.body;

    const db = getPool();
    if (!db) { res.status(500).json({ success: false, error: 'No database configured' }); return; }

    const researchDir = join(homedir(), '.agent-co', 'workspace', 'research', 'leads');

    // File-first: save CSV before processing
    let csvFilename: string | null = null;
    if (csvContent && typeof csvContent === 'string') {
      try {
        await execAsync(`mkdir -p ${researchDir}`);
        const timestamp = new Date().toISOString().slice(0, 10);
        const safeSrc = (source || 'import').replace(/[^a-zA-Z0-9-_]/g, '-');
        csvFilename = `${timestamp}_${safeSrc}.csv`;
        const { writeFile } = require('fs/promises');
        await writeFile(join(researchDir, csvFilename), csvContent);
      } catch { /* non-fatal */ }
    }

    if ((!leads || leads.length === 0) && csvFilename) {
      res.json({ success: true, file: csvFilename, processing: 'file-saved', message: 'CSV saved. Pass parsed leads in the leads array for database storage.' });
      return;
    }

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      res.status(400).json({ success: false, error: 'leads array is required and must not be empty' });
      return;
    }

    let sourceId: string | null = null;
    try {
      const srcResult = await db.query(
        `INSERT INTO leads.sources (name, query, location, category) VALUES ($1, $2, $3, $4) RETURNING id`,
        [source, `batch-${new Date().toISOString()}`, null, null]
      );
      sourceId = srcResult.rows[0]?.id ?? null;
    } catch { /* non-fatal */ }

    const results: Array<{ business_name: string; action: string; id?: string; error?: string }> = [];
    let inserted = 0;
    let updated = 0;

    for (const lead of leads) {
      try {
        if (!lead.business_name) {
          results.push({ business_name: '(missing)', action: 'error', error: 'business_name is required' });
          continue;
        }

        const hashInput = `${lead.business_name}|${lead.city || ''}|${lead.state || ''}`.toLowerCase();
        const { rows: [{ md5: dedupHash }] } = await db.query('SELECT md5($1)', [hashInput]);

        if (Array.isArray(lead.employee_list) && lead.employee_list.length > 10) {
          lead.employee_list = lead.employee_list.slice(0, 10);
        }

        const isUpdate = mode === 'update';

        const upsertResult = await db.query(
          `INSERT INTO leads.contacts (
            source_id, business_name, owner_name, decision_maker_title,
            email, owner_email, phone_number, preferred_contact_method, best_time_to_contact,
            website, address, city, state,
            google_places_url, yelp_url, linkedin_url, social_media, online_presence_score,
            category, industry, average_rating, total_reviews,
            employee_list, employee_count, year_established, hours_of_operation,
            tech_stack, revenue_estimate, founder_story,
            recent_news, competitors, pain_points, ideal_service,
            tags, referral_source,
            raw_data, research_notes, lead_score, source_csv,
            email_templates, call_scripts, last_contacted_at,
            dedup_hash, status
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18, $19, $20, $21, $22,
            $23, $24, $25, $26, $27, $28, $29,
            $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44
          )
          ON CONFLICT (dedup_hash) DO UPDATE SET
            source_id = ${isUpdate ? 'COALESCE(EXCLUDED.source_id, leads.contacts.source_id)' : 'COALESCE(leads.contacts.source_id, EXCLUDED.source_id)'},
            owner_name = ${isUpdate ? 'COALESCE(EXCLUDED.owner_name, leads.contacts.owner_name)' : 'COALESCE(leads.contacts.owner_name, EXCLUDED.owner_name)'},
            decision_maker_title = ${isUpdate ? 'COALESCE(EXCLUDED.decision_maker_title, leads.contacts.decision_maker_title)' : 'COALESCE(leads.contacts.decision_maker_title, EXCLUDED.decision_maker_title)'},
            email = ${isUpdate ? 'COALESCE(EXCLUDED.email, leads.contacts.email)' : 'COALESCE(leads.contacts.email, EXCLUDED.email)'},
            owner_email = ${isUpdate ? 'COALESCE(EXCLUDED.owner_email, leads.contacts.owner_email)' : 'COALESCE(leads.contacts.owner_email, EXCLUDED.owner_email)'},
            phone_number = ${isUpdate ? 'COALESCE(EXCLUDED.phone_number, leads.contacts.phone_number)' : 'COALESCE(leads.contacts.phone_number, EXCLUDED.phone_number)'},
            preferred_contact_method = ${isUpdate ? 'COALESCE(EXCLUDED.preferred_contact_method, leads.contacts.preferred_contact_method)' : 'COALESCE(leads.contacts.preferred_contact_method, EXCLUDED.preferred_contact_method)'},
            best_time_to_contact = ${isUpdate ? 'COALESCE(EXCLUDED.best_time_to_contact, leads.contacts.best_time_to_contact)' : 'COALESCE(leads.contacts.best_time_to_contact, EXCLUDED.best_time_to_contact)'},
            website = ${isUpdate ? 'COALESCE(EXCLUDED.website, leads.contacts.website)' : 'COALESCE(leads.contacts.website, EXCLUDED.website)'},
            address = ${isUpdate ? 'COALESCE(EXCLUDED.address, leads.contacts.address)' : 'COALESCE(leads.contacts.address, EXCLUDED.address)'},
            city = ${isUpdate ? 'COALESCE(EXCLUDED.city, leads.contacts.city)' : 'COALESCE(leads.contacts.city, EXCLUDED.city)'},
            state = ${isUpdate ? 'COALESCE(EXCLUDED.state, leads.contacts.state)' : 'COALESCE(leads.contacts.state, EXCLUDED.state)'},
            google_places_url = ${isUpdate ? 'COALESCE(EXCLUDED.google_places_url, leads.contacts.google_places_url)' : 'COALESCE(leads.contacts.google_places_url, EXCLUDED.google_places_url)'},
            yelp_url = ${isUpdate ? 'COALESCE(EXCLUDED.yelp_url, leads.contacts.yelp_url)' : 'COALESCE(leads.contacts.yelp_url, EXCLUDED.yelp_url)'},
            linkedin_url = ${isUpdate ? 'COALESCE(EXCLUDED.linkedin_url, leads.contacts.linkedin_url)' : 'COALESCE(leads.contacts.linkedin_url, EXCLUDED.linkedin_url)'},
            social_media = ${isUpdate ? 'COALESCE(EXCLUDED.social_media, leads.contacts.social_media)' : 'COALESCE(leads.contacts.social_media, EXCLUDED.social_media)'},
            online_presence_score = ${isUpdate ? 'COALESCE(EXCLUDED.online_presence_score, leads.contacts.online_presence_score)' : 'COALESCE(leads.contacts.online_presence_score, EXCLUDED.online_presence_score)'},
            category = ${isUpdate ? 'COALESCE(EXCLUDED.category, leads.contacts.category)' : 'COALESCE(leads.contacts.category, EXCLUDED.category)'},
            industry = ${isUpdate ? 'COALESCE(EXCLUDED.industry, leads.contacts.industry)' : 'COALESCE(leads.contacts.industry, EXCLUDED.industry)'},
            average_rating = ${isUpdate ? 'COALESCE(EXCLUDED.average_rating, leads.contacts.average_rating)' : 'COALESCE(leads.contacts.average_rating, EXCLUDED.average_rating)'},
            total_reviews = ${isUpdate ? 'COALESCE(EXCLUDED.total_reviews, leads.contacts.total_reviews)' : 'COALESCE(leads.contacts.total_reviews, EXCLUDED.total_reviews)'},
            employee_list = ${isUpdate ? 'EXCLUDED.employee_list' : 'COALESCE(leads.contacts.employee_list, EXCLUDED.employee_list)'},
            employee_count = ${isUpdate ? 'COALESCE(EXCLUDED.employee_count, leads.contacts.employee_count)' : 'COALESCE(leads.contacts.employee_count, EXCLUDED.employee_count)'},
            year_established = ${isUpdate ? 'COALESCE(EXCLUDED.year_established, leads.contacts.year_established)' : 'COALESCE(leads.contacts.year_established, EXCLUDED.year_established)'},
            hours_of_operation = ${isUpdate ? 'COALESCE(EXCLUDED.hours_of_operation, leads.contacts.hours_of_operation)' : 'COALESCE(leads.contacts.hours_of_operation, EXCLUDED.hours_of_operation)'},
            tech_stack = ${isUpdate ? 'COALESCE(EXCLUDED.tech_stack, leads.contacts.tech_stack)' : 'COALESCE(leads.contacts.tech_stack, EXCLUDED.tech_stack)'},
            revenue_estimate = ${isUpdate ? 'COALESCE(EXCLUDED.revenue_estimate, leads.contacts.revenue_estimate)' : 'COALESCE(leads.contacts.revenue_estimate, EXCLUDED.revenue_estimate)'},
            founder_story = ${isUpdate ? 'COALESCE(EXCLUDED.founder_story, leads.contacts.founder_story)' : 'COALESCE(leads.contacts.founder_story, EXCLUDED.founder_story)'},
            recent_news = ${isUpdate ? 'EXCLUDED.recent_news' : 'COALESCE(leads.contacts.recent_news, EXCLUDED.recent_news)'},
            competitors = ${isUpdate ? 'EXCLUDED.competitors' : 'COALESCE(leads.contacts.competitors, EXCLUDED.competitors)'},
            pain_points = ${isUpdate ? 'EXCLUDED.pain_points' : 'COALESCE(leads.contacts.pain_points, EXCLUDED.pain_points)'},
            ideal_service = ${isUpdate ? 'COALESCE(EXCLUDED.ideal_service, leads.contacts.ideal_service)' : 'COALESCE(leads.contacts.ideal_service, EXCLUDED.ideal_service)'},
            tags = (SELECT array_agg(DISTINCT t) FROM unnest(COALESCE(leads.contacts.tags, '{}') || COALESCE(EXCLUDED.tags, '{}')) AS t),
            referral_source = ${isUpdate ? 'COALESCE(EXCLUDED.referral_source, leads.contacts.referral_source)' : 'COALESCE(leads.contacts.referral_source, EXCLUDED.referral_source)'},
            research_notes = ${isUpdate ? 'COALESCE(EXCLUDED.research_notes, leads.contacts.research_notes)' : 'COALESCE(leads.contacts.research_notes, EXCLUDED.research_notes)'},
            lead_score = ${isUpdate ? 'COALESCE(EXCLUDED.lead_score, leads.contacts.lead_score)' : 'COALESCE(leads.contacts.lead_score, EXCLUDED.lead_score)'},
            source_csv = COALESCE(EXCLUDED.source_csv, leads.contacts.source_csv),
            email_templates = ${isUpdate ? 'EXCLUDED.email_templates' : 'COALESCE(leads.contacts.email_templates, EXCLUDED.email_templates)'},
            call_scripts = ${isUpdate ? 'EXCLUDED.call_scripts' : 'COALESCE(leads.contacts.call_scripts, EXCLUDED.call_scripts)'},
            updated_at = NOW()
          RETURNING id, (xmax = 0) AS was_inserted`,
          [
            sourceId, lead.business_name, lead.owner_name ?? null, lead.decision_maker_title ?? null,
            lead.email ?? null, lead.owner_email ?? null, lead.phone_number ?? null,
            lead.preferred_contact_method ?? null, lead.best_time_to_contact ?? null,
            lead.website ?? null, lead.address ?? null, lead.city ?? null, lead.state ?? null,
            lead.google_places_url ?? null, lead.yelp_url ?? null, lead.linkedin_url ?? null,
            lead.social_media ? JSON.stringify(lead.social_media) : null, lead.online_presence_score ?? null,
            lead.category ?? null, lead.industry ?? null, lead.average_rating ?? null, lead.total_reviews ?? null,
            lead.employee_list ? JSON.stringify(lead.employee_list) : null,
            lead.employee_count ?? null, lead.year_established ?? null, lead.hours_of_operation ?? null,
            lead.tech_stack ?? null, lead.revenue_estimate ?? null, lead.founder_story ?? null,
            lead.recent_news ? JSON.stringify(lead.recent_news) : null,
            lead.competitors ? JSON.stringify(lead.competitors) : null,
            lead.pain_points ? JSON.stringify(lead.pain_points) : null,
            lead.ideal_service ?? null, lead.tags ?? null, lead.referral_source ?? null,
            lead.raw_data ? JSON.stringify(lead.raw_data) : null,
            lead.research_notes ? JSON.stringify(lead.research_notes) : null,
            lead.lead_score ?? null, csvFilename ?? lead.source_csv ?? null,
            lead.email_templates ? JSON.stringify(lead.email_templates) : null,
            lead.call_scripts ? JSON.stringify(lead.call_scripts) : null,
            lead.last_contacted_at ?? null, dedupHash, lead.status ?? 'new',
          ]
        );

        const row = upsertResult.rows[0];
        if (row.was_inserted) { inserted++; results.push({ business_name: lead.business_name, action: 'inserted', id: row.id }); }
        else { updated++; results.push({ business_name: lead.business_name, action: 'updated', id: row.id }); }
      } catch (err: unknown) {
        results.push({ business_name: lead.business_name ?? '(unknown)', action: 'error', error: extractError(err) });
      }
    }

    emitEvent({ eventType: 'lead.batch', source: 'relay', level: 'info', data: { inserted, updated, errors: results.filter(r => r.action === 'error').length } });
    res.json({ success: true, summary: { total: leads.length, inserted, updated, errors: results.filter(r => r.action === 'error').length }, file: csvFilename, leads: results });
  });

  // GET /leads
  router.get('/leads', authMiddleware, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    const { status, city, state, industry, minScore, tags, limit = '20' } = req.query;
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (status) { conditions.push(`status = $${paramIdx++}`); params.push(String(status)); }
    if (city) { conditions.push(`city = $${paramIdx++}`); params.push(String(city)); }
    if (state) { conditions.push(`state = $${paramIdx++}`); params.push(String(state)); }
    if (industry) { conditions.push(`industry = $${paramIdx++}`); params.push(String(industry)); }
    if (minScore) { conditions.push(`lead_score >= $${paramIdx++}`); params.push(Number(minScore)); }
    if (tags) { conditions.push(`tags @> $${paramIdx++}`); params.push(String(tags).split(',').map(t => t.trim()) as unknown as string); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 500);
    params.push(safeLimit);

    const result = await db.query(`SELECT * FROM leads.contacts ${where} ORDER BY lead_score DESC NULLS LAST LIMIT $${paramIdx}`, params);
    res.json({ total: result.rows.length, leads: result.rows });
  });

  // GET /leads/facets — cascading filter options
  router.get('/leads/facets', authMiddleware, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    const { status, state, city, industry } = req.query;
    const conditions: string[] = [];
    const params: string[] = [];
    let idx = 1;

    if (status) { conditions.push(`status = $${idx++}`); params.push(String(status)); }
    if (state) { conditions.push(`state = $${idx++}`); params.push(String(state)); }
    if (city) { conditions.push(`city = $${idx++}`); params.push(String(city)); }
    if (industry) { conditions.push(`industry = $${idx++}`); params.push(String(industry)); }

    const baseWhere = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    const [states, cities, industries, statuses] = await Promise.all([
      db.query(`SELECT DISTINCT state FROM leads.contacts WHERE state IS NOT NULL AND ${baseWhere} ORDER BY state`, params),
      db.query(`SELECT DISTINCT city FROM leads.contacts WHERE city IS NOT NULL AND ${baseWhere} ORDER BY city`, params),
      db.query(`SELECT DISTINCT industry FROM leads.contacts WHERE industry IS NOT NULL AND ${baseWhere} ORDER BY industry`, params),
      db.query(`SELECT DISTINCT status FROM leads.contacts WHERE ${baseWhere} ORDER BY status`, params),
    ]);

    res.json({
      states: states.rows.map((r: { state: string }) => r.state),
      cities: cities.rows.map((r: { city: string }) => r.city),
      industries: industries.rows.map((r: { industry: string }) => r.industry),
      statuses: statuses.rows.map((r: { status: string }) => r.status),
    });
  });

  // GET /leads/:id
  router.get('/leads/:id', authMiddleware, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }
    const result = await db.query('SELECT * FROM leads.contacts WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Lead not found' }); return; }
    res.json(result.rows[0]);
  });

  // PATCH /leads/:id
  router.patch('/leads/:id', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database' }); return; }

    const updates = req.body;
    if (!updates || Object.keys(updates).length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

    const allowed = new Set([
      'owner_name', 'decision_maker_title', 'email', 'owner_email', 'phone_number',
      'preferred_contact_method', 'best_time_to_contact', 'website', 'address', 'city', 'state',
      'google_places_url', 'yelp_url', 'linkedin_url', 'social_media', 'online_presence_score',
      'category', 'industry', 'average_rating', 'total_reviews', 'employee_list', 'employee_count',
      'year_established', 'hours_of_operation', 'tech_stack', 'revenue_estimate', 'founder_story',
      'recent_news', 'competitors', 'pain_points', 'ideal_service', 'tags', 'referral_source',
      'research_notes', 'lead_score', 'email_templates', 'call_scripts', 'status', 'last_contacted_at',
    ]);

    const jsonFields = new Set(['social_media', 'employee_list', 'recent_news', 'competitors', 'pain_points', 'research_notes', 'email_templates', 'call_scripts']);
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (!allowed.has(key)) continue;
      if (jsonFields.has(key) && typeof value === 'object') {
        setClauses.push(`${key} = $${idx++}::jsonb`);
        params.push(JSON.stringify(value));
      } else {
        setClauses.push(`${key} = $${idx++}`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) { res.status(400).json({ error: 'No valid fields to update' }); return; }
    setClauses.push('updated_at = NOW()');
    params.push(req.params.id);

    try {
      const result = await db.query(`UPDATE leads.contacts SET ${setClauses.join(', ')} WHERE id = $${idx}::uuid RETURNING id, business_name`, params);
      if (result.rows.length === 0) { res.status(404).json({ error: 'Lead not found' }); return; }

      emitEvent({ eventType: 'lead.updated', source: 'dashboard', level: 'info', data: { leadId: req.params.id, fields: Object.keys(updates) } });
      res.json({ success: true, lead: result.rows[0] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  // DELETE /leads/:id
  router.delete('/leads/:id', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database' }); return; }

    const refs = await db.query('SELECT COUNT(*) as count FROM outreach.emails WHERE lead_id = $1::uuid', [req.params.id]);
    if (parseInt(refs.rows[0].count) > 0) {
      res.status(409).json({ error: 'Lead has outreach emails linked. Delete those first.' });
      return;
    }

    const result = await db.query('DELETE FROM leads.contacts WHERE id = $1::uuid RETURNING id, business_name', [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Lead not found' }); return; }

    emitEvent({ eventType: 'lead.deleted', source: 'dashboard', level: 'warn', data: { leadId: req.params.id, businessName: result.rows[0].business_name } });
    res.json({ success: true, deleted: result.rows[0] });
  });

  return router;
}
