import { Composer } from "grammy";
import {
  addToWatchlist,
  continueWatching,
  getProgress,
  getRating,
  getWatchlist,
  recentHistory,
  setRating,
  undoLastWatch,
} from "../db/library.ts";
import type { Title } from "../db/schema.ts";
import type { ParsedMessage } from "../nlu/schema.ts";
import type { WatchOutcome } from "../services/tracker.ts";
import type { BotContext } from "./context.ts";
import { episodeCode, nextEpisodeLine, stars, titleHtml } from "./format.ts";
import { candidatesKeyboard, ratingKeyboard } from "./keyboards.ts";
import * as messages from "./messages.ts";

const HTML = { parse_mode: "HTML" } as const;

export const tracking = new Composer<BotContext>();

tracking.command("next", async (ctx) => {
  const { db, tracker, now } = ctx.services;
  const rows = await continueWatching(db, ctx.user.id);
  if (rows.length === 0) return ctx.reply(messages.nothingInProgress);

  const lines = await Promise.all(
    rows.map(async ({ title, progress }) => {
      const fresh = await tracker.ensureTitle(title.kind, title.tmdbId);
      const next = await tracker.nextEpisode(fresh, progress.season, progress.episode);
      const status = next ? `next ${nextEpisodeLine(next, now())}` : "all caught up";
      return `• ${titleHtml(fresh)} — ${status}`;
    }),
  );
  return ctx.reply(`<b>Continue watching</b>\n\n${lines.join("\n")}`, HTML);
});

tracking.command("watchlist", async (ctx) => {
  const items = await getWatchlist(ctx.services.db, ctx.user.id);
  if (items.length === 0) return ctx.reply(messages.emptyWatchlist);
  const lines = items.slice(0, 30).map((t) => `• ${titleHtml(t)}`);
  const more = items.length > 30 ? `\n…and ${items.length - 30} more` : "";
  return ctx.reply(`<b>Your watchlist</b> (${items.length})\n\n${lines.join("\n")}${more}`, HTML);
});

tracking.command("history", async (ctx) => {
  const rows = await recentHistory(ctx.services.db, ctx.user.id, 10);
  if (rows.length === 0) return ctx.reply(messages.emptyHistory);
  const lines = rows.map(({ event, title }) => {
    const ep = event.season != null ? ` ${episodeCode(event.season, event.episode ?? 0)}` : "";
    const date = event.watchedAt.toISOString().slice(0, 10);
    return `• ${titleHtml(title)}${ep} — ${date}`;
  });
  return ctx.reply(`<b>Recently watched</b>\n\n${lines.join("\n")}`, HTML);
});

tracking.command("undo", async (ctx) => {
  const undone = await undoLastWatch(ctx.services.db, ctx.user.id);
  if (!undone) return ctx.reply(messages.nothingToUndo);
  const { event, title } = undone;
  const ep = event.season != null ? ` ${episodeCode(event.season, event.episode ?? 0)}` : "";
  return ctx.reply(`↩️ Removed ${titleHtml(title)}${ep} from your history.`, HTML);
});

tracking.callbackQuery(/^pick:([\w-]+):(\d+|none)$/, async (ctx) => {
  const [, id, choice] = ctx.match;
  const pick = id ? ctx.services.picks.take(id) : undefined;
  await ctx.answerCallbackQuery();
  if (!pick || pick.userId !== ctx.user.id) {
    return ctx.editMessageText(messages.pickExpired);
  }
  const candidate = choice === "none" ? undefined : pick.candidates[Number(choice)];
  if (!candidate) {
    return ctx.editMessageText(messages.pickNone);
  }
  await ctx.editMessageReplyMarkup();
  const title = await ctx.services.tracker.ensureTitle(candidate.kind, candidate.tmdbId);
  return act(ctx, pick.parsed, title);
});

tracking.callbackQuery(/^rate:(\d+):([1-5])$/, async (ctx) => {
  const titleId = Number(ctx.match[1]);
  const rating = await setRating(ctx.services.db, ctx.user.id, titleId, Number(ctx.match[2]));
  await ctx.answerCallbackQuery({ text: `Rated ${rating}★` });
  const text = ctx.callbackQuery.message?.text;
  return text ? ctx.editMessageText(`${text}\n\nYour rating: ${stars(rating)}`) : undefined;
});

