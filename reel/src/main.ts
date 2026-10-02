import { COMMANDS, createBot } from "./bot/bot.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db/client.ts";

const config = loadConfig();
const { db, close } = await openDb(config.DATABASE_PATH);
const bot = createBot(config.TELEGRAM_BOT_TOKEN, { db });

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
