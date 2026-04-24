import nodemailer from 'nodemailer';

// ----------------------------------------------------------------
// Create transporter from environment variables
// These are injected by docker-compose from the .env file
// ----------------------------------------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT ?? '587', 10),
  secure: false,    // false = STARTTLS on port 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export interface SendOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
}

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

/**
 * Send a single email.
 */
export async function send(options: SendOptions): Promise<SendResult> {
  const fromName = process.env.SMTP_FROM_NAME ?? 'Agent Company';
  const fromAddr = process.env.SMTP_USER;

  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromAddr}>`,
    ...options,
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted as string[],
    rejected: info.rejected as string[],
  };
}

// ----------------------------------------------------------------
// CLI entry point — used by n8n Execute Command node if needed
// Usage: node sender.js --options '{"to":"...","subject":"...","html":"..."}'
// ----------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const optsIdx = args.indexOf('--options');

  if (optsIdx === -1 || !args[optsIdx + 1]) {
    process.stderr.write('Usage: node sender.js --options \'{...SendOptions...}\'\n');
    process.exit(1);
  }

  const opts: SendOptions = JSON.parse(args[optsIdx + 1]);
  send(opts)
    .then(result => {
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    })
    .catch(e => {
      process.stderr.write(String(e));
      process.exit(1);
    });
}
