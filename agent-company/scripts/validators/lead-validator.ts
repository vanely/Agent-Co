import dns from 'dns/promises';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------
interface Lead {
  id: string;
  business_name: string;
  email?: string;
  website?: string;
  phone?: string;
}

interface ValidationResult {
  id: string;
  is_valid: boolean;
  validation_score: number;  // 0-100
  reasons: string[];
}

// ----------------------------------------------------------------
// Validate a single lead
// Scoring:
//   Email format valid:  +20
//   Email domain has MX: +30
//   Business name OK:    +20
//   Website present:     +20
//   Phone present:       +10
//   Total max:            100
//   Threshold for valid:  50
// ----------------------------------------------------------------
async function validateLead(lead: Lead): Promise<ValidationResult> {
  let score = 0;
  const reasons: string[] = [];

  // --- Email format ---
  if (lead.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(lead.email)) {
      score += 20;
      reasons.push('Valid email format');

      // --- MX record check ---
      const domain = lead.email.split('@')[1];
      try {
        const mx = await dns.resolveMx(domain);
        if (mx.length > 0) {
          score += 30;
          reasons.push(`MX records found for ${domain}`);
        } else {
          reasons.push(`No MX records for ${domain}`);
        }
      } catch {
        reasons.push(`MX lookup failed for ${domain}`);
      }
    } else {
      reasons.push('Invalid email format');
    }
  } else {
    reasons.push('No email address provided');
  }

  // --- Business name ---
  if (lead.business_name && lead.business_name.trim().length > 3) {
    score += 20;
    reasons.push('Business name present');
  } else {
    reasons.push('Business name missing or too short');
  }

  // --- Website ---
  if (lead.website && /^https?:\/\/.+/.test(lead.website)) {
    score += 20;
    reasons.push('Website URL present');
  } else {
    reasons.push('No valid website URL');
  }

  // --- Phone ---
  if (lead.phone) {
    const digits = lead.phone.replace(/\D/g, '');
    if (digits.length >= 10) {
      score += 10;
      reasons.push('Phone number present');
    }
  }

  return {
    id: lead.id,
    is_valid: score >= 50,
    validation_score: Math.min(score, 100),
    reasons,
  };
}

// ----------------------------------------------------------------
// CLI entry point
// Called by n8n Execute Command node with:
//   node lead-validator.js --input '[{"id":"...","email":"..."}]'
// Outputs JSON array to stdout.
// ----------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');

  if (inputIdx === -1 || !args[inputIdx + 1]) {
    process.stderr.write('Usage: node lead-validator.js --input \'[...json array of leads...]\'\n');
    process.exit(1);
  }

  let leads: Lead[];
  try {
    leads = JSON.parse(args[inputIdx + 1]);
  } catch {
    process.stderr.write('ERROR: --input must be valid JSON\n');
    process.exit(1);
  }

  if (!Array.isArray(leads)) {
    process.stderr.write('ERROR: --input must be a JSON array\n');
    process.exit(1);
  }

  // Run validations in parallel (DNS lookups can be concurrent)
  const results = await Promise.all(leads.map(validateLead));
  process.stdout.write(JSON.stringify(results));
}

main().catch(e => {
  process.stderr.write(`[validator] FATAL: ${String(e)}\n`);
  process.exit(1);
});
