import { and, eq, gte } from "drizzle-orm";
import type { Api } from "grammy";
import { episodeCode, escapeHtml, titleHtml } from "../bot/format.ts";
import { deliverSuggestions } from "../bot/suggesting.ts";
import type { Db } from "../db/client.ts";
import { claimNotification, releaseNotification } from "../db/notifications.ts";
import { ratings, showProgress, titles, type User, users, watchEvents } from "../db/schema.ts";
import { ratedTitles } from "../db/suggestions.ts";
import { canonicalGenres } from "../recommend/features.ts";
import { MIN_RATINGS, type Recommender } from "../recommend/recommender.ts";
import type { Tracker } from "../services/tracker.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Episodes that aired within this window count as "new". */
const NEW_EPISODE_WINDOW_DAYS = 2;

export interface JobDeps {
  db: Db;
  api: Api;
  tracker: Tracker;
  recommender: Recommender;
  now: () => Date;
}

export interface JobReport {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Send each message at most once per key: claim the key, send, and release it if sending
 * fails so the next run retries.
 */
async function sendOnce(
  deps: JobDeps,
  user: User,
  key: string,
  send: () => Promise<unknown>,
  report: JobReport,
) {
  if (!(await claimNotification(deps.db, user.id, key))) {
    report.skipped++;
    return;
  }
  try {
    await send();
    report.sent++;
  } catch (err) {
    await releaseNotification(deps.db, user.id, key);
    console.warn(`Job message ${key} to user ${user.id} failed:`, err);
    report.failed++;
  }
}

/** Alert users when the next episode of a show they're watching has just aired. */
export async function newEpisodeAlerts(deps: JobDeps): Promise<JobReport> {
  const report: JobReport = { sent: 0, skipped: 0, failed: 0 };
  const today = deps.now();
  const rows = await deps.db
    .select({ user: users, progress: showProgress, title: titles })
    .from(showProgress)
    .innerJoin(users, eq(users.id, showProgress.userId))
    .innerJoin(titles, eq(titles.id, showProgress.titleId))
    .where(eq(showProgress.status, "watching"));

  const refreshed = new Map<number, Awaited<ReturnType<Tracker["refreshTitle"]>>>();
  for (const { user, progress, title } of rows) {
    let fresh = refreshed.get(title.id);
    if (!fresh) {
      fresh = await deps.tracker.refreshTitle(title).catch(() => title);
      refreshed.set(title.id, fresh);
    }
    const next = await deps.tracker.nextEpisode(fresh, progress.season, progress.episode);
    if (!next?.airDate) {
      report.skipped++;
      continue;
    }
    const aired = new Date(next.airDate);
    const age = (today.getTime() - aired.getTime()) / DAY_MS;
    if (age < 0 || age > NEW_EPISODE_WINDOW_DAYS) {
      report.skipped++;
      continue;
    }
    const code = episodeCode(next.seasonNumber, next.episodeNumber);
    const name = next.name ? ` “${escapeHtml(next.name)}”` : "";
    await sendOnce(
      deps,
      user,
      `episode:${fresh.id}:${code}`,
      () =>
        deps.api.sendMessage(
          user.telegramId,
          `🔔 New episode of ${titleHtml(fresh)} is out: ${code}${name}\n\nTell me when you've watched it!`,
          { parse_mode: "HTML" },
        ),
      report,
    );
  }
  return report;
}

/** Friday-evening suggestions for everyone with enough ratings for personal picks. */
export async function fridayPicks(deps: JobDeps): Promise<JobReport> {
  const report: JobReport = { sent: 0, skipped: 0, failed: 0 };
  const week = isoWeek(deps.now());
  for (const user of await deps.db.select().from(users)) {
    if ((await ratedTitles(deps.db, user.id)).length < MIN_RATINGS) {
      report.skipped++;
      continue;
    }
    const result = await deps.recommender.suggest(user.id, {}, 3);
    if (result.suggestions.length === 0) {
      report.skipped++;
      continue;
    }
    await sendOnce(
      deps,
      user,
      `picks:${week}`,
      () =>
        deliverSuggestions(
          deps.api,
          user.telegramId,
          result,
          "🍿 It's Friday! Three picks for your weekend:",
        ),
      report,
    );
  }
  return report;
}

/** Sunday summary of the past seven days for users who watched something. */
export async function weeklyRecap(deps: JobDeps): Promise<JobReport> {
  const report: JobReport = { sent: 0, skipped: 0, failed: 0 };
  const since = new Date(deps.now().getTime() - 7 * DAY_MS);
  const week = isoWeek(deps.now());
  for (const user of await deps.db.select().from(users)) {
    const events = await deps.db
      .select({ event: watchEvents, title: titles })
      .from(watchEvents)
      .innerJoin(titles, eq(titles.id, watchEvents.titleId))
      .where(and(eq(watchEvents.userId, user.id), gte(watchEvents.watchedAt, since)));
    if (events.length === 0) {
      report.skipped++;
      continue;
    }
    const weekRatings = await deps.db
      .select({ title: titles.title, rating: ratings.rating })
      .from(ratings)
      .innerJoin(titles, eq(titles.id, ratings.titleId))
      .where(and(eq(ratings.userId, user.id), gte(ratings.ratedAt, since)));
    await sendOnce(
      deps,
      user,
      `recap:${week}`,
      () =>
        deps.api.sendMessage(user.telegramId, recapText(events, weekRatings), {
          parse_mode: "HTML",
        }),
      report,
    );
  }
  return report;
}

export function recapText(
  events: {
    event: { season: number | null };
    title: { title: string; kind: string; runtime: number | null; genres: string[] };
  }[],
  weekRatings: { title: string; rating: number }[],
): string {
  const movies = events.filter((e) => e.title.kind === "movie").length;
  const episodes = events.length - movies;
  const minutes = events.reduce(
    (sum, e) => sum + (e.title.runtime ?? (e.title.kind === "movie" ? 110 : 45)),
    0,
  );
  const genreCounts = new Map<string, number>();
  for (const e of events) {
    for (const g of canonicalGenres(e.title.genres))
      genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  }
  const topGenres = [...genreCounts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([g]) => g.toLowerCase());
  const favourite = [...weekRatings].sort((a, b) => b.rating - a.rating)[0];

  const lines = [
    "📊 <b>Your week in Reel</b>",
    "",
    `🎬 ${movies} film${movies === 1 ? "" : "s"} · 📺 ${episodes} episode${episodes === 1 ? "" : "s"}`,
    `⏱ about ${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"} of watching`,
  ];
  if (topGenres.length) lines.push(`🎭 mostly ${topGenres.join(" and ")}`);
  if (favourite)
    lines.push(`⭐ top rated: <b>${escapeHtml(favourite.title)}</b> (★${favourite.rating})`);
  lines.push("", "Want something new? Send /suggest.");
  return lines.join("\n");
}

/** e.g. "2026-W40", used to send weekly messages once per week. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
