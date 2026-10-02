import { buildDeps } from "./app.ts";
import { COMMANDS, createBot } from "./bot/bot.ts";
import { loadConfig } from "./config.ts";
import { createWebhookServer, WEBHOOK_PATH, webhookToken } from "./server.ts";

const config = loadConfig();
const { deps, close } = await buildDeps(config);
const bot = createBot(config.TELEGRAM_BOT_TOKEN, deps);

await bot.init();
await bot.api.setMyCommands(COMMANDS);

const publicUrl = config.PUBLIC_URL ?? config.RENDER_EXTERNAL_URL;

if (publicUrl) {
  // Webhook mode (e.g. on Render): Telegram pushes updates to our public URL.
  if (!config.WEBHOOK_SECRET) throw new Error("WEBHOOK_SECRET is required in webhook mode");
  const token = webhookToken(config.WEBHOOK_SECRET);
  const server = createWebhookServer(bot, token);
  server.listen(config.PORT, () => console.log(`Listening on :${config.PORT}`));
  await bot.api.setWebhook(`${publicUrl.replace(/\/$/, "")}${WEBHOOK_PATH}`, {
    secret_token: token,
  });
  console.log(`Reel is running as @${bot.botInfo.username} (webhook)`);

  const shutdown = () => server.close(() => void close());
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} else {
  // Polling mode (local): no public URL needed. Clear any webhook left by a deployment.
  await bot.api.deleteWebhook();
  const shutdown = async () => {
    await bot.stop();
    await close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await bot.start({
    onStart: (info) => console.log(`Reel is running as @${info.username} (polling)`),
  });
}
