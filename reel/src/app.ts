import type { BotDeps } from "./bot/bot.ts";
import type { Config } from "./config.ts";
import { openDb } from "./db/client.ts";
import { LlmClient } from "./llm/client.ts";
import { createParser } from "./nlu/parser.ts";
import { TabPfnModel } from "./recommend/tabpfn.ts";
import { TmdbClient } from "./tmdb/client.ts";
import { createWhisperTranscriber } from "./voice/whisper.ts";

/** Wire up everything the bot and the scheduled jobs share, from configuration. */
export async function buildDeps(
  config: Config,
): Promise<{ deps: BotDeps; close: () => Promise<void> }> {
  const { db, close } = await openDb(config.DATABASE_URL ?? config.DATABASE_PATH);
  const tmdb = new TmdbClient({ accessToken: config.TMDB_ACCESS_TOKEN });
  const llm = new LlmClient({
    baseURL: config.LLM_HOSTPORT ? `http://${config.LLM_HOSTPORT}/v1` : config.LLM_BASE_URL,
    apiKey: config.LLM_API_KEY,
    model: config.LLM_MODEL,
  });

  const ratingModel = config.PRIORLABS_API_KEY
    ? new TabPfnModel({ apiKey: config.PRIORLABS_API_KEY, modelPath: config.TABPFN_MODEL_PATH })
    : undefined;
  if (!ratingModel) console.log("PRIORLABS_API_KEY not set: suggestions use the local ridge model");

  const transcribe = config.WHISPER_MODEL_PATH
    ? createWhisperTranscriber({
        model: config.WHISPER_MODEL_PATH,
        cli: config.WHISPER_CLI,
        language: config.WHISPER_LANGUAGE,
      })
    : undefined;
  if (!transcribe) console.log("WHISPER_MODEL_PATH not set: voice notes are disabled");

  return {
    deps: { db, tmdb, parse: createParser(llm, config.LLM_PROMPT), ratingModel, transcribe },
    close,
  };
}
