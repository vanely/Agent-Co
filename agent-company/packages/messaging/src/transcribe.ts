/**
 * Audio transcription helper.
 *
 * Takes a path to an audio file and returns the transcribed text. Three
 * backends, tried in order of preference:
 *
 *   - local (whisper.cpp via nodejs-whisper): free, offline, data never
 *     leaves the machine. Requires `npm install nodejs-whisper` in the
 *     caller package — this library only loads it lazily. First use
 *     auto-downloads the model (~75MB for tiny.en).
 *   - Groq (free tier): whisper-large-v3-turbo. Very fast. Requires GROQ_API_KEY.
 *   - OpenAI Whisper API (paid, ~$0.006/min): whisper-1. Requires OPENAI_API_KEY.
 *
 * If none work, returns null; the caller should surface a friendly note.
 *
 * Telegram voice messages arrive as OGG Opus. All three backends accept OGG
 * directly (whisper.cpp transcodes via ffmpeg if present, Groq/OpenAI accept
 * raw).
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

export type TranscribeProvider = 'local' | 'groq' | 'openai'

/**
 * Whisper model sizes available locally. Trade-off:
 *   - tiny.en:   ~75MB, fastest, English-only
 *   - base.en:   ~140MB, better accuracy, English-only
 *   - small.en:  ~465MB, strong accuracy, English-only
 *   - tiny:      ~75MB, multilingual
 *   - base:      ~140MB, multilingual
 *   - small:     ~465MB, multilingual
 * Default: tiny.en. Good enough for voice notes; fits on any machine.
 */
export type LocalWhisperModel =
  | 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en'
  | 'medium' | 'medium.en' | 'large-v3' | 'large-v3-turbo'

/**
 * Shape of a local transcriber function. Matches nodejs-whisper's
 * `nodewhisper()` signature: takes a file path and options, returns the
 * transcript string. Injected by the caller because this library is a
 * symlinked workspace package — a dynamic import of `nodejs-whisper` from
 * inside would look in the library's own node_modules (empty) rather than
 * the consuming app's. Passing the function in sidesteps resolution entirely.
 */
export type LocalTranscriber = (filePath: string, options: Record<string, unknown>) => Promise<string>

export interface TranscribeConfig {
  /** Explicit provider override. If unset, tries local → groq → openai in order. */
  provider?: TranscribeProvider
  /** Function that performs local transcription. Typically `nodewhisper` from
   *  the `nodejs-whisper` package, imported by the caller. If omitted, the
   *  local backend is skipped. */
  localTranscriber?: LocalTranscriber
  /** Model to use for the local backend. Defaults to 'tiny.en'. */
  localModel?: LocalWhisperModel
  groqApiKey?: string
  openaiApiKey?: string
  /** Language hint (ISO-639-1). Omit for auto-detect. Cloud backends only. */
  language?: string
  /** Custom prompt to bias the transcription (cloud backends only). */
  biasPrompt?: string
}

export interface TranscribeResult {
  text: string
  provider: TranscribeProvider
  durationMs: number
}

const GROQ_MODEL = 'whisper-large-v3-turbo'
const OPENAI_MODEL = 'whisper-1'
const DEFAULT_LOCAL_MODEL: LocalWhisperModel = 'tiny.en'

/**
 * Ordered list of backends to try. Each returns a result or null (meaning
 * "I'm not configured, try the next one"). Thrown errors mean "I tried and
 * failed" — caller decides whether to propagate or fall through.
 */
async function tryLocal(
  filePath: string,
  cfg: TranscribeConfig,
): Promise<TranscribeResult | null> {
  if (!cfg.localTranscriber) return null

  const model: LocalWhisperModel = cfg.localModel ?? DEFAULT_LOCAL_MODEL
  const startedAt = Date.now()

  try {
    const output = await cfg.localTranscriber(filePath, {
      modelName: model,
      autoDownloadModelName: model,
      verbose: false,
      removeWavFileAfterTranscription: true,
      whisperOptions: {
        outputInText: true,
        outputInVtt: false,
        outputInSrt: false,
        outputInCsv: false,
        outputInJson: false,
        outputInJsonFull: false,
        outputInWords: false,
        translateToEnglish: false,
        wordTimestamps: false,
        timestamps_length: 0,
        splitOnWord: false,
      },
    })

    // nodejs-whisper returns the transcript as a string. Trim timestamps
    // (e.g. "[00:00:00.000 --> 00:00:03.000]") that whisper.cpp sometimes
    // includes even with outputInText:true, in case a version does that.
    const text = typeof output === 'string'
      ? output.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]/g, '').trim()
      : ''

    if (!text) throw new Error('local whisper returned empty transcript')

    return {
      text,
      provider: 'local',
      durationMs: Date.now() - startedAt,
    }
  } catch (err: any) {
    // A real failure here (model download, ffmpeg missing, compile issue)
    // deserves visibility — propagate so the caller can decide whether to
    // fall through to cloud backends.
    throw new Error(`local whisper failed: ${err.message}`)
  }
}

async function tryCloud(
  filePath: string,
  provider: 'groq' | 'openai',
  cfg: TranscribeConfig,
): Promise<TranscribeResult | null> {
  const apiKey = provider === 'groq' ? cfg.groqApiKey : cfg.openaiApiKey
  if (!apiKey) return null

  const url = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions'
  const model = provider === 'groq' ? GROQ_MODEL : OPENAI_MODEL

  const buf = await readFile(filePath)
  const blob = new Blob([buf])

  const form = new FormData()
  form.append('file', blob, basename(filePath))
  form.append('model', model)
  form.append('response_format', 'json')
  if (cfg.language) form.append('language', cfg.language)
  if (cfg.biasPrompt) form.append('prompt', cfg.biasPrompt)

  const startedAt = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `${provider} transcription failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`,
    )
  }

  const data = await res.json() as { text?: string }
  if (!data.text) throw new Error(`${provider} returned no text`)

  return {
    text: data.text.trim(),
    provider,
    durationMs: Date.now() - startedAt,
  }
}

export async function transcribeAudio(
  filePath: string,
  cfg: TranscribeConfig,
): Promise<TranscribeResult | null> {
  // Explicit provider override — caller knows what they want.
  if (cfg.provider) {
    if (cfg.provider === 'local') return tryLocal(filePath, cfg)
    return tryCloud(filePath, cfg.provider, cfg)
  }

  // Auto order: local first (free, offline), then Groq (free tier), then
  // OpenAI (paid). Failures inside one backend cascade to the next so a
  // missing model download or invalid key can't knock the user out entirely.
  const errors: string[] = []

  try {
    const local = await tryLocal(filePath, cfg)
    if (local) return local
  } catch (err: any) {
    errors.push(`local: ${err.message}`)
  }

  try {
    const groq = await tryCloud(filePath, 'groq', cfg)
    if (groq) return groq
  } catch (err: any) {
    errors.push(`groq: ${err.message}`)
  }

  try {
    const openai = await tryCloud(filePath, 'openai', cfg)
    if (openai) return openai
  } catch (err: any) {
    errors.push(`openai: ${err.message}`)
  }

  if (errors.length > 0) {
    throw new Error(`all transcription backends failed: ${errors.join(' | ')}`)
  }

  // Nothing configured.
  return null
}
