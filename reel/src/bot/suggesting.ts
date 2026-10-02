import { type Api, Composer, InlineKeyboard } from "grammy";
import { addToWatchlist, getRating } from "../db/library.ts";
import type { Title } from "../db/schema.ts";
import { getSuggestion, setSuggestionOutcome } from "../db/suggestions.ts";
import { findTitleById } from "../db/titles.ts";
import type { ParsedMessage } from "../nlu/schema.ts";
import { canonicalGenres } from "../recommend/features.ts";
import {
  MIN_RATINGS,
  type SuggestFilters,
  type Suggestion,
  type SuggestResult,
} from "../recommend/recommender.ts";
import type { BotContext } from "./context.ts";
import { escapeHtml, titleHtml } from "./format.ts";
import { ratingKeyboard } from "./keyboards.ts";
import * as messages from "./messages.ts";
import { describeWatch } from "./tracking.ts";

const POSTER_BASE = "https://image.tmdb.org/t/p/w342";

export const suggesting = new Composer<BotContext>();

suggesting.command("suggest", async (ctx) => {
  const args = ctx.match.trim();
  const filters = args ? filtersFrom(await ctx.services.parse(args)) : {};
  return sendSuggestions(ctx, filters);
});

suggesting.callbackQuery(/^sg:([wsx]):(\d+)$/, async (ctx) => {
  const [, action, rawId] = ctx.match;
  const { db, tracker } = ctx.services;
  const suggestion = await getSuggestion(db, ctx.user.id, Number(rawId));
  const title = suggestion ? await findTitleById(db, suggestion.titleId) : null;
  if (!suggestion || !title) return ctx.answerCallbackQuery({ text: messages.pickExpired });

  await ctx.editMessageReplyMarkup().catch(() => {});

  if (action === "x") {
    await setSuggestionOutcome(db, suggestion.id, "dismissed");
    return ctx.answerCallbackQuery({ text: messages.dismissed });
  }
  if (action === "s") {
    await setSuggestionOutcome(db, suggestion.id, "saved");
    await addToWatchlist(db, ctx.user.id, title.id, "button");
    return ctx.answerCallbackQuery({ text: messages.saved });
  }

  await setSuggestionOutcome(db, suggestion.id, "watched");
  await ctx.answerCallbackQuery();
  const outcome = await tracker.logWatch(
    ctx.user.id,
    title,
    { season: null, episode: null, finishedSeries: false, note: null },
    "button",
  );
  const text = describeWatch(outcome, ctx.services.now());
  const askRating = title.kind === "movie" && (await getRating(db, ctx.user.id, title.id)) == null;
  return ctx.reply(askRating ? `${text}\n\nHow would you rate it?` : text, {
    parse_mode: "HTML",
    ...(askRating && { reply_markup: ratingKeyboard(title.id) }),
  });
});

export async function sendSuggestions(ctx: BotContext, filters: SuggestFilters) {
  await ctx.replyWithChatAction("typing");
  const result = await ctx.services.recommender.suggest(ctx.user.id, filters);
  if (result.suggestions.length === 0) return ctx.reply(messages.noSuggestions);
  if (!ctx.chat) return;
  await deliverSuggestions(ctx.api, ctx.chat.id, result);
}

/** Send an intro line and one card per suggestion (poster when available) to a chat. */
export async function deliverSuggestions(
  api: Api,
  chatId: number,
  result: SuggestResult,
  intro?: string,
) {
  await api.sendMessage(
    chatId,
    intro ??
      (result.coldStart
        ? messages.coldStart(result.ratingsUsed, MIN_RATINGS)
        : messages.suggestionsIntro(result.ratingsUsed, result.model)),
  );
  for (const s of result.suggestions) {
    const caption = suggestionCaption(s, !result.coldStart);
    const reply_markup = suggestionKeyboard(s.id);
    if (s.title.posterPath) {
      await api.sendPhoto(chatId, `${POSTER_BASE}${s.title.posterPath}`, {
        caption,
        parse_mode: "HTML",
        reply_markup,
      });
    } else {
      await api.sendMessage(chatId, caption, { parse_mode: "HTML", reply_markup });
    }
  }
}

export function filtersFrom(parsed: ParsedMessage): SuggestFilters {
  return {
    kind: parsed.kind,
    maxRuntime: parsed.max_runtime,
    genres: parsed.genres,
    avoidGenres: parsed.avoid_genres,
  };
}

export function suggestionCaption(s: Suggestion, showPrediction: boolean): string {
  const meta = [
    [...canonicalGenres(s.title.genres)].slice(0, 3).join(", "),
    runtimeLabel(s.title),
  ].filter(Boolean);
  return [
    titleHtml(s.title),
    meta.length ? escapeHtml(meta.join(" · ")) : null,
    showPrediction ? `Predicted for you: ★${s.predicted.toFixed(1)}` : null,
    `<i>${escapeHtml(capitalize(s.reason))}</i>`,
  ]
    .filter(Boolean)
    .join("\n");
}

const suggestionKeyboard = (id: number) =>
  new InlineKeyboard()
    .text("✅ Watched", `sg:w:${id}`)
    .text("📌 Save", `sg:s:${id}`)
    .text("🙅 Not for me", `sg:x:${id}`);

function runtimeLabel(t: Title): string | null {
  if (!t.runtime) return t.kind === "tv" ? "TV series" : null;
  const h = Math.floor(t.runtime / 60);
  const m = t.runtime % 60;
  const duration = h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
  return t.kind === "tv" ? `TV · ${duration} episodes` : duration;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
