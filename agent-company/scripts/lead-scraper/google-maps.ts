import { dedupHash } from './dedup';
import { getMemory, end } from '../utils/db';

// ----------------------------------------------------------------
// Output type — every scraper MUST return this shape
// so that the n8n workflow can handle all scrapers uniformly
// ----------------------------------------------------------------
export interface ScrapedLead {
  business_name: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  category?: string;
  rating?: number;
  review_count?: number;
  raw_data: Record<string, unknown>;
  dedup_hash: string;  // must be populated before returning
}

// ----------------------------------------------------------------
// Parse CLI args helper
// ----------------------------------------------------------------
function getArg(flag: string, fallback = ''): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

// ----------------------------------------------------------------
// Main scraper function
// TODO: Replace this stub with your actual Google Maps scraping logic.
//
// Guidelines:
// - Use getMemory('google-maps-scraper', `cursor:${query}:${location}`)
//   to resume from a previous page token or offset
// - Use setMemory(...) to save the cursor after each page
// - Return at most 25-50 results per invocation to keep runtime short
// - Handle rate limiting with exponential backoff
// ----------------------------------------------------------------
async function scrapeGoogleMaps(
  query: string,
  location: string,
  page: number
): Promise<ScrapedLead[]> {
  // Load any saved cursor/state from memory
  const savedState = await getMemory(
    'google-maps-scraper',
    `state:${query}:${location}`
  ) as Record<string, unknown> | null;

  console.error(`[google-maps] Scraping: "${query}" in "${location}" page ${page}`);
  console.error(`[google-maps] Saved state: ${JSON.stringify(savedState)}`);

  // ----------------------------------------------------------------
  // STUB — replace with real implementation
  // ----------------------------------------------------------------
  const results: ScrapedLead[] = [];

  // Example of what a real result looks like:
  // results.push({
  //   business_name: 'Example Fitness Studio',
  //   email: 'hello@example.com',
  //   phone: '617-555-0123',
  //   website: 'https://example.com',
  //   address: '123 Main St',
  //   city: 'Boston',
  //   state: 'MA',
  //   category: 'Fitness Studio',
  //   rating: 4.7,
  //   review_count: 142,
  //   raw_data: { place_id: '...', ... },
  //   dedup_hash: '', // set below
  // });

  // Attach dedup hash to every result
  return results.map(r => ({
    ...r,
    dedup_hash: dedupHash(r.email ?? '', r.business_name),
  }));
}

// ----------------------------------------------------------------
// CLI entry point
// ----------------------------------------------------------------
async function main(): Promise<void> {
  const query    = getArg('--query');
  const location = getArg('--location');
  const page     = parseInt(getArg('--page', '0'), 10);

  if (!query) {
    process.stderr.write('ERROR: --query is required\n');
    process.exit(1);
  }
  if (!location) {
    process.stderr.write('ERROR: --location is required\n');
    process.exit(1);
  }

  try {
    const results = await scrapeGoogleMaps(query, location, page);
    // Output JSON array to stdout — n8n reads this
    process.stdout.write(JSON.stringify(results));
  } finally {
    await end();
  }
}

main().catch(e => {
  process.stderr.write(`[google-maps] FATAL: ${String(e)}\n`);
  process.exit(1);
});
