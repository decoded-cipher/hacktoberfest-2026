import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../src/db/client.ts";
import { getRating, getWatchlist, recentHistory } from "../src/db/library.ts";
import { findTitle } from "../src/db/titles.ts";
import { upsertUser } from "../src/db/users.ts";
import { ImportFormatError, parseImdb, readCsv, readUpload } from "../src/importers/parse.ts";
import { importItems } from "../src/importers/run.ts";
import { Tracker } from "../src/services/tracker.ts";
import { FakeTmdb } from "./helpers/fake-tmdb.ts";
import { ARRIVAL, DUNE_2, details, letterboxdZip, SEVERANCE } from "./helpers/fixtures.ts";

const PAST_LIVES = details({ tmdbId: 666277, title: "Past Lives", year: 2023 });

const IMDB_CSV =
  "﻿Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors\n" +
  "tt15239678,9,2024-03-10,Dune: Part Two,Dune: Part Two,https://imdb.com/title/tt15239678,Movie,8.5,166,2024,Sci-Fi,600000,2024-02-27,Denis Villeneuve\n" +
  "tt11280740,8,2025-02-01,Severance,Severance,https://imdb.com/title/tt11280740,TV Series,8.7,55,2022,Drama,300000,2022-02-18,\n" +
  "tt0000001,7,2025-02-01,Some Episode,Some Episode,https://imdb.com/title/tt0000001,TV Episode,8,50,2022,Drama,100,2022-02-18,\n";

describe("readUpload", () => {
  it("merges Letterboxd files into one item per film", () => {
    const items = readUpload("letterboxd-export.zip", letterboxdZip());

    const dune = items.find((i) => i.name === "Dune: Part Two");
    expect(dune).toMatchObject({ year: 2024, rating: 4.5, kind: "movie", watchlist: false });
    expect(dune?.watchedAt?.toISOString().slice(0, 10)).toBe("2024-03-10");
    expect(items.find((i) => i.name === "Past Lives")).toMatchObject({ watchlist: true });
    expect(items).toHaveLength(4);
  });

  it("reads a single Letterboxd ratings CSV", () => {
    const csv = "Date,Name,Year,Letterboxd URI,Rating\n2024-03-10,Arrival,2016,x,3.5\n";
    expect(readUpload("my-ratings.csv", strToU8(csv))).toEqual([
      expect.objectContaining({ name: "Arrival", rating: 3.5 }),
    ]);
  });

  it("reads IMDb ratings, halving the 10-point scale and skipping episodes", () => {
    const items = readUpload("ratings.csv", strToU8(IMDB_CSV));

    expect(items).toEqual([
      expect.objectContaining({ imdbId: "tt15239678", kind: "movie", rating: 4.5 }),
      expect.objectContaining({ imdbId: "tt11280740", kind: "tv", rating: 4, watchedAt: null }),
    ]);
  });

  it("treats IMDb rows without a rating as watchlist", () => {
    const rows = readCsv("Const,Title,Title Type,Year\ntt1,Foo,Movie,2020\n");
    expect(parseImdb(rows)).toEqual([expect.objectContaining({ watchlist: true, rating: null })]);
  });

  it("rejects unknown files", () => {
    expect(() => readUpload("notes.txt", strToU8("hi"))).toThrow(ImportFormatError);
    expect(() => readUpload("x.csv", strToU8("a,b\n1,2\n"))).toThrow(ImportFormatError);
    expect(() => readUpload("x.zip", zipSync({ "a.txt": strToU8("x") }))).toThrow(
      ImportFormatError,
    );
  });
});

describe("importItems", () => {
  let db: Db;
  let close: () => Promise<void>;
  let userId: number;
  let deps: { db: Db; tmdb: FakeTmdb; tracker: Tracker };

  beforeEach(async () => {
    ({ db, close } = await openDb("memory://"));
    userId = (await upsertUser(db, { telegramId: 1 })).id;
    const tmdb = new FakeTmdb([DUNE_2, ARRIVAL, SEVERANCE, PAST_LIVES]);
    deps = { db, tmdb, tracker: new Tracker({ db, tmdb }) };
  });

  afterEach(() => close());

  it("imports ratings, watches and watchlist, reporting unmatched titles", async () => {
    const items = readUpload("export.zip", letterboxdZip());
    const progress: number[] = [];

    const summary = await importItems(deps, userId, items, (done) => {
      progress.push(done);
    });

    expect(summary).toEqual({
      total: 4,
      matched: 3,
      rated: 2,
      watched: 2,
      watchlisted: 1,
      unmatched: ["Some Obscure Film (1971)"],
    });
    expect(progress.at(-1)).toBe(4);
    const arrival = await findTitle(db, "movie", ARRIVAL.tmdbId);
    expect(await getRating(db, userId, arrival?.id ?? -1)).toBe(5);
    expect((await getWatchlist(db, userId)).map((t) => t.title)).toEqual(["Past Lives"]);
  });

  it("is safe to run twice", async () => {
    const items = readUpload("export.zip", letterboxdZip());
    await importItems(deps, userId, items);
    const again = await importItems(deps, userId, items);

    expect(again.watched).toBe(0);
    expect(again.watchlisted).toBe(0);
    expect(await recentHistory(deps.db, userId, 100)).toHaveLength(2);
  });
});
