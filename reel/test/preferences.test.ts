import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTitle } from "../evals/synthetic.ts";
import { type Db, openDb } from "../src/db/client.ts";
import {
  activePreferences,
  addPreference,
  clearPreferences,
  deletePreference,
} from "../src/db/preferences.ts";
import type { Preference } from "../src/db/schema.ts";
import { upsertUser } from "../src/db/users.ts";
import { preferenceAdjustment, withPreferences } from "../src/recommend/preferences.ts";

const pref = (over: Partial<Preference>): Preference => ({
  id: 1,
  userId: 1,
  fact: "",
  polarity: "like",
  genres: [],
  expiresAt: null,
  createdAt: new Date(),
  ...over,
});

describe("preference storage", () => {
  let db: Db;
  let close: () => Promise<void>;
  let userId: number;

  beforeEach(async () => {
    ({ db, close } = await openDb("memory://"));
    userId = (await upsertUser(db, { telegramId: 1 })).id;
  });

  afterEach(() => close());

  it("drops temporary preferences once they expire", async () => {
    const now = new Date("2026-01-01T20:00:00Z");
    await addPreference(db, {
      userId,
      fact: "hates horror",
      polarity: "dislike",
      genres: ["Horror"],
    });
    await addPreference(db, {
      userId,
      fact: "with mum tonight",
      polarity: "like",
      genres: ["Family"],
      expiresAt: new Date("2026-01-02T08:00:00Z"),
    });

    expect(await activePreferences(db, userId, now)).toHaveLength(2);
    expect(
      (await activePreferences(db, userId, new Date("2026-01-02T09:00:00Z"))).map((p) => p.fact),
    ).toEqual(["hates horror"]);
  });

  it("deletes only the user's own preferences", async () => {
    const other = (await upsertUser(db, { telegramId: 2 })).id;
    const mine = await addPreference(db, { userId, fact: "x", polarity: "like", genres: [] });

    expect(await deletePreference(db, other, mine.id)).toBe(false);
    expect(await deletePreference(db, userId, mine.id)).toBe(true);
  });

  it("clears everything", async () => {
    await addPreference(db, { userId, fact: "a", polarity: "like", genres: [] });
    await addPreference(db, { userId, fact: "b", polarity: "dislike", genres: [] });
    expect(await clearPreferences(db, userId)).toBe(2);
  });
});

describe("withPreferences", () => {
  const hatesHorror = pref({ polarity: "dislike", genres: ["Horror"] });

  it("turns disliked genres into filters", () => {
    expect(withPreferences({}, [hatesHorror]).avoidGenres).toEqual(["Horror"]);
  });

  it("lets an explicit request override a dislike", () => {
    expect(withPreferences({ genres: ["horror"] }, [hatesHorror]).avoidGenres).toEqual([]);
  });
});

describe("preferenceAdjustment", () => {
  const film = makeTitle(1, {
    genres: ["Comedy"],
    directors: ["Greta Gerwig"],
    cast: ["Florence Pugh"],
  });

  it("boosts liked genres and people", () => {
    expect(preferenceAdjustment(film, [pref({ genres: ["Comedy"] })])).toBeCloseTo(0.3);
    expect(
      preferenceAdjustment(film, [pref({ fact: "love anything with Florence Pugh" })]),
    ).toBeCloseTo(0.4);
  });

  it("penalises disliked people", () => {
    expect(
      preferenceAdjustment(film, [pref({ polarity: "dislike", fact: "not into greta gerwig" })]),
    ).toBeCloseTo(-0.8);
  });

  it("ignores unrelated preferences", () => {
    expect(preferenceAdjustment(film, [pref({ genres: ["Horror"], fact: "love horror" })])).toBe(0);
  });
});
