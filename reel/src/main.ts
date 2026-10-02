import { COMMANDS, createBot } from "./bot/bot.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db/client.ts";
import { LlmClient } from "./llm/client.ts";
import { createParser } from "./nlu/parser.ts";
import { TmdbClient } from "./tmdb/client.ts";

const config = loadConfig();
const { db, close } = await openDb(config.DATABASE_PATH);
const tmdb = new TmdbClient({ accessToken: config.TMDB_ACCESS_TOKEN });
const llm = new LlmClient({
  baseURL: config.LLM_BASE_URL,
  apiKey: config.LLM_API_KEY,
  model: config.LLM_MODEL,
});
const bot = createBot(config.TELEGRAM_BOT_TOKEN, { db, tmdb, parse: createParser(llm) });

await bot.api.setMyCommands(COMMANDS);

const shutdown = async () => {
  await bot.stop();
  await close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await bot.start({
  onStart: (info) => console.log(`Reel is running as @${info.username}`),
});
