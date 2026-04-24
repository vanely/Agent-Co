/**
 * Agent Co brand email sender.
 *
 * Wraps the same SMTP infrastructure as sender.ts (shares SMTP_* env vars)
 * but ships with safer defaults for agent-driven sends:
 *
 *   - Defaults to dry-run. Pass --send to actually transmit. This aligns
 *     with the autonomy ladder: "sending any outbound message to a human"
 *     is Tier 0 (doc 07 § 4). Dry-run default forces explicit opt-in per
 *     invocation, even when invoked autonomously.
 *   - Body from --body-file (not CLI string), so newlines, quotes, and
 *     long posts don't fragment on shell escaping.
 *   - Plain text by default. Pass --html to send HTML. Matches PUBLIC-WRITING
 *     skill preference for plain prose in outbound Agent Co copy.
 *
 * Usage:
 *   cd $AGENT_CO_ROOT/agent-company/scripts
 *   npx tsx email/send-agentco.ts \
 *     --to="recipient@example.com" \
 *     --subject="Your subject here" \
 *     --body-file=/tmp/body.txt \
 *     [--html] \
 *     [--cc="one@x.com,two@y.com"] \
 *     [--bcc="three@z.com"] \
 *     [--reply-to="your-reply-addr@example.com"] \
 *     [--send]
 *
 * Config (from agent-company/.env):
 *   SMTP_USER          - SMTP login (e.g., your-account@gmail.com)
 *   SMTP_PASS          - SMTP password (for Gmail: 16-char app password, spaces removed)
 *   SMTP_FROM_NAME     - Display name on outbound (currently "Agent Co")
 *   SMTP_HOST          - Optional, defaults to "smtp.gmail.com"
 *   SMTP_PORT          - Optional, defaults to 587
 */
import nodemailer from 'nodemailer'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

interface Args {
  to: string
  subject: string
  bodyFile: string
  html: boolean
  cc?: string
  bcc?: string
  replyTo?: string
  send: boolean
}

function parse(): Args {
  const { values } = parseArgs({
    options: {
      to: { type: 'string' },
      subject: { type: 'string' },
      'body-file': { type: 'string' },
      html: { type: 'boolean', default: false },
      cc: { type: 'string' },
      bcc: { type: 'string' },
      'reply-to': { type: 'string' },
      send: { type: 'boolean', default: false },
    },
    strict: true,
  })

  const to = String(values.to ?? '')
  const subject = String(values.subject ?? '')
  const bodyFile = String(values['body-file'] ?? '')

  if (!to || !subject || !bodyFile) {
    console.error('Required: --to, --subject, --body-file')
    console.error('See file header for full usage.')
    process.exit(1)
  }

  return {
    to,
    subject,
    bodyFile,
    html: Boolean(values.html),
    cc: values.cc ? String(values.cc) : undefined,
    bcc: values.bcc ? String(values.bcc) : undefined,
    replyTo: values['reply-to'] ? String(values['reply-to']) : undefined,
    send: Boolean(values.send),
  }
}

async function main(): Promise<void> {
  const args = parse()

  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) {
    console.error('Missing env: SMTP_USER and SMTP_PASS must be set in agent-company/.env')
    console.error('Generate a Gmail app password at https://myaccount.google.com/apppasswords')
    console.error('(2-Step Verification must be enabled first.)')
    process.exit(1)
  }

  const fromName = process.env.SMTP_FROM_NAME ?? 'Agent Co'
  const host = process.env.SMTP_HOST ?? 'smtp.gmail.com'
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10)

  let body: string
  try {
    body = readFileSync(args.bodyFile, 'utf-8')
  } catch (err: any) {
    console.error(`Failed to read body file ${args.bodyFile}: ${err.message}`)
    process.exit(1)
  }

  const mail: nodemailer.SendMailOptions = {
    from: `"${fromName}" <${user}>`,
    to: args.to,
    subject: args.subject,
    ...(args.html ? { html: body } : { text: body }),
    ...(args.cc ? { cc: args.cc } : {}),
    ...(args.bcc ? { bcc: args.bcc } : {}),
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
  }

  if (!args.send) {
    console.log('[DRY RUN] Email prepared but NOT sent.')
    console.log('')
    console.log(`  From:    ${mail.from}`)
    console.log(`  To:      ${mail.to}`)
    if (args.cc) console.log(`  CC:      ${args.cc}`)
    if (args.bcc) console.log(`  BCC:     ${args.bcc}`)
    if (args.replyTo) console.log(`  Reply-To: ${args.replyTo}`)
    console.log(`  Subject: ${mail.subject}`)
    console.log(`  Format:  ${args.html ? 'html' : 'text'}`)
    console.log(`  Length:  ${body.length} chars`)
    console.log('')
    console.log('  --- body ---')
    console.log(body.split('\n').map(l => '  ' + l).join('\n'))
    console.log('  --- /body ---')
    console.log('')
    console.log('To actually send, re-run with --send')
    return
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,       // false = STARTTLS on 587
    requireTLS: true,
    auth: { user, pass },
  })

  try {
    const info = await transporter.sendMail(mail)
    console.log('[SENT]')
    console.log(`  messageId: ${info.messageId}`)
    console.log(`  accepted:  ${(info.accepted as string[]).join(', ')}`)
    const rejected = info.rejected as string[]
    if (rejected.length > 0) {
      console.log(`  rejected:  ${rejected.join(', ')}`)
    }
    console.log(`  response:  ${info.response}`)
  } catch (err: any) {
    console.error(`[FAILED] ${err.message}`)
    process.exit(1)
  }
}

main()
