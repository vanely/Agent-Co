/**
 * Text-to-speech synthesis helper.
 *
 * Currently one backend: **Piper** (https://github.com/rhasspy/piper) — local,
 * fast (10x real-time on CPU), small ONNX voice models, MIT licensed.
 * Produces WAV PCM; callers usually need OGG Opus for Telegram voice notes,
 * so this module ships a ffmpeg-backed transcoder too.
 *
 * Design notes:
 *
 *   - Piper is invoked via `spawn`, not via an npm binding, because the
 *     Node bindings are unmaintained and shelling out is trivially reliable.
 *   - Text is passed via stdin. Piper writes WAV to --output_file or stdout.
 *   - The wrapper handles binary + model discovery: $PIPER_BINARY env var,
 *     then ~/.local/share/piper/piper, then $PATH.
 *   - Model discovery: $PIPER_MODEL env var, then ~/.local/share/piper/*.onnx
 *     (first match).
 *   - ffmpeg is expected on PATH for Opus transcoding. If missing, the caller
 *     gets WAV back and has to handle it (or accept a synthesizeSpeech error
 *     when format='opus').
 */
import { spawn } from 'node:child_process'
import { readFile, unlink, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export type SynthesisProvider = 'piper'
export type SynthesisFormat = 'wav' | 'opus'

export interface SynthesizeConfig {
  /** Explicit provider. Currently only 'piper'. */
  provider?: SynthesisProvider
  /** Path to the piper binary. Autodetected if omitted. */
  piperBinary?: string
  /** Path to a piper .onnx voice model. Autodetected if omitted. */
  piperModel?: string
  /** Output format. 'opus' goes through ffmpeg; 'wav' is piper's native. */
  format?: SynthesisFormat
  /** Cap the input text to this many chars. Defaults to 5000 (piper can handle
   *  more but Telegram voice messages shouldn't be novels). */
  maxChars?: number
  /** Opus bitrate when format='opus'. Default '32k' — fine for speech. */
  opusBitrate?: string
}

export interface SynthesizeResult {
  buffer: Buffer
  format: SynthesisFormat
  provider: SynthesisProvider
  durationMs: number
  /** Number of input chars actually synthesized (may be less than input if
   *  truncated to maxChars). */
  charsSynthesized: number
}

const DEFAULT_MAX_CHARS = 5000

/** Common paths where Piper's binary might live. Checked in order. */
function candidatePiperBinaries(): string[] {
  return [
    process.env.PIPER_BINARY || '',
    join(homedir(), '.local', 'share', 'piper', 'piper'),
    join(homedir(), '.piper', 'piper'),
    '/usr/local/bin/piper',
    '/opt/piper/piper',
    'piper',   // last resort: look on PATH
  ].filter(Boolean)
}

/** Find a piper voice model. Lets callers drop any .onnx into the default
 *  install dir and have it picked up without further config. */
async function findPiperModel(explicit?: string): Promise<string | null> {
  if (explicit && existsSync(explicit)) return explicit
  if (process.env.PIPER_MODEL && existsSync(process.env.PIPER_MODEL)) {
    return process.env.PIPER_MODEL
  }
  const defaultDir = join(homedir(), '.local', 'share', 'piper')
  try {
    const files = await readdir(defaultDir)
    const onnx = files.find(f => f.endsWith('.onnx'))
    if (onnx) return join(defaultDir, onnx)
  } catch { /* directory missing — that's fine */ }
  return null
}

async function findPiperBinary(explicit?: string): Promise<string | null> {
  if (explicit && existsSync(explicit)) return explicit
  for (const candidate of candidatePiperBinaries()) {
    if (candidate === 'piper') {
      // Resolve via PATH lookup. Spawn with only 'piper' works if it's on PATH;
      // we don't pre-check in this branch to avoid an extra `which` call.
      return 'piper'
    }
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Run a command, resolve with its buffered stdout and exit code. Accepts
 * stdin input. Reject on nonzero exit only if `throwOnError` is true.
 */
function runCommand(
  cmd: string,
  args: string[],
  opts: { stdin?: string; throwOnError?: boolean } = {},
): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdoutChunks: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c))
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString() })
    child.on('error', err => reject(err))
    child.on('close', code => {
      const result = { stdout: Buffer.concat(stdoutChunks), stderr, code: code ?? -1 }
      if ((code ?? -1) !== 0 && opts.throwOnError) {
        return reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`))
      }
      resolve(result)
    })
    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin)
      child.stdin.end()
    } else {
      child.stdin.end()
    }
  })
}

/**
 * Synthesize text to audio. Returns null if no backend is available; throws
 * on actual failure (binary found but ran badly, model corrupt, etc.).
 */
export async function synthesizeSpeech(
  text: string,
  cfg: SynthesizeConfig = {},
): Promise<SynthesizeResult | null> {
  const binary = await findPiperBinary(cfg.piperBinary)
  if (!binary) return null  // No piper installed — caller falls through.

  const model = await findPiperModel(cfg.piperModel)
  if (!model) {
    throw new Error(
      'piper binary found but no .onnx voice model. Put a model in ~/.local/share/piper/ or set PIPER_MODEL.',
    )
  }

  const maxChars = cfg.maxChars ?? DEFAULT_MAX_CHARS
  const trimmed = text.length > maxChars ? text.slice(0, maxChars) : text
  const format: SynthesisFormat = cfg.format ?? 'wav'

  // Piper needs an explicit output file; some builds also support stdout,
  // but writing to disk is universally supported and lets us pipe through
  // ffmpeg without juggling stdio chains.
  const wavPath = join(tmpdir(), `piper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`)

  const startedAt = Date.now()

  try {
    await runCommand(binary, [
      '--model', model,
      '--output_file', wavPath,
    ], { stdin: trimmed, throwOnError: true })

    if (format === 'wav') {
      const buf = await readFile(wavPath)
      return {
        buffer: buf,
        format: 'wav',
        provider: 'piper',
        durationMs: Date.now() - startedAt,
        charsSynthesized: trimmed.length,
      }
    }

    // Opus: ffmpeg transcode. libopus is part of the standard ffmpeg build.
    const opusPath = wavPath.replace(/\.wav$/, '.ogg')
    await runCommand('ffmpeg', [
      '-y',                         // overwrite without prompt
      '-i', wavPath,
      '-c:a', 'libopus',
      '-b:a', cfg.opusBitrate ?? '32k',
      '-application', 'voip',       // optimize for speech intelligibility
      opusPath,
    ], { throwOnError: true })

    const buf = await readFile(opusPath)
    await unlink(opusPath).catch(() => {})
    return {
      buffer: buf,
      format: 'opus',
      provider: 'piper',
      durationMs: Date.now() - startedAt,
      charsSynthesized: trimmed.length,
    }
  } finally {
    await unlink(wavPath).catch(() => {})
  }
}
