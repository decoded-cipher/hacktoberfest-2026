import { Bot } from "grammy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../src/db/client.ts";
import { logWatch, setRating } from "../src/db/library.ts";
import { upsertTitle } from "../src/db/titles.ts";
import { upsertUser } from "../src/db/users.ts";
import {
  fridayPicks,
  isoWeek,
  type JobDeps,
  newEpisodeAlerts,
  recapText,
  weeklyRecap,
} from "../src/jobs/jobs.ts";
import { RidgeModel } from "../src/recommend/models.ts";
import { Recommender } from "../src/recommend/recommender.ts";
import { Tracker } from "../src/services/tracker.ts";
import { type ApiCall, BOT_INFO, recordApiCalls } from "./helpers/bot.ts";
import { FakeTmdb, toResult } from "./helpers/fake-tmdb.ts";
import { details, SEVERANCE } from "./helpers/fixtures.ts";

const NOW = new Date("2026-10-02T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

describe("scheduled jobs", () => {
  let db: Db;
  let close: () => Promise<void>;
  let tmdb: FakeTmdb;
  let calls: ApiCall[];
  let deps: JobDeps;
  let failSends = false;

  beforeEach(async () => {
    ({ db, close } = await openDb("memory://"));
    tmdb = new FakeTmdb([
      SEVERANCE,
      ...Array.from({ length: 6 }, (_, i) => details({ tmdbId: 100 + i, title: `Film ${i}` })),
    ]);
    tmdb.trendingTitles = [toResult(details({ tmdbId: 200, title: "Trending One" }))];
    tmdb.titles.push(details({ tmdbId: 200, title: "Trending One" }));
    const bot = new Bot("t", { botInfo: BOT_INFO });
    calls = recordApiCalls(bot);
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (failSends && method.startsWith("send")) throw new Error("Forbidden: bot was blocked");
      return prev(method, payload, signal);
    });
    const now = () => NOW;
    const tracker = new Tracker({ db, tmdb, now });
    const model = new RidgeModel();
    deps = {
      db,
      api: bot.api,
      tracker,
      recommender: new Recommender({ db, tmdb, tracker, model, fallback: model, now }),
      now,
    };
    failSends = false;
  });

  afterEach(() => close());

  const watchingSeverance = async (nextAirDate: string) => {
    const user = await upsertUser(db, { telegramId: 42, firstName: "Asha" });
    const show = await upsertTitle(db, SEVERANCE);
    await logWatch(db, {
      userId: user.id,
      titleId: show.id,
      season: 2,
      episode: 5,
      source: "chat",
    });
    tmdb.seasons.set(`${SEVERANCE.tmdbId}:2`, {
      seasonNumber: 2,
      episodes: [{ seasonNumber: 2, episodeNumber: 6, name: "Attila", airDate: nextAirDate }],
    });
    return user;
  };
  const sent = () => calls.filter((c) => c.method.startsWith("send"));

  it("alerts once when the next episode just aired", async () => {
    await watchingSeverance(daysAgo(1));

    expect(await newEpisodeAlerts(deps)).toMatchObject({ sent: 1 });
    expect(sent()[0]?.payload.text).toContain(
      "New episode of <b>Severance</b> (2022) is out: S02E06 “Attila”",
    );

    calls.length = 0;
    expect(await newEpisodeAlerts(deps)).toMatchObject({ sent: 0, skipped: 1 });
    expect(sent()).toHaveLength(0);
  });

  it("ignores old and upcoming episodes", async () => {
    await watchingSeverance(daysAgo(30));
    expect((await newEpisodeAlerts(deps)).sent).toBe(0);

    tmdb.seasons.set(`${SEVERANCE.tmdbId}:2`, {
      seasonNumber: 2,
      episodes: [{ seasonNumber: 2, episodeNumber: 6, name: "", airDate: daysAgo(-3) }],
    });
    expect((await newEpisodeAlerts(deps)).sent).toBe(0);
  });

  it("retries on the next run when sending fails", async () => {
    await watchingSeverance(daysAgo(0));
    failSends = true;
    expect(await newEpisodeAlerts(deps)).toMatchObject({ sent: 0, failed: 1 });

    failSends = false;
    expect(await newEpisodeAlerts(deps)).toMatchObject({ sent: 1 });
  });

  it("sends Friday picks once a week to users with enough ratings", async () => {
    const rated = await upsertUser(db, { telegramId: 1 });
    await upsertUser(db, { telegramId: 2 }); // no ratings → skipped
    for (let i = 0; i < 6; i++) {
      const t = await upsertTitle(db, details({ tmdbId: 100 + i, title: `Film ${i}` }));
      await setRating(db, rated.id, t.id, 3 + (i % 3));
    }

    expect(await fridayPicks(deps)).toMatchObject({ sent: 1, skipped: 1 });
    expect(sent()[0]?.payload.text).toContain("It's Friday");
    expect(sent().some((c) => JSON.stringify(c.payload).includes("Trending One"))).toBe(true);

    expect(await fridayPicks(deps)).toMatchObject({ sent: 0 });
  });

  it("sends a weekly recap only to users who watched something", async () => {
    const user = await watchingSeverance(daysAgo(30));
    await upsertUser(db, { telegramId: 7 });
    const film = await upsertTitle(db, details({ tmdbId: 300, title: "Arrival", runtime: 116 }));
    await logWatch(db, {
      userId: user.id,
      titleId: film.id,
      source: "chat",
      watchedAt: new Date(daysAgo(2)),
    });
    await setRating(db, user.id, film.id, 5, new Date(daysAgo(2)));

    expect(await weeklyRecap(deps)).toMatchObject({ sent: 1, skipped: 1 });
    const text = sent()[0]?.payload.text;
    expect(text).toContain("1 film · 📺 1 episode");
    expect(text).toContain("top rated: <b>Arrival</b> (★5)");
  });
});

describe("recapText", () => {
  it("adds up runtime and names top genres", () => {
    const text = recapText(
      [
        {
          event: { season: null },
          title: { title: "A", kind: "movie", runtime: 120, genres: ["Drama"] },
        },
        {
          event: { season: 1 },
          title: { title: "B", kind: "tv", runtime: 60, genres: ["Drama", "Comedy"] },
        },
      ],
      [],
    );
    expect(text).toContain("about 3 hours");
    expect(text).toContain("mostly drama and comedy");
  });
});

describe("isoWeek", () => {
  it("formats ISO weeks, including year boundaries", () => {
    expect(isoWeek(new Date("2026-10-02T12:00:00Z"))).toBe("2026-W40");
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
});
