/**
 * Drive API client for Agent Co.
 *
 * Wraps Google's `googleapis` SDK with the operations Pocket / fleet
 * agents / scripts actually need: list, read, write, upload, find-by-name,
 * create folder. Constructed lazily so the module imports cheap and only
 * pays the OAuth setup cost on first call.
 *
 * Auth: refresh token in env. Refresh tokens never expire (until revoked),
 * so the same env vars work indefinitely after the one-time oauth-setup.ts
 * run.
 *
 * Required env:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REFRESH_TOKEN
 *
 * Common patterns:
 *
 *   // Read a Doc as plain text
 *   const text = await driveReadText('1ABC...xyz')
 *
 *   // Write/create a plain-text file in a folder
 *   await driveWriteText({ name: 'arb-trades-2026-04-25.md',
 *                          parentFolderId: 'FOLDER_ID',
 *                          content: '...' })
 *
 *   // Find a file by exact name in a folder
 *   const f = await driveFindByName('arb-report.md', folderId)
 *
 *   // List files in a folder
 *   const files = await driveListFolder(folderId)
 */
import { google, type drive_v3 } from 'googleapis'
import { Readable } from 'node:stream'

let cachedDrive: drive_v3.Drive | null = null

function getDrive(): drive_v3.Drive {
  if (cachedDrive) return cachedDrive

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Drive client not configured — set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, ' +
      'GOOGLE_OAUTH_REFRESH_TOKEN in agent-company/.env. Run scripts/google/oauth-setup.ts ' +
      'once to obtain the refresh token. See docs/GOOGLE-DRIVE-SETUP.md.',
    )
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials({ refresh_token: refreshToken })
  cachedDrive = google.drive({ version: 'v3', auth: oauth2 })
  return cachedDrive
}

// ─── Reads ──────────────────────────────────────────────────────────────

/** Get metadata for a file by id. Returns null if not found. */
export async function driveGetFile(fileId: string): Promise<drive_v3.Schema$File | null> {
  try {
    const res = await getDrive().files.get({
      fileId,
      fields: 'id, name, mimeType, modifiedTime, size, parents, webViewLink',
    })
    return res.data
  } catch (err: any) {
    if (err.code === 404) return null
    throw err
  }
}

/**
 * Read a file's content as a UTF-8 string. Handles two cases:
 *   - Native binary/text files (.md, .txt, .json, etc.) → straight download
 *   - Google Workspace files (Docs, Sheets, Slides) → exported as text/plain
 *     or text/csv as appropriate
 */
export async function driveReadText(fileId: string): Promise<string> {
  const drive = getDrive()
  const meta = await driveGetFile(fileId)
  if (!meta) throw new Error(`File ${fileId} not found`)

  const mt = meta.mimeType ?? ''
  const isWorkspace = mt.startsWith('application/vnd.google-apps.')

  if (isWorkspace) {
    // Export Google Workspace files to text. Use text/csv for sheets,
    // text/plain for everything else (Docs, Slides become flattened text).
    const exportMime = mt === 'application/vnd.google-apps.spreadsheet'
      ? 'text/csv' : 'text/plain'
    const res = await drive.files.export({ fileId, mimeType: exportMime }, { responseType: 'text' })
    return res.data as string
  }

  // Regular file — download as text.
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' })
  return res.data as string
}

/** List files in a folder. Defaults to non-trashed. */
export async function driveListFolder(
  folderId: string,
  opts: { pageSize?: number; includeTrashed?: boolean } = {},
): Promise<drive_v3.Schema$File[]> {
  const drive = getDrive()
  const trashedClause = opts.includeTrashed ? '' : ' and trashed=false'
  const res = await drive.files.list({
    q: `'${folderId}' in parents${trashedClause}`,
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    pageSize: opts.pageSize ?? 100,
    orderBy: 'modifiedTime desc',
  })
  return res.data.files ?? []
}

/**
 * Find a file by exact name in a folder. Returns null if not found, the
 * file metadata if exactly one matches, or throws if multiple match (the
 * caller probably has a bug). Useful for "create or update" patterns.
 */
