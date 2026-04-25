/**
 * One-shot Google OAuth 2.0 setup — captures a refresh token for the
 * Drive API.
 *
 * Drives the "loopback" / installed-app OAuth flow used by desktop tools:
 *
 *   1. Spin up a local HTTP server on 127.0.0.1:<random-port>.
 *   2. Build the authorize URL with our requested scopes + that loopback
 *      port as redirect_uri.
 *   3. Open the user's browser to the URL (or print it for copy-paste).
 *   4. Wait for Google to redirect back to localhost with ?code=XYZ.
 *   5. Exchange the code for a refresh token (server-to-server).
 *   6. Print the refresh token so the user pastes it into agent-company/.env.
 *
 * Run this ONCE per Google account. The refresh token never expires (until
 * manually revoked at https://myaccount.google.com/permissions). All
 * subsequent Drive API calls just use the refresh token to mint short-lived
 * access tokens — no further user interaction.
 *
 * Usage:
 *   cd agent-company/scripts
 *   set -a && source ../.env && set +a
 *   npx tsx google/oauth-setup.ts
 *
 * Required env (interactive prompt if missing):
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 */
import { google } from 'googleapis'
import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Drive scope set: full read + write of files Pocket creates / shares.
// Plus userinfo so we can confirm WHICH Google account just authorized
// (sanity check that vnly didn't accidentally log into the wrong one).
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
]

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(r => rl.question(question, ans => { rl.close(); r(ans.trim()) }))
}

function tryOpenBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' :
              process.platform === 'win32'  ? 'start' : 'xdg-open'
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
  } catch { /* user can copy-paste the URL */ }
}

async function captureCodeViaLoopback(
  clientId: string,
  clientSecret: string,
): Promise<{ code: string; redirectUri: string; oauth2: import('google-auth-library').OAuth2Client }> {
  return new Promise((resolveOuter, rejectOuter) => {
    let server: Server | null = null
    server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
        const code = url.searchParams.get('code')
        const err = url.searchParams.get('error')
        if (err) {
          res.writeHead(400, { 'content-type': 'text/html' })
          res.end(`<h2>OAuth declined: ${err}</h2><p>You can close this tab and re-run the setup script.</p>`)
          server?.close()
          rejectOuter(new Error(`OAuth error: ${err}`))
          return
        }
        if (code) {
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end(`
            <h2>✓ Authorization complete</h2>
            <p>Switch back to your terminal — the refresh token is being printed there.</p>
            <p>You can close this tab.</p>
          `)
          server?.close()
          const addr = server!.address()
          if (!addr || typeof addr === 'string') {
            rejectOuter(new Error('lost server address'))
            return
          }
          const redirectUri = `http://127.0.0.1:${addr.port}/oauth2callback`
          const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
          resolveOuter({ code, redirectUri, oauth2 })
          return
        }
        res.writeHead(404); res.end('not found — waiting for ?code')
      } catch (e: any) {
        res.writeHead(500); res.end(e.message)
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address()
      if (!addr || typeof addr === 'string') {
        rejectOuter(new Error('failed to bind loopback server'))
        return
      }
      const redirectUri = `http://127.0.0.1:${addr.port}/oauth2callback`
      const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
      const authUrl = oauth2.generateAuthUrl({
        access_type: 'offline',  // required to get a refresh token
        prompt: 'consent',        // force refresh token even on re-auth
        scope: SCOPES,
      })
      console.log('\n────────────────────────────────────────────────────────')
      console.log('Open this URL in your browser to authorize:')
      console.log(authUrl)
      console.log('────────────────────────────────────────────────────────')
      console.log('Trying to open it for you. If nothing happens, copy + paste manually.\n')
      tryOpenBrowser(authUrl)
    })

    // Bail-out timer so we don't hang forever if the user wanders off.
    const bailout = setTimeout(() => {
      server?.close()
      rejectOuter(new Error('Timed out after 10 minutes waiting for browser callback'))
    }, 10 * 60 * 1000)
    bailout.unref()
  })
}

async function main() {
  let clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  let clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET

  if (!clientId)     clientId     = await prompt('GOOGLE_OAUTH_CLIENT_ID (from GCP console): ')
  if (!clientSecret) clientSecret = await prompt('GOOGLE_OAUTH_CLIENT_SECRET (from GCP console): ')
  if (!clientId || !clientSecret) {
    console.error('Both client_id and client_secret are required. See docs/GOOGLE-DRIVE-SETUP.md.')
    process.exit(1)
  }

  console.log(`\nUsing client_id ${clientId.slice(0, 18)}…`)

  const { code, oauth2 } = await captureCodeViaLoopback(clientId, clientSecret)

  // Exchange code for tokens.
  const { tokens } = await oauth2.getToken(code)
  if (!tokens.refresh_token) {
    console.error(
      '\nFAILED — Google returned no refresh_token.\n' +
      'Most likely cause: this Google account previously authorized this OAuth client and the\n' +
      'refresh token was issued long ago. Revoke prior consent at\n' +
      '  https://myaccount.google.com/permissions\n' +
      'find the app, revoke, then re-run this script. The `prompt: consent` we set should\n' +
      'normally force a fresh refresh token, but post-revocation guarantees it.',
    )
    process.exit(2)
  }

  // Confirm which account authorized.
  oauth2.setCredentials(tokens)
  const { data: userInfo } = await google.oauth2('v2').userinfo.get({ auth: oauth2 })
  console.log(`\n✓ Authorized as ${userInfo.email}`)

  // Save to a tokens file (.gitignored), AND echo what to paste in .env.
  // Saving to disk in addition to .env so vnly has a paper trail in case
  // .env gets clobbered or reset.
  const here = dirname(fileURLToPath(import.meta.url))
  const tokensPath = resolve(here, '..', '..', '.google-oauth-tokens.json')
  await writeFile(tokensPath, JSON.stringify({
    refresh_token: tokens.refresh_token,
    obtained_at: new Date().toISOString(),
    authorized_as: userInfo.email,
    client_id_prefix: clientId.slice(0, 18),
    scopes: SCOPES,
  }, null, 2), { mode: 0o600 })
  console.log(`\nTokens saved to ${tokensPath} (mode 600).\n`)

  console.log('────────────────────────────────────────────────────────')
  console.log('Add these to agent-company/.env:')
  console.log('────────────────────────────────────────────────────────')
  console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`)
  console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`)
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`)
  console.log('────────────────────────────────────────────────────────\n')
  console.log('Done. The drive-client module reads these on startup; refresh tokens')
  console.log('don\'t expire unless you explicitly revoke them at')
  console.log('https://myaccount.google.com/permissions.\n')
}

main().catch(err => {
  console.error('OAuth setup failed:', err.message ?? err)
  process.exit(1)
})
