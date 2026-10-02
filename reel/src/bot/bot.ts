import { Bot, type BotConfig } from "grammy";
import { upsertUser } from "../db/users.ts";
import { Tracker } from "../services/tracker.ts";
import type { BotContext, BotDeps, PendingPick, Services } from "./context.ts";
import { importing } from "./importing.ts";
import * as messages from "./messages.ts";
import { PendingStore } from "./pending.ts";
import { handleTitleIntent, tracking } from "./tracking.ts";

export type { BotDeps } from "./context.ts";

export const COMMANDS = [
  { command: "next", description: "What to continue watching" },
  { command: "watchlist", description: "Things you saved for later" },
  { command: "history", description: "What you watched recently" },
  { command: "undo", description: "Remove the last thing you logged" },
  { command: "import", description: "Import from Letterboxd or IMDb" },
  { command: "help", description: "What I can do" },
];

export function createBot(token: string, deps: BotDeps, config?: BotConfig<BotContext>) {
  const bot = new Bot<BotContext>(token, config);
  const now = deps.now ?? (() => new Date());
  const services: Services = {
    ...deps,
    tracker: new Tracker({ db: deps.db, tmdb: deps.tmdb, now }),
    picks: new PendingStore<PendingPick>(),
    download: deps.download ?? ((path) => downloadTelegramFile(token, path)),
    now,
  };

  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    ctx.user = await upsertUser(deps.db, {
      telegramId: ctx.from.id,
      firstName: ctx.from.first_name,
    });
    ctx.services = services;
    await next();
  });

  bot.command("start", (ctx) => ctx.reply(messages.welcome(ctx.from?.first_name)));
  bot.command("help", (ctx) => ctx.reply(messages.help));

  bot.use(tracking);
  bot.use(importing);

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return ctx.reply(messages.help);

    await ctx.replyWithChatAction("typing");
    const parsed = await deps.parse(ctx.message.text);
    switch (parsed.intent) {
      case "log_watch":
      case "rate":
      case "add_watchlist":
      case "progress":
        return handleTitleIntent(ctx, parsed);
      case "suggest":
      case "set_preference":
        return ctx.reply(messages.comingSoon);
      default:
        return ctx.reply(messages.notUnderstood);
    }
  });

  bot.catch(async (err) => {
    console.error(`Error while handling update ${err.ctx.update.update_id}:`, err.error);
    await err.ctx.reply("Sorry, something went wrong. Please try again.").catch(() => {});
  });

  return bot;
}

async function downloadTelegramFile(token: string, filePath: string): Promise<Uint8Array> {
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!res.ok) throw new Error(`File download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
