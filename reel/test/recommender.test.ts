import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTitle } from "../evals/synthetic.ts";
import { type Db, openDb } from "../src/db/client.ts";
import { addToWatchlist, logWatch, setRating } from "../src/db/library.ts";
import { setSuggestionOutcome } from "../src/db/suggestions.ts";
import { upsertTitle } from "../src/db/titles.ts";
import { upsertUser } from "../src/db/users.ts";
import { explain } from "../src/recommend/explain.ts";
import type { RatingModel } from "../src/recommend/models.ts";
import { RidgeModel } from "../src/recommend/models.ts";
import { matchesFilters, Recommender } from "../src/recommend/recommender.ts";
import { Tracker } from "../src/services/tracker.ts";
import type { TitleDetails } from "../src/tmdb/client.ts";
import { FakeTmdb, toResult } from "./helpers/fake-tmdb.ts";
import { details } from "./helpers/fixtures.ts";

const villeneuve = (id: number, title: string, genres = ["Science Fiction"]) =>
  details({ tmdbId: id, title, directors: ["Denis Villeneuve"], genres, voteAverage: 8 });

// Rated by the user: loves Villeneuve sci-fi, dislikes the romcoms.
const RATED: [TitleDetails, number][] = [
  [villeneuve(1, "Arrival"), 5],
  [villeneuve(2, "Dune"), 4.5],
  [villeneuve(3, "Blade Runner 2049"), 5],
  [details({ tmdbId: 4, title: "Romcom A", genres: ["Romance", "Comedy"], voteAverage: 6 }), 2],
  [details({ tmdbId: 5, title: "Romcom B", genres: ["Romance", "Comedy"], voteAverage: 6.5 }), 1.5],
  [details({ tmdbId: 6, title: "Drama C", genres: ["Drama"] }), 3],
];

const SICARIO = villeneuve(10, "Sicario", ["Thriller", "Crime"]);
const ROMCOM_NEW = details({
  tmdbId: 11,
  title: "Romcom New",
  genres: ["Romance", "Comedy"],
  voteAverage: 6.8,
});
const LONG_EPIC = details({ tmdbId: 12, title: "Long Epic", genres: ["Drama"], runtime: 200 });
const SHOW = details({
  tmdbId: 13,
  title: "Sci-Fi Show",
  kind: "tv",
  genres: ["Sci-Fi & Fantasy"],
});

class FailingModel implements RatingModel {
  readonly name = "TabPFN";
  async fitPredict(): Promise<number[]> {
    throw new Error("API down");
  }
}

describe("Recommender", () => {
  let db: Db;
  let close: () => Promise<void>;
  let userId: number;
  let tmdb: FakeTmdb;
  let tracker: Tracker;

  const recommender = (model: RatingModel = new RidgeModel()) =>
    new Recommender({ db, tmdb, tracker, model, fallback: new RidgeModel() });

  beforeEach(async () => {
    ({ db, close } = await openDb("memory://"));
    userId = (await upsertUser(db, { telegramId: 1 })).id;
    tmdb = new FakeTmdb([...RATED.map(([d]) => d), SICARIO, ROMCOM_NEW, LONG_EPIC, SHOW]);
    tmdb.recommendationsFor.set("movie:1", [toResult(SICARIO), toResult(ROMCOM_NEW)]);
    tmdb.trendingTitles = [
      toResult(LONG_EPIC),
      toResult(SHOW),
      toResult(RATED[0]?.[0] as TitleDetails),
    ];
    tracker = new Tracker({ db, tmdb });
    for (const [d, rating] of RATED) {
      const t = await upsertTitle(db, d);
      await setRating(db, userId, t.id, rating);
    }
  });

  afterEach(() => close());

  it("ranks titles the user should like first and explains why", async () => {
    const result = await recommender().suggest(userId, {}, 4);

    expect(result.coldStart).toBe(false);
    expect(result.model).toBe("ridge regression");
    expect(result.suggestions[0]?.title.title).toBe("Sicario");
    expect(result.suggestions[0]?.reason).toContain("Denis Villeneuve");
    const order = result.suggestions.map((s) => s.title.title);
    expect(order.indexOf("Sicario")).toBeLessThan(order.indexOf("Romcom New"));
  });

  it("never suggests rated, watched or dismissed titles", async () => {
    const first = await recommender().suggest(userId, {}, 10);
    expect(first.suggestions.map((s) => s.title.title)).not.toContain("Arrival");

    const sicario = first.suggestions.find((s) => s.title.title === "Sicario");
    await setSuggestionOutcome(db, sicario?.id ?? -1, "dismissed");
    const epic = first.suggestions.find((s) => s.title.title === "Long Epic");
    await logWatch(db, { userId, titleId: epic?.title.id ?? -1, source: "chat" });

    const titles = (await recommender().suggest(userId, {}, 10)).suggestions.map(
      (s) => s.title.title,
    );
    expect(titles).not.toContain("Sicario");
    expect(titles).not.toContain("Long Epic");
  });

  it("applies kind, runtime and genre filters", async () => {
    const shows = await recommender().suggest(userId, { kind: "tv" }, 10);
    expect(shows.suggestions.map((s) => s.title.title)).toEqual(["Sci-Fi Show"]);

    const short = await recommender().suggest(
      userId,
      { maxRuntime: 150, avoidGenres: ["Romance"] },
      10,
    );
    const names = short.suggestions.map((s) => s.title.title);
    expect(names).not.toContain("Long Epic");
    expect(names).not.toContain("Romcom New");
  });

  it("includes the watchlist", async () => {
    const saved = await upsertTitle(db, details({ tmdbId: 99, title: "Saved One" }));
    await addToWatchlist(db, userId, saved.id, "chat");

    const result = await recommender().suggest(userId, {}, 10);
    expect(result.suggestions.find((s) => s.title.title === "Saved One")).toBeDefined();
  });

  it("falls back to the local model when TabPFN fails", async () => {
    const result = await recommender(new FailingModel()).suggest(userId);
    expect(result.model).toBe("ridge regression");
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("uses popularity before the user has rated enough", async () => {
    const newUser = (await upsertUser(db, { telegramId: 2 })).id;
    const result = await recommender().suggest(newUser);
    expect(result).toMatchObject({ coldStart: true, model: "TMDB popularity", ratingsUsed: 0 });
  });
});

describe("matchesFilters", () => {
  it("treats TV genre names like movie genres", () => {
    const show = makeTitle(1, { kind: "tv", genres: ["Sci-Fi & Fantasy"] });
    expect(matchesFilters(show, { genres: ["science fiction"] })).toBe(true);
  });
});

describe("explain", () => {
  it("prefers a shared director, then cast, then similarity", () => {
    const arrival = makeTitle(1, { title: "Arrival", directors: ["DV"], cast: ["Amy"] });
    const rated = [{ title: arrival, rating: 5 }];

    expect(explain(makeTitle(2, { directors: ["DV"] }), rated, null)).toBe(
      "directed by DV, like Arrival (you gave it ★5)",
    );
    expect(explain(makeTitle(3, { cast: ["Amy"] }), rated, null)).toBe(
      "stars Amy, like Arrival (★5)",
    );
    expect(explain(makeTitle(4), rated, "trending this week")).toBe("trending this week");
  });
});
