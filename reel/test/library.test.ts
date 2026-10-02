import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../src/db/client.ts";
import {
  addToWatchlist,
  continueWatching,
  getProgress,
  getRating,
  getWatchlist,
  libraryKeys,
  logWatch,
  recentHistory,
  setRating,
  undoLastWatch,
} from "../src/db/library.ts";
import type { Title } from "../src/db/schema.ts";
import { upsertTitle } from "../src/db/titles.ts";
import { upsertUser } from "../src/db/users.ts";
import { DUNE_2, SEVERANCE } from "./helpers/fixtures.ts";

describe("library", () => {
  let db: Db;
  let close: () => Promise<void>;
  let userId: number;
  let show: Title;
  let movie: Title;

  beforeEach(async () => {
    ({ db, close } = await openDb("memory://"));
    userId = (await upsertUser(db, { telegramId: 1 })).id;
    show = await upsertTitle(db, SEVERANCE);
    movie = await upsertTitle(db, DUNE_2);
  });

  afterEach(() => close());

  it("upsertTitle refreshes metadata without duplicating", async () => {
    const again = await upsertTitle(db, { ...DUNE_2, voteAverage: 9 });
    expect(again.id).toBe(movie.id);
    expect(again.voteAverage).toBe(9);
  });

  it("moves show progress forward but never backwards", async () => {
    await logWatch(db, { userId, titleId: show.id, season: 1, episode: 5, source: "chat" });
    await logWatch(db, { userId, titleId: show.id, season: 2, episode: 1, source: "chat" });
    await logWatch(db, { userId, titleId: show.id, season: 1, episode: 7, source: "chat" });

    expect(await getProgress(db, userId, show.id)).toMatchObject({ season: 2, episode: 1 });
  });

  it("lists shows in progress", async () => {
    await logWatch(db, { userId, titleId: show.id, season: 1, episode: 2, source: "chat" });

    const rows = await continueWatching(db, userId);
    expect(rows.map((r) => r.title.title)).toEqual(["Severance"]);
  });

  it("removes a movie from the watchlist once watched", async () => {
    await addToWatchlist(db, userId, movie.id, "chat");
    expect(await getWatchlist(db, userId)).toHaveLength(1);

    await logWatch(db, { userId, titleId: movie.id, source: "chat" });
    expect(await getWatchlist(db, userId)).toHaveLength(0);
  });

  it("does not add a title to the watchlist twice", async () => {
    expect(await addToWatchlist(db, userId, movie.id, "chat")).toBe(true);
    expect(await addToWatchlist(db, userId, movie.id, "chat")).toBe(false);
  });

  it("rounds and clamps ratings to half stars", async () => {
    expect(await setRating(db, userId, movie.id, 4.3)).toBe(4.5);
    expect(await setRating(db, userId, movie.id, 9)).toBe(5);
    expect(await getRating(db, userId, movie.id)).toBe(5);
  });

  it("undo deletes the last watch and rewinds progress", async () => {
    await logWatch(db, { userId, titleId: show.id, season: 1, episode: 1, source: "chat" });
    await logWatch(db, { userId, titleId: show.id, season: 1, episode: 2, source: "chat" });

    const undone = await undoLastWatch(db, userId);
    expect(undone?.event.episode).toBe(2);
    expect(await getProgress(db, userId, show.id)).toMatchObject({ season: 1, episode: 1 });

    await undoLastWatch(db, userId);
    expect(await getProgress(db, userId, show.id)).toBeNull();
    expect(await undoLastWatch(db, userId)).toBeNull();
  });

  it("returns history newest first", async () => {
    await logWatch(db, {
      userId,
      titleId: movie.id,
      source: "chat",
      watchedAt: new Date("2025-01-01"),
    });
    await logWatch(db, { userId, titleId: show.id, season: 1, episode: 1, source: "chat" });

    const history = await recentHistory(db, userId);
    expect(history.map((h) => h.title.title)).toEqual(["Severance", "Dune: Part Two"]);
  });

  it("collects library keys across watches, ratings and watchlist", async () => {
    await addToWatchlist(db, userId, movie.id, "chat");
    await setRating(db, userId, show.id, 4);

    expect(await libraryKeys(db, userId)).toEqual(new Set(["movie:693134", "tv:95396"]));
  });
});