export async function driveFindByName(
  name: string,
  folderId: string,
): Promise<drive_v3.Schema$File | null> {
  const drive = getDrive()
  // Escape single quotes in the filename for the query DSL.
  const escaped = name.replace(/'/g, "\\'")
  const res = await drive.files.list({
    q: `name='${escaped}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    pageSize: 10,
  })
  const files = res.data.files ?? []
  if (files.length === 0) return null
  if (files.length > 1) {
    throw new Error(`Ambiguous: ${files.length} files named "${name}" in folder ${folderId}`)
  }
  return files[0]
}

// ─── Writes ─────────────────────────────────────────────────────────────

/**
 * Create or update a plain-text file in Drive. Idempotent on (name,
 * parentFolderId): if a file with that name already exists in the folder,
 * its contents are replaced. Otherwise a new file is created.
 *
 * Use this for log/report files that you want to overwrite cleanly.
 */
export async function driveWriteText(opts: {
  name: string
  parentFolderId: string
  content: string
  /** MIME type of the file you're writing. Default text/markdown. */
  mimeType?: string
}): Promise<{ id: string; webViewLink: string | null; created: boolean }> {
  const drive = getDrive()
  const mimeType = opts.mimeType ?? 'text/markdown'
  const existing = await driveFindByName(opts.name, opts.parentFolderId)

  const media = {
    mimeType,
    body: Readable.from([opts.content]),
  }

  if (existing) {
    const res = await drive.files.update({
      fileId: existing.id!,
      media,
      fields: 'id, webViewLink',
    })
    return { id: res.data.id!, webViewLink: res.data.webViewLink ?? null, created: false }
  }

  const res = await drive.files.create({
    requestBody: {
      name: opts.name,
      parents: [opts.parentFolderId],
      mimeType,
    },
    media,
    fields: 'id, webViewLink',
  })
  return { id: res.data.id!, webViewLink: res.data.webViewLink ?? null, created: true }
}

/**
 * Upload an arbitrary file (binary safe). Buffer in, file id out.
 *
 * For text content, prefer driveWriteText — it's clearer at the call site
 * and handles the create-or-update pattern.
 */
export async function driveUpload(opts: {
  name: string
  parentFolderId: string
  data: Buffer
  mimeType: string
}): Promise<{ id: string; webViewLink: string | null }> {
  const res = await getDrive().files.create({
    requestBody: {
      name: opts.name,
      parents: [opts.parentFolderId],
      mimeType: opts.mimeType,
    },
    media: {
      mimeType: opts.mimeType,
      body: Readable.from([opts.data]),
    },
    fields: 'id, webViewLink',
  })
  return { id: res.data.id!, webViewLink: res.data.webViewLink ?? null }
}

/** Create a folder. Returns its id. Idempotent on (name, parent): reuses
 *  an existing same-named folder if present. */
export async function driveCreateFolder(opts: {
  name: string
  parentFolderId?: string
}): Promise<string> {
  const drive = getDrive()
  // If parent specified, dedupe by name.
  if (opts.parentFolderId) {
    const existing = await driveFindByName(opts.name, opts.parentFolderId)
    if (existing && existing.mimeType === 'application/vnd.google-apps.folder') {
      return existing.id!
    }
  }
  const res = await drive.files.create({
    requestBody: {
      name: opts.name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: opts.parentFolderId ? [opts.parentFolderId] : undefined,
    },
    fields: 'id',
  })
  return res.data.id!
}

/** Delete a file by id. No-op if already deleted. */
export async function driveDelete(fileId: string): Promise<void> {
  try {
    await getDrive().files.delete({ fileId })
  } catch (err: any) {
    if (err.code === 404) return
    throw err
  }
}

/**
 * Sanity ping — fetches "About" info from Drive. Used by setup verification
 * to confirm the refresh token works without making destructive calls.
 */
export async function drivePing(): Promise<{ user: string; storageQuotaBytes: string | null }> {
  const res = await getDrive().about.get({ fields: 'user(emailAddress), storageQuota(limit)' })
  return {
    user: res.data.user?.emailAddress ?? 'unknown',
    storageQuotaBytes: res.data.storageQuota?.limit ?? null,
  }
}
