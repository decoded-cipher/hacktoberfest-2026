import { Composer, InlineKeyboard } from "grammy";
import {
  activePreferences,
  addPreference,
  clearPreferences,
  deletePreference,
} from "../db/preferences.ts";
import type { Preference } from "../db/schema.ts";
import type { ParsedMessage } from "../nlu/schema.ts";
import type { BotContext } from "./context.ts";
import { escapeHtml } from "./format.ts";
import * as messages from "./messages.ts";

const TEMPORARY_HOURS = 12;

export const memory = new Composer<BotContext>();

memory.command("memory", async (ctx) => {
  const prefs = await activePreferences(ctx.services.db, ctx.user.id, ctx.services.now());
  if (prefs.length === 0) return ctx.reply(messages.memoryEmpty);
  return ctx.reply(memoryText(prefs, ctx.services.now()), {
    parse_mode: "HTML",
    reply_markup: memoryKeyboard(prefs),
  });
});

memory.callbackQuery(/^mem:del:(\d+)$/, async (ctx) => {
  const { db, now } = ctx.services;
  await deletePreference(db, ctx.user.id, Number(ctx.match[1]));
  await ctx.answerCallbackQuery({ text: messages.forgotOne });
  const prefs = await activePreferences(db, ctx.user.id, now());
  return prefs.length
    ? ctx.editMessageText(memoryText(prefs, now()), {
        parse_mode: "HTML",
        reply_markup: memoryKeyboard(prefs),
      })
    : ctx.editMessageText(messages.memoryEmpty);
});

memory.callbackQuery("mem:clear", async (ctx) => {
  await clearPreferences(ctx.services.db, ctx.user.id);
  await ctx.answerCallbackQuery();
  return ctx.editMessageText(messages.memoryCleared);
});

/** Store a stated taste. Likes and dislikes from one message become separate preferences. */
export async function rememberPreference(ctx: BotContext, parsed: ParsedMessage, text: string) {
  const { db, now } = ctx.services;
  const fact = parsed.note ?? text;
  const expiresAt = parsed.temporary
    ? new Date(now().getTime() + TEMPORARY_HOURS * 60 * 60 * 1000)
    : null;
  const disliked = parsed.sentiment === "disliked" || parsed.sentiment === "mixed";

  if (parsed.avoid_genres.length || (disliked && !parsed.genres.length)) {
    await addPreference(db, {
      userId: ctx.user.id,
      fact,
      polarity: "dislike",
      genres: parsed.avoid_genres,
      expiresAt,
    });
  }
  if (parsed.genres.length || !disliked) {
    await addPreference(db, {
      userId: ctx.user.id,
      fact,
      polarity: "like",
      genres: parsed.genres,
      expiresAt,
    });
  }
  return ctx.reply(messages.remembered(fact, parsed.temporary ? TEMPORARY_HOURS : null));
}

function memoryText(prefs: Preference[], now: Date): string {
  const lines = prefs.map((p, i) => {
    const icon = p.polarity === "like" ? "👍" : "👎";
    const hours = p.expiresAt ? Math.ceil((p.expiresAt.getTime() - now.getTime()) / 3_600_000) : 0;
    const until = p.expiresAt ? ` <i>(for ${hours} more hour${hours === 1 ? "" : "s"})</i>` : "";
    return `${i + 1}. ${icon} ${escapeHtml(p.fact)}${until}`;
  });
  return `<b>What I remember about your taste</b>\n\n${lines.join("\n")}\n\nTap one to forget it.`;
}

function memoryKeyboard(prefs: Preference[]) {
  const kb = new InlineKeyboard();
  prefs.forEach((p, i) => {
    kb.text(`🗑 ${i + 1}. ${p.fact.slice(0, 40)}`, `mem:del:${p.id}`).row();
  });
  return kb.text("Forget everything", "mem:clear");
}