/** Entry point for free-text messages that refer to a title. */
export async function handleTitleIntent(ctx: BotContext, parsed: ParsedMessage) {
  if (!parsed.title) return ctx.reply(messages.whichTitle);

  const { tracker, picks } = ctx.services;
  const match = await tracker.resolve(ctx.user.id, {
    query: parsed.title,
    year: parsed.year,
    kind: parsed.kind,
  });

  if (match.status === "none") {
    return ctx.reply(messages.notFound(parsed.title));
  }
  if (match.status === "ambiguous") {
    const id = picks.put({ userId: ctx.user.id, parsed, candidates: match.candidates });
    return ctx.reply(messages.whichOne(parsed.title), {
      reply_markup: candidatesKeyboard(id, match.candidates),
    });
  }
  const title = await tracker.ensureTitle(match.title.kind, match.title.tmdbId);
  return act(ctx, parsed, title);
}

async function act(ctx: BotContext, parsed: ParsedMessage, title: Title) {
  const { db, tracker } = ctx.services;
  const userId = ctx.user.id;

  switch (parsed.intent) {
    case "log_watch": {
      const outcome = await tracker.logWatch(
        userId,
        title,
        {
          season: parsed.season,
          episode: parsed.episode,
          finishedSeries: parsed.finished_series,
          note: parsed.note,
        },
        "chat",
      );
      const rated =
        parsed.rating != null ? await setRating(db, userId, title.id, parsed.rating) : null;
      const text = describeWatch(outcome, ctx.services.now());
      if (rated != null) return ctx.reply(`${text}\n\nYour rating: ${stars(rated)}`, HTML);

      const askRating =
        outcome.type === "movie" ||
        (outcome.type === "tv" && (outcome.wholeSeason || outcome.finishedSeries));
      if (askRating && (await getRating(db, userId, title.id)) == null) {
        return ctx.reply(`${text}\n\nHow would you rate it?`, {
          ...HTML,
          reply_markup: ratingKeyboard(title.id),
        });
      }
      return ctx.reply(text, HTML);
    }

    case "rate": {
      if (parsed.rating == null) {
        return ctx.reply(`How would you rate ${titleHtml(title)}?`, {
          ...HTML,
          reply_markup: ratingKeyboard(title.id),
        });
      }
      const rating = await setRating(db, userId, title.id, parsed.rating);
      return ctx.reply(`Rated ${titleHtml(title)}: ${stars(rating)}`, HTML);
    }

    case "add_watchlist": {
      const added = await addToWatchlist(db, userId, title.id, "chat");
      return ctx.reply(
        added
          ? `📌 Added ${titleHtml(title)} to your watchlist.`
          : `${titleHtml(title)} is already on your watchlist.`,
        HTML,
      );
    }

    case "progress": {
      const progress = await getProgress(db, userId, title.id);
      if (!progress) {
        return ctx.reply(`You haven't logged any episodes of ${titleHtml(title)} yet.`, HTML);
      }
      const next = await tracker.nextEpisode(title, progress.season, progress.episode);
      const nextLine = next
        ? `\nNext up: ${nextEpisodeLine(next, ctx.services.now())}`
        : "\nYou're all caught up 🎉";
      return ctx.reply(
        `You're at ${episodeCode(progress.season, progress.episode)} of ${titleHtml(title)}.${nextLine}`,
        HTML,
      );
    }

    default:
      return ctx.reply(messages.notUnderstood);
  }
}

export function describeWatch(outcome: WatchOutcome, today: Date): string {
  switch (outcome.type) {
    case "movie":
      return `✅ Logged ${titleHtml(outcome.title)}`;
    case "unknown_season":
      return `I couldn't find season ${outcome.season} of ${titleHtml(outcome.title)}. Nothing was logged.`;
    case "tv": {
      const what = outcome.finishedSeries
        ? "finished 🎉"
        : outcome.wholeSeason
          ? `season ${outcome.season} done`
          : episodeCode(outcome.season, outcome.episode);
      const head = `✅ ${titleHtml(outcome.title)} — ${what}`;
      if (outcome.finishedSeries) return head;
      return outcome.next
        ? `${head}\n⏭ Next up: ${nextEpisodeLine(outcome.next, today)}`
        : `${head}\nYou're all caught up for now.`;
    }
  }
}
