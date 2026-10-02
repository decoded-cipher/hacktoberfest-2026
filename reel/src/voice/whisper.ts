import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const TIMEOUT_MS = 60_000;

/** `hints` are words likely to be spoken (e.g. the user's show titles) to steer spelling. */
export type Transcribe = (audio: Uint8Array, hints?: string[]) => Promise<string>;

const MAX_HINT_CHARS = 600;

export interface WhisperOptions {
  /** Path to a ggml Whisper model, e.g. data/models/ggml-base.bin. */
  model: string;
  cli?: string;
  ffmpeg?: string;
  /** Spoken language code, or "auto" to detect it. */
  language?: string;
}

/** Local speech-to-text: ffmpeg converts Telegram's OGG/Opus to 16 kHz WAV, whisper.cpp transcribes it. */
export function createWhisperTranscriber(options: WhisperOptions): Transcribe {
  const { model, cli = "whisper-cli", ffmpeg = "ffmpeg", language = "auto" } = options;
  return async (audio, hints = []) => {
    const dir = await mkdtemp(join(tmpdir(), "reel-voice-"));
    try {
      const input = join(dir, "input.oga");
      const wav = join(dir, "audio.wav");
      await writeFile(input, audio);
      await run(
        ffmpeg,
        ["-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
        {
          timeout: TIMEOUT_MS,
        },
      );
      const args = ["-m", model, "-f", wav, "-l", language, "-nt", "-np"];
      const prompt = hintPrompt(hints);
      if (prompt) args.push("--prompt", prompt);
      const { stdout } = await run(cli, args, { timeout: TIMEOUT_MS });
      return cleanTranscript(stdout);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/** Collapse whitespace and drop Whisper's non-speech markers like [BLANK_AUDIO] or (music). */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comma-separated hints, capped so Whisper's prompt window isn't exceeded. */
export function hintPrompt(hints: string[]): string {
  let out = "";
  for (const h of new Set(hints)) {
    const next = out ? `${out}, ${h}` : h;
    if (next.length > MAX_HINT_CHARS) break;
    out = next;
  }
  return out;
}
