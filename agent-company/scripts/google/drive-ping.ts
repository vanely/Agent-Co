/**
 * Sanity check — verifies the OAuth refresh token still works without
 * making any destructive calls. Useful right after running oauth-setup.ts
 * to confirm everything is wired correctly.
 *
 * Usage:
 *   set -a && source ../.env && set +a
 *   npx tsx google/drive-ping.ts
 */
import { drivePing } from './drive-client.js'

async function main() {
  const info = await drivePing()
  console.log('✓ Drive auth working')
  console.log(`  Authorized as: ${info.user}`)
  if (info.storageQuotaBytes) {
    const gb = Number(info.storageQuotaBytes) / (1024 ** 3)
    console.log(`  Storage quota: ${gb.toFixed(2)} GB`)
  }
}

main().catch(err => {
  console.error('✗ Drive ping failed:', err.message ?? err)
  process.exit(1)
})
