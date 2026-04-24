import crypto from 'crypto';

/**
 * Generate a deterministic hash for deduplication.
 * Two leads with the same email + business name produce the same hash.
 */
export function dedupHash(email: string, businessName: string): string {
  const normalized = `${email}${businessName}`
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9@._-]/g, '');
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Remove duplicate leads from an array, keeping the first occurrence.
 */
export function deduplicateLeads<T extends { email?: string; business_name: string }>(
  leads: T[]
): T[] {
  const seen = new Set<string>();
  return leads.filter(lead => {
    const hash = dedupHash(lead.email ?? '', lead.business_name);
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}
