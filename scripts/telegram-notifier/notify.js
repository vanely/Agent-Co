#!/usr/bin/env node
/**
 * Telegram Notifier — sends updates to vnly from my autonomous work.
 *
 * Usage:
 *   node notify.js "Your message here"
 *   echo "message" | node notify.js
 *
 * Reads config from ~/.agent-co/telegram.json:
 *   { "botToken": "123:ABC", "chatId": "123456789" }
 *
 * Setup (one-time):
 *   1. Message @BotFather on Telegram, run /newbot, give it a name
 *   2. Copy the token it gives you
 *   3. Message your new bot to initialize the chat
 *   4. Visit https://api.telegram.org/bot<TOKEN>/getUpdates to find chat_id
 *   5. Save both to ~/.agent-co/telegram.json
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_PATH = join(homedir(), '.agent-co', 'telegram.json');

async function notify(message) {
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`[telegram-notifier] No config at ${CONFIG_PATH}`);
    console.error(`[telegram-notifier] Run setup first — see notify.js header comment`);
    process.exit(1);
  }

  const { botToken, chatId } = config;
  if (!botToken || !chatId) {
    console.error('[telegram-notifier] Missing botToken or chatId in config');
    process.exit(1);
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error(`[telegram-notifier] Failed: ${res.status} ${error}`);
    process.exit(1);
  }

  console.log(`[telegram-notifier] Sent (${message.length} chars)`);
}

// Read message from args or stdin
let message = process.argv.slice(2).join(' ');
if (!message) {
  // Read from stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  message = Buffer.concat(chunks).toString().trim();
}

if (!message) {
  console.error('[telegram-notifier] No message provided');
  process.exit(1);
}

notify(message).catch(err => {
  console.error(`[telegram-notifier] Error: ${err.message}`);
  process.exit(1);
});
