import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../src/db/client.ts";
import { getProgress } from "../src/db/library.ts";
import { upsertUser } from "../src/db/users.ts";
import { Tracker } from "../src/services/tracker.ts";
import { FakeTmdb } from "./helpers/fake-tmdb.ts";
import { details, SEVERANCE } from "./helpers/fixtures.ts";

const AIRING = details({
  tmdbId: 1,
  title: "Airing Show",
  kind: "tv",
  status: "Returning Series",
  seasons: [
    { seasonNumber: 1, episodeCount: 8, airDate: "2024-01-01" },
    { seasonNumber: 2, episodeCount: 10, airDate: "2026-01-01" },
  ],
  nextEpisodeToAir: { seasonNumber: 2, episodeNumber: 4, name: "", airDate: "2026-02-01" },
});

const ENDED = details({
  tmdbId: 2,
  title: "Ended Show",
  kind: "tv",
  status: "Ended",
  seasons: [{ seasonNumber: 1, episodeCount: 6, airDate: "2019-01-01" }],
});

const req = { season: null, episode: null, finishedSeries: false, note: null };

describe("Tracker.logWatch", () => {
  let db: Db;
  let close: () => Promise<void>;
  let tracker: Tracker;
  let userId: number;

  beforeEach(async () => {
    ({ db, close } = await openDb("memory://"));
    tracker = new Tracker({ db, tmdb: new FakeTmdb([SEVERANCE, AIRING, ENDED]) });
    userId = (await upsertUser(db, { telegramId: 1 })).id;
  });

  afterEach(() => close());

  it("finishing an airing show stops at the last aired episode", async () => {
    const title = await tracker.ensureTitle("tv", AIRING.tmdbId);
    const outcome = await tracker.logWatch(userId, title, { ...req, finishedSeries: true }, "chat");

    expect(outcome).toMatchObject({ type: "tv", season: 2, episode: 3 });
    expect(await getProgress(db, userId, title.id)).toMatchObject({ status: "finished" });
  });

  it("marks an ended show finished after its last episode", async () => {
    const title = await tracker.ensureTitle("tv", ENDED.tmdbId);
    await tracker.logWatch(userId, title, { ...req, season: 1, episode: 6 }, "chat");

    expect(await getProgress(db, userId, title.id)).toMatchObject({ status: "finished" });
  });

  it("starts at S01E01 when nothing has been logged", async () => {
    const title = await tracker.ensureTitle("tv", SEVERANCE.tmdbId);
    expect(await tracker.logWatch(userId, title, req, "chat")).toMatchObject({
      season: 1,
      episode: 1,
    });
  });

  it("keeps the current season when only an episode is given", async () => {
    const title = await tracker.ensureTitle("tv", SEVERANCE.tmdbId);
    expect(await tracker.logWatch(userId, title, { ...req, episode: 3 }, "chat")).toMatchObject({
      season: 1,
      episode: 3,
    });
    await tracker.logWatch(userId, title, { ...req, season: 2, episode: 1 }, "chat");
    expect(await tracker.logWatch(userId, title, { ...req, episode: 4 }, "chat")).toMatchObject({
      season: 2,
      episode: 4,
    });
  });

  it("rejects a season that doesn't exist", async () => {
    const title = await tracker.ensureTitle("tv", SEVERANCE.tmdbId);
    expect(await tracker.logWatch(userId, title, { ...req, season: 9 }, "chat")).toMatchObject({
      type: "unknown_season",
    });
  });

  it("caches title details", async () => {
    const tmdb = new FakeTmdb([SEVERANCE]);
    const cached = new Tracker({ db, tmdb });
    await cached.ensureTitle("tv", SEVERANCE.tmdbId);
    await cached.ensureTitle("tv", SEVERANCE.tmdbId);

    expect(tmdb.calls.filter((c) => c.startsWith("details"))).toHaveLength(1);
  });
});
