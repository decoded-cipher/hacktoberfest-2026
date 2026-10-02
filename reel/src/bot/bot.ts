import { Bot, type BotConfig, type Context } from "grammy";
import type { Db } from "../db/client.ts";
import { upsertUser } from "../db/users.ts";
import * as messages from "./messages.ts";

export interface BotDeps {
  db: Db;
}

export const COMMANDS = [
  { command: "start", description: "Say hello" },
  { command: "help", description: "What I can do" },
];

export function createBot(token: string, deps: BotDeps, config?: BotConfig<Context>): Bot {
  const bot = new Bot(token, config);

  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    await upsertUser(deps.db, { telegramId: ctx.from.id, firstName: ctx.from.first_name });
    await ctx.reply(messages.welcome(ctx.from.first_name));
  });

  bot.command("help", (ctx) => ctx.reply(messages.help));

  bot.catch((err) => {
    console.error(`Error while handling update ${err.ctx.update.update_id}:`, err.error);
  });

  return bot;
}
