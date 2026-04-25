# Google Drive Setup — read/write Drive from Agent Co

One-time setup. After this, every script and the relay can read and write files in `optimized.market@gmail.com`'s Drive without further auth. Refresh tokens don't expire unless you explicitly revoke them.

**Cost: $0.** No billing account needed, no card on file. The Drive API is free under quotas you'll never approach (1B requests/day per project; we use ≤100/day). The "Google Cloud project" you'll create is just a namespace for the OAuth credential — not a billable resource.

---

## What you do (≈10 minutes, all in your browser)

### 1. Create a Google Cloud project

- Go to **https://console.cloud.google.com**
- Sign in as `optimized.market@gmail.com`
- Top-left, click the project picker → **"New Project"**
- Name: `agent-co` (or anything)
- Organization: leave as is (likely "No organization")
- Click **Create**
- Wait ~30 seconds for it to provision; the project picker will show it

### 2. Enable the Drive API

- With your new project selected, go to **https://console.cloud.google.com/apis/library/drive.googleapis.com**
- Click **Enable**
- Wait a few seconds; the page reloads showing API metrics (all zeros)

### 3. Configure the OAuth consent screen

- Go to **APIs & Services → OAuth consent screen** (or directly: https://console.cloud.google.com/apis/credentials/consent)
- User Type: **External** → **Create**
- Fill the form:
  - **App name**: `Agent Co`
  - **User support email**: `optimized.market@gmail.com`
  - **Developer contact email**: `optimized.market@gmail.com`
  - Everything else: leave blank
- Click **Save and Continue**
- Scopes screen: skip (don't add scopes here — the script asks for them at runtime). Click **Save and Continue**
- Test users: click **Add Users**, enter `optimized.market@gmail.com`, save. Then **Save and Continue**.
- Summary screen: **Back to Dashboard**

> **Note:** The consent screen will show "App isn't verified" when you authorize. That's normal for personal-use apps. You'll click **Advanced → Go to Agent Co (unsafe)** in step 6. "Unsafe" is just Google's stock language for "this isn't a Google-verified production app" — it's safe because you wrote it.

### 4. Create OAuth credentials

- Go to **APIs & Services → Credentials** (https://console.cloud.google.com/apis/credentials)
- Click **+ Create Credentials → OAuth client ID**
- Application type: **Desktop app**
- Name: `Agent Co local`
- Click **Create**
- A modal pops up with **Client ID** and **Client Secret**. Copy both. (You can also redownload them later by clicking the credential row.)

### 5. Run the setup script

Open a terminal and run:

```bash
cd /home/vnly/Projects/agent-co/agent-company/scripts
set -a && source ../.env && set +a
GOOGLE_OAUTH_CLIENT_ID='<paste-client-id>' \
GOOGLE_OAUTH_CLIENT_SECRET='<paste-client-secret>' \
npx tsx google/oauth-setup.ts
```

The script will:

- Spin up a local HTTP server on a random `127.0.0.1:port`
- Print and try to open a Google authorize URL in your browser
- Wait for you to click through the consent screen

### 6. Click through the consent screen

- Choose `optimized.market@gmail.com` (sign in if needed)
- You'll see "Google hasn't verified this app" → **Advanced → Go to Agent Co (unsafe)**
- Click **Continue** to grant Drive access
- Browser tab shows "Authorization complete — you can close this tab"
- Back in your terminal, the script prints the refresh token

### 7. Save the refresh token to `.env`

The script prints three lines like:

```
GOOGLE_OAUTH_CLIENT_ID=<id>
GOOGLE_OAUTH_CLIENT_SECRET=<secret>
GOOGLE_OAUTH_REFRESH_TOKEN=<long-token>
```

Paste those into `agent-company/.env` (replacing the empty placeholders that already exist there). The script also writes a backup copy to `agent-company/.google-oauth-tokens.json` (mode 600, gitignored) so you have a paper trail.

### 8. Verify

```bash
cd agent-company/scripts
set -a && source ../.env && set +a
npx tsx google/drive-ping.ts
```

You should see:

```
✓ Drive auth working
  Authorized as: optimized.market@gmail.com
  Storage quota: 15.00 GB
```

If that prints, you're done. Drive is fully wired into the stack.

---

## What it gives the stack

The runtime client is `agent-company/scripts/google/drive-client.ts`. It exposes:

| function | what it does |
|---|---|
| `driveReadText(fileId)` | Read a file as UTF-8 string. Native files download directly; Google Docs/Sheets/Slides export to plain text or CSV |
| `driveWriteText({name, parentFolderId, content})` | Create or update a file by name in a folder. Idempotent on (name, folder) — overwrites in place |
| `driveUpload({name, parentFolderId, data, mimeType})` | Upload arbitrary binary data (Buffer in, file id out) |
| `driveListFolder(folderId)` | List files in a folder, ordered by recency |
| `driveFindByName(name, folderId)` | Find one file by exact name in a folder |
| `driveCreateFolder({name, parentFolderId?})` | Create folder, idempotent on (name, parent) |
| `driveDelete(fileId)` | Delete a file (no-op if already gone) |
| `drivePing()` | Sanity check — confirms auth without modifying anything |

Import from anywhere in agent-co:

```ts
import { driveWriteText } from '../google/drive-client.js'

await driveWriteText({
  name: 'arb-trades-2026-04-25.md',
  parentFolderId: '1ABC...xyz',  // a Drive folder you own
  content: '# Trade log\n\n...',
})
```

To find a folder ID: open it in Drive in a browser, the URL is `drive.google.com/drive/folders/<this-is-the-folder-id>`.

---

## Failure modes + fixes

**"redirect_uri_mismatch" during step 6**
The Desktop app credential type accepts loopback URIs without registering them. If you get this error, double-check you picked **Desktop app** (not Web application) in step 4.

**"This app is blocked" during step 6**
You're not in the Test Users list. Go back to OAuth consent → Test users → add `optimized.market@gmail.com`.

**Setup script returns no refresh_token**
Google sometimes withholds a refresh token if the same OAuth client previously authorized this account. Fix: visit https://myaccount.google.com/permissions, find "Agent Co", revoke, then re-run the setup script.

**"invalid_grant" later**
The refresh token was revoked (manually, or by Google's anti-abuse system after long inactivity). Re-run `oauth-setup.ts` to mint a fresh one and update `.env`.

**Want to revoke entirely**
https://myaccount.google.com/permissions → find Agent Co → Remove access. After this, all stored refresh tokens become invalid until you re-do the consent flow.
